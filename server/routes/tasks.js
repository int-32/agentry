import { Hono } from "hono";
import { asText, firstLine, startManualTaskRun } from "../../lib/task-orchestration/manual-task-run.js";

function parseTime(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function latestRunForTask(runs, task) {
  const ids = new Set(task?.runIds || []);
  return runs
    .filter(run => run.taskId === task?.id || ids.has(run.id))
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0] || null;
}

function latestNodeOutcome(run) {
  const nodes = Array.isArray(run?.nodes) ? run.nodes : [];
  return nodes.find(node => node.status === "failed")
    || nodes.find(node => node.status === "blocked")
    || [...nodes].reverse().find(node => node.status === "done")
    || nodes.find(node => node.status === "running")
    || nodes[0]
    || null;
}

function diagnostic(kind, severity, title, detail, data = {}) {
  return { kind, severity, title, detail, data };
}

function computeTaskDiagnostics(engine, task, { runs = null, activeWorkers = null, now = Date.now() } = {}) {
  if (!task) return [];
  const allRuns = runs || engine.taskOrchestrator?.listRuns?.() || [];
  const workers = activeWorkers || engine.taskOrchestrator?.listActiveWorkers?.() || [];
  const taskWorkers = workers.filter(worker => worker.taskId === task.id);
  const agents = typeof engine.listAgents === "function" ? engine.listAgents() : [];
  const knownAgentIds = new Set(agents.map(agent => agent.id).filter(Boolean));
  const out = [];
  const assigneeId = asText(task.assignee?.id, "");

  if (assigneeId && knownAgentIds.size > 0 && !knownAgentIds.has(assigneeId)) {
    out.push(diagnostic(
      "agent_missing",
      "error",
      "负责人 agent 不存在",
      `任务分配给 ${assigneeId}，但当前 agent 列表里没有这个 id。需要重新分配或恢复 agent 配置。`,
      { assigneeId },
    ));
  }

  if (task.status === "ready" && assigneeId) {
    const readySince = parseTime(task.updatedAt || task.createdAt);
    const ageMs = readySince ? now - readySince : 0;
    if (ageMs > 30 * 60 * 1000) {
      out.push(diagnostic(
        "stranded_ready",
        ageMs > 3 * 60 * 60 * 1000 ? "critical" : "warning",
        "就绪任务长时间未被执行",
        "任务处于就绪状态但没有 worker 认领。通常是主代理未启动、agent 不可用，或调度入口没有运行。",
        { ageMs, assigneeId },
      ));
    }
  }

  if (task.status === "running") {
    if (!taskWorkers.length) {
      const updatedAt = parseTime(task.updatedAt || task.createdAt);
      if (!updatedAt || now - updatedAt > 3000) {
        out.push(diagnostic(
          "running_without_worker",
          "critical",
          "状态为进行中，但没有活跃 worker",
          "任务显示正在执行，但后端没有发现正在运行的 worker。需要重新开始、回收或检查执行器。",
          { latestRunId: task.latestRunId || null },
        ));
      }
    }
    for (const worker of taskWorkers) {
      if (worker.stale) {
        out.push(diagnostic(
          "worker_claim_stale",
          "error",
          "worker 心跳已过期",
          "worker 的 claim 已过期，可能卡死或执行器已断开。建议回收后重试。",
          worker,
        ));
      }
    }
  }

  if ((Number(task.consecutiveFailures) || 0) >= 2) {
    out.push(diagnostic(
      "repeated_failures",
      (Number(task.consecutiveFailures) || 0) >= 4 ? "critical" : "error",
      `连续失败 ${task.consecutiveFailures} 次`,
      task.lastFailureError || "同一任务连续执行失败。需要检查 worker 输出、目录权限或 agent 配置。",
      { consecutiveFailures: task.consecutiveFailures, lastFailureError: task.lastFailureError || null },
    ));
  }

  const latestRun = latestRunForTask(allRuns, task);
  const latestNode = latestNodeOutcome(latestRun);
  if (latestRun?.status === "done" && latestNode && !latestNode.resultStatus) {
    out.push(diagnostic(
      "missing_handoff_protocol",
      "warning",
      "worker 未使用结构化完成协议",
      "任务完成了，但 worker 没有输出 task_result 协议。结果可以阅读，但后续自动判断和结构化交接会变弱。",
      { runId: latestRun.id, nodeId: latestNode.id },
    ));
  }

  const rank = { critical: 3, error: 2, warning: 1 };
  return out.sort((a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0));
}

function attachDiagnostics(engine, task, context = {}) {
  if (!task) return task;
  const diagnostics = computeTaskDiagnostics(engine, task, context);
  return {
    ...task,
    diagnostics,
    warningSeverity: diagnostics[0]?.severity || null,
  };
}

export function createTasksRoute(engine) {
  const route = new Hono();

  route.get("/tasks", async (c) => {
    try {
      const status = asText(c.req.query("status"));
      const sourceType = asText(c.req.query("sourceType"));
      const rootSessionPath = asText(c.req.query("rootSessionPath"));
      const runs = engine.taskOrchestrator?.listRuns?.() || [];
      const activeWorkers = engine.taskOrchestrator?.listActiveWorkers?.() || [];
      const tasks = engine.taskLedger?.listTasks?.({ status, sourceType, rootSessionPath }) || [];
      return c.json({
        tasks: tasks.map(task => attachDiagnostics(engine, task, { runs, activeWorkers })),
      });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.post("/tasks", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const title = asText(body.title || body.name);
      const bodyText = asText(body.body || body.description || body.notes);
      const goal = asText(body.goal || body.objective);
      const explicitRootSessionPath = asText(body.rootSessionPath) || asText(body.currentSessionPath) || null;
      if (!title && !bodyText && !goal) return c.json({ error: "title, body, or goal is required" }, 400);
      const requestedStatus = asText(body.status, "todo");
      if (requestedStatus === "running" && body.autoStart !== true) {
        return c.json({ error: "Cannot create a running task directly; set autoStart=true or use /api/tasks/:id/start" }, 400);
      }
      const initialStatus = requestedStatus === "running" ? "ready" : requestedStatus;
      if (body.autoStart === true && !engine.taskOrchestrator?.createRun) {
        return c.json({ error: "task orchestrator is unavailable" }, 503);
      }
      const task = engine.taskLedger?.createTask?.({
        title: title || firstLine(goal || bodyText, "未命名任务"),
        body: bodyText,
        goal,
        status: initialStatus,
        source: { type: "manual", channel: "desktop" },
        assignee: body.assignee || null,
        priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : 0,
        rootSessionPath: explicitRootSessionPath,
        cwd: asText(body.cwd) || engine.deskCwd || engine.cwd || null,
        contextRefs: Array.isArray(body.contextRefs) ? body.contextRefs : [],
      });
      const run = body.autoStart === true && task ? startManualTaskRun(engine, task, body) : null;
      const latestTask = task?.id ? engine.taskLedger?.getTask?.(task.id) || task : task;
      return c.json({ ok: true, task: attachDiagnostics(engine, latestTask), ...(run ? { run } : {}) });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.get("/tasks/runs", async (c) => {
    try {
      return c.json({ runs: engine.taskOrchestrator?.listRuns?.() || [] });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.get("/tasks/workers/active", async (c) => {
    try {
      return c.json({ workers: engine.taskOrchestrator?.listActiveWorkers?.() || [] });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.get("/tasks/diagnostics", async (c) => {
    try {
      const runs = engine.taskOrchestrator?.listRuns?.() || [];
      const activeWorkers = engine.taskOrchestrator?.listActiveWorkers?.() || [];
      const diagnostics = (engine.taskLedger?.listTasks?.() || [])
        .map(task => ({ task, diagnostics: computeTaskDiagnostics(engine, task, { runs, activeWorkers }) }))
        .filter(item => item.diagnostics.length > 0);
      return c.json({ diagnostics, count: diagnostics.reduce((sum, item) => sum + item.diagnostics.length, 0) });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.get("/tasks/runs/:id", async (c) => {
    try {
      const run = engine.taskOrchestrator?.getRun?.(c.req.param("id"));
      if (!run) return c.json({ error: "Task run not found" }, 404);
      return c.json({ run });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.get("/tasks/runs/:id/inspect", async (c) => {
    try {
      const inspection = engine.taskOrchestrator?.inspectRun?.(c.req.param("id"));
      if (!inspection) return c.json({ error: "Task run not found" }, 404);
      return c.json({ inspection });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.post("/tasks/runs/:id/cancel", async (c) => {
    try {
      const run = engine.taskOrchestrator?.cancelRun?.(c.req.param("id"), "用户取消任务");
      if (!run) return c.json({ error: "Task run not found" }, 404);
      return c.json({ ok: true, run });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.post("/tasks/:id/start", async (c) => {
    try {
      if (!engine.taskOrchestrator?.createRun) {
        return c.json({ error: "task orchestrator is unavailable" }, 503);
      }
      const task = engine.taskLedger?.getTask?.(c.req.param("id"));
      if (!task) return c.json({ error: "Task not found" }, 404);
      const body = await c.req.json().catch(() => ({}));
      const run = startManualTaskRun(engine, task, body);
      const latestTask = engine.taskLedger?.getTask?.(task.id) || task;
      return c.json({ ok: true, task: attachDiagnostics(engine, latestTask), run });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.get("/tasks/:id", async (c) => {
    try {
      const task = engine.taskLedger?.getTask?.(c.req.param("id"));
      if (!task) return c.json({ error: "Task not found" }, 404);
      return c.json({ task: attachDiagnostics(engine, task) });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.patch("/tasks/:id", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const patch = {};
      if (body.title !== undefined) patch.title = asText(body.title);
      if (body.body !== undefined || body.description !== undefined) patch.body = asText(body.body || body.description);
      if (body.goal !== undefined) patch.goal = asText(body.goal);
      if (body.status !== undefined) patch.status = asText(body.status);
      if (body.assignee !== undefined) patch.assignee = body.assignee || null;
      if (body.priority !== undefined) patch.priority = Number(body.priority);
      if (body.contextRefs !== undefined) patch.contextRefs = body.contextRefs;
      const task = engine.taskLedger?.updateTask?.(c.req.param("id"), patch);
      if (!task) return c.json({ error: "Task not found" }, 404);
      return c.json({ ok: true, task: attachDiagnostics(engine, task) });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.post("/tasks/:id/status", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const status = asText(body.status);
      if (!status) return c.json({ error: "status is required" }, 400);
      if (status === "running") {
        return c.json({ error: "Cannot set status to running directly; use /api/tasks/:id/start" }, 400);
      }
      const task = engine.taskLedger?.updateTask?.(c.req.param("id"), { status });
      if (!task) return c.json({ error: "Task not found" }, 404);
      return c.json({ ok: true, task: attachDiagnostics(engine, task) });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.post("/tasks/:id/comments", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const comment = engine.taskLedger?.addComment?.(c.req.param("id"), {
        author: asText(body.author, "user"),
        body: asText(body.body || body.content),
        channel: asText(body.channel, "desktop"),
        meta: body.meta || {},
      });
      if (!comment) return c.json({ error: "Task not found" }, 404);
      const task = engine.taskLedger?.getTask?.(c.req.param("id"));
      return c.json({ ok: true, comment, task: attachDiagnostics(engine, task) });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.post("/tasks/:id/reclaim", async (c) => {
    try {
      const taskId = c.req.param("id");
      const task = engine.taskLedger?.getTask?.(taskId);
      if (!task) return c.json({ error: "Task not found" }, 404);
      const activeRun = engine.taskOrchestrator?.findActiveRunForTask?.(taskId);
      if (activeRun?.id) engine.taskOrchestrator?.cancelRun?.(activeRun.id, "任务已被回收，等待重新执行");
      const updated = engine.taskLedger?.updateTask?.(taskId, { status: "ready" });
      return c.json({ ok: true, task: attachDiagnostics(engine, updated), reclaimedRunId: activeRun?.id || null });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  return route;
}
