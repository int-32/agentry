import fs from "fs";
import path from "path";

const TASK_STATUSES = new Set(["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done", "failed", "cancelled", "archived"]);
const RUN_TO_TASK_STATUS = {
  running: "running",
  blocked: "blocked",
  done: "done",
  failed: "failed",
  aborted: "cancelled",
};
const REGISTRY_TO_TASK_STATUS = {
  pending: "ready",
  running: "running",
  paused: "blocked",
  blocked: "blocked",
  recovering: "running",
  completed: "done",
  failed: "failed",
  canceled: "cancelled",
  aborted: "cancelled",
};

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function asText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function firstLine(value, fallback = "未命名任务") {
  const text = asText(value);
  if (!text) return fallback;
  return text.split(/\r?\n/).map(line => line.trim()).find(Boolean)?.slice(0, 120) || fallback;
}

function latestRunSummary(runSnapshot) {
  const direct = asText(runSnapshot?.summary);
  if (direct) return direct;
  const nodes = Array.isArray(runSnapshot?.nodes) ? runSnapshot.nodes : [];
  const failed = nodes.find(node => node?.status === "failed");
  const blocked = nodes.find(node => node?.status === "blocked");
  const done = [...nodes].reverse().find(node => node?.status === "done");
  const running = nodes.find(node => node?.status === "running");
  return asText((failed || blocked || done || running)?.summary);
}

function normalizeStatus(status, fallback = "triage") {
  return TASK_STATUSES.has(status) ? status : fallback;
}

function normalizeSource(source) {
  if (!source) return { type: "manual" };
  if (typeof source === "string") return { type: source };
  const obj = objectOrNull(source) || {};
  return { ...obj, type: asText(obj.type, "manual") };
}

function normalizeAssignee(assignee) {
  if (!assignee) return null;
  if (typeof assignee === "string") return { type: "agent", id: assignee };
  const obj = objectOrNull(assignee) || {};
  const type = asText(obj.type, "agent");
  const id = asText(obj.id || obj.agentId || obj.squadId, null);
  return id ? { ...obj, type, id } : null;
}

export class TaskLedger {
  constructor(options = {}) {
    this._persistencePath = typeof options.persistencePath === "string" ? options.persistencePath : null;
    this._emitEvent = typeof options.emitEvent === "function" ? options.emitEvent : null;
    this._tasks = new Map();
    this._loadPersisted();
  }

  createTask(input = {}) {
    const idempotencyKey = asText(input.idempotencyKey, null);
    if (idempotencyKey) {
      const existing = [...this._tasks.values()].find(task => (
        task.idempotencyKey === idempotencyKey && task.status !== "archived"
      ));
      if (existing) return clone(existing);
    }
    const id = asText(input.id, makeId("task"));
    const createdAt = nowIso();
    const task = {
      id,
      idempotencyKey,
      title: asText(input.title, firstLine(input.goal || input.body || input.intent)),
      body: asText(input.body || input.description, ""),
      goal: asText(input.goal, ""),
      status: normalizeStatus(input.status, "triage"),
      source: normalizeSource(input.source),
      assignee: normalizeAssignee(input.assignee),
      priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
      rootSessionPath: asText(input.rootSessionPath, null),
      cwd: asText(input.cwd, null),
      contextRefs: Array.isArray(input.contextRefs) ? clone(input.contextRefs) : [],
      runIds: [],
      comments: [],
      events: [],
      artifacts: [],
      blockers: [],
      result: "",
      latestSummary: "",
      latestRunId: null,
      latestRunStatus: null,
      currentRunId: null,
      activeWorkerCount: 0,
      currentWorker: null,
      lastHeartbeatAt: null,
      consecutiveFailures: 0,
      lastFailureError: null,
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
    };
    this._tasks.set(id, task);
    this._appendEvent(task, "task.created", `任务已创建：${task.title}`, { source: task.source, status: task.status });
    this._persist();
    this._emit(task);
    return clone(task);
  }

  updateTask(taskId, patch = {}) {
    const task = this._tasks.get(taskId);
    if (!task) return null;
    const previousStatus = task.status;
    if (patch.title !== undefined) task.title = asText(patch.title, task.title);
    if (patch.body !== undefined) task.body = asText(patch.body, "");
    if (patch.goal !== undefined) task.goal = asText(patch.goal, "");
    if (patch.status !== undefined) task.status = normalizeStatus(patch.status, task.status);
    if (patch.assignee !== undefined) task.assignee = normalizeAssignee(patch.assignee);
    if (patch.priority !== undefined && Number.isFinite(patch.priority)) task.priority = Number(patch.priority);
    if (patch.contextRefs !== undefined && Array.isArray(patch.contextRefs)) task.contextRefs = clone(patch.contextRefs);
    task.updatedAt = nowIso();
    if (task.status === "done" && !task.completedAt) task.completedAt = task.updatedAt;
    if (previousStatus !== task.status) {
      this._appendEvent(task, "task.status", `任务状态：${previousStatus} → ${task.status}`, { from: previousStatus, to: task.status });
    } else {
      this._appendEvent(task, "task.updated", "任务已更新");
    }
    this._persist();
    this._emit(task);
    return clone(task);
  }

  attachRun(taskId, runSnapshot) {
    const task = this._tasks.get(taskId);
    if (!task || !runSnapshot?.id) return null;
    if (!task.runIds.includes(runSnapshot.id)) task.runIds.push(runSnapshot.id);
    task.status = RUN_TO_TASK_STATUS[runSnapshot.status] || task.status;
    task.latestRunId = runSnapshot.id;
    task.latestRunStatus = runSnapshot.status || null;
    task.currentRunId = runSnapshot.status === "running" ? runSnapshot.id : null;
    task.updatedAt = nowIso();
    this._appendEvent(task, "run.created", `执行已创建：${runSnapshot.title || runSnapshot.id}`, { runId: runSnapshot.id, runStatus: runSnapshot.status });
    this._persist();
    this._emit(task);
    return clone(task);
  }

  updateRunSnapshot(runSnapshot) {
    const taskId = runSnapshot?.taskId;
    if (!taskId) return null;
    const task = this._tasks.get(taskId);
    if (!task) return null;
    const silent = runSnapshot.silent === true || runSnapshot.suppressEmit === true;
    if (runSnapshot.id && !task.runIds.includes(runSnapshot.id)) task.runIds.push(runSnapshot.id);
    const nextStatus = RUN_TO_TASK_STATUS[runSnapshot.status] || task.status;
    const previousStatus = task.status;
    task.status = nextStatus;
    task.updatedAt = nowIso();
    task.latestRunId = runSnapshot.id || task.latestRunId || null;
    task.latestRunStatus = runSnapshot.status || null;
    task.currentRunId = nextStatus === "running" ? (runSnapshot.id || task.currentRunId || null) : null;
    const nodes = Array.isArray(runSnapshot.nodes) ? runSnapshot.nodes : [];
    const runningNodes = nodes.filter(node => node?.status === "running");
    task.activeWorkerCount = runningNodes.length;
    const latestHeartbeat = nodes
      .map(node => asText(node?.lastHeartbeatAt, null))
      .filter(Boolean)
      .sort()
      .at(-1) || null;
    task.lastHeartbeatAt = latestHeartbeat;
    const currentWorker = runningNodes[0] || null;
    task.currentWorker = currentWorker ? {
      runId: runSnapshot.id || null,
      nodeId: currentWorker.id || null,
      agentId: currentWorker.agentId || null,
      title: currentWorker.title || null,
      sessionPath: currentWorker.sessionPath || null,
      startedAt: currentWorker.startedAt || null,
      claimExpiresAt: currentWorker.claimExpiresAt || null,
      lastHeartbeatAt: currentWorker.lastHeartbeatAt || null,
    } : null;
    const summary = latestRunSummary(runSnapshot);
    if (summary) {
      task.latestSummary = summary;
      if (nextStatus === "done") task.result = summary;
    }
    if (nextStatus === "blocked") {
      const blockedNodes = Array.isArray(runSnapshot.nodes) ? runSnapshot.nodes.filter(node => node?.status === "blocked") : [];
      task.blockers = blockedNodes.map(node => ({
        runId: runSnapshot.id,
        nodeId: node.id,
        agentId: node.agentId,
        reason: asText(node.resultReason || node.summary, "需要人工输入"),
        at: runSnapshot.updatedAt || nowIso(),
      }));
    }
    if (nextStatus === "done" && !task.completedAt) task.completedAt = task.updatedAt;
    if (nextStatus === "done") {
      task.consecutiveFailures = 0;
      task.lastFailureError = null;
    } else if (nextStatus === "failed" && previousStatus !== "failed") {
      task.consecutiveFailures = (Number(task.consecutiveFailures) || 0) + 1;
      task.lastFailureError = summary || asText(runSnapshot.error, "执行失败");
    }

    const artifacts = [];
    for (const node of runSnapshot.nodes || []) {
      for (const artifact of node.artifacts || []) {
        artifacts.push({ runId: runSnapshot.id, nodeId: node.id, artifact });
      }
    }
    if (artifacts.length) task.artifacts = artifacts;

    if (runSnapshot.healthOnly !== true) {
      const type = previousStatus !== task.status ? "task.status" : "run.updated";
      const message = previousStatus !== task.status
        ? `任务状态：${previousStatus} → ${task.status}`
        : `执行更新：${runSnapshot.status}`;
      this._appendEvent(task, type, message, { runId: runSnapshot.id, runStatus: runSnapshot.status });
    }
    this._persist();
    if (!silent) this._emit(task);
    return clone(task);
  }

  mirrorCronJob(job = {}, { agentId = null, state = null } = {}) {
    if (!job?.id) return null;
    const existingId = asText(job.taskLedgerId || job.ledgerTaskId, null);
    const source = { type: "cron", cronJobId: job.id, cronType: job.type || null, agentId: agentId || job.agentId || null };
    const status = state || (job.enabled === false
      ? (job.type === "at" && job.lastRunAt && !(job.consecutiveErrors > 0) ? "done" : "archived")
      : "ready");
    const title = asText(job.label, firstLine(job.prompt, `Cron ${job.id}`));
    let task = existingId ? this._tasks.get(existingId) : null;
    if (!task) task = this._findTaskBySource("cron", { cronJobId: job.id, agentId: source.agentId });

    const payload = {
      cronJobId: job.id,
      cronType: job.type,
      schedule: job.schedule,
      enabled: job.enabled !== false,
      nextRunAt: job.nextRunAt || null,
      lastRunAt: job.lastRunAt || null,
      consecutiveErrors: job.consecutiveErrors || 0,
      model: job.model || null,
    };

    if (!task) {
      task = this.createTask({
        title,
        body: asText(job.prompt, ""),
        status,
        source,
        assignee: source.agentId ? { type: "agent", id: source.agentId } : null,
        contextRefs: [{ type: "cron", jobId: job.id, agentId: source.agentId }],
      });
      task = this._tasks.get(task.id);
    } else {
      const previousStatus = task.status;
      task.title = title;
      task.body = asText(job.prompt, task.body);
      task.status = normalizeStatus(status, task.status);
      task.updatedAt = nowIso();
      if (previousStatus !== task.status) {
        this._appendEvent(task, "task.status", `任务状态：${previousStatus} → ${task.status}`, { from: previousStatus, to: task.status });
      }
    }

    this._appendEvent(task, "cron.updated", `定时任务更新：${job.id}`, payload);
    this._persist();
    this._emit(task);
    return clone(task);
  }

  recordCronRun(job = {}, run = {}, { agentId = null } = {}) {
    const task = this.mirrorCronJob(job, { agentId, state: run.status === "running" ? "running" : undefined });
    if (!task?.id) return null;
    const live = this._tasks.get(task.id);
    const status = asText(run.status, "unknown");
    const failed = status === "error" || status === "failed";
    const skipped = status === "skipped";
    const oneShotFinished = job.type === "at" && status === "success";
    const previousStatus = live.status;
    live.status = failed ? "failed" : skipped ? "ready" : oneShotFinished ? "done" : "ready";
    if (status === "running") live.status = "running";
    live.updatedAt = nowIso();
    if (live.status === "done" && !live.completedAt) live.completedAt = live.updatedAt;
    if (previousStatus !== live.status) {
      this._appendEvent(live, "task.status", `任务状态：${previousStatus} → ${live.status}`, { from: previousStatus, to: live.status });
    }
    const payload = {
      cronJobId: job.id,
      status,
      startedAt: run.startedAt || null,
      finishedAt: run.finishedAt || null,
      error: run.error || null,
      sessionPath: run.sessionPath || null,
      result: run.result || null,
    };
    this._appendEvent(live, "cron.run", `定时任务执行：${status}`, payload);
    if (run.sessionPath || run.summary || run.error) {
      live.comments.push({
        id: makeId("comment"),
        author: "cron",
        body: asText(run.summary || run.error || `Cron run ${status}`),
        channel: "cron",
        meta: payload,
        at: nowIso(),
      });
    }
    this._persist();
    this._emit(live);
    return clone(live);
  }

  mirrorRegistryTask(registryTask = {}) {
    if (!registryTask?.taskId) return null;
    const meta = objectOrNull(registryTask.meta) || {};
    const existingId = asText(registryTask.ledgerTaskId || meta.taskLedgerTaskId, null);
    const status = REGISTRY_TO_TASK_STATUS[registryTask.status] || "running";
    const title = asText(meta.title || meta.summary, `${registryTask.type || "插件"} 任务`);
    const source = {
      type: registryTask.pluginId ? "plugin" : "task_registry",
      registryTaskId: registryTask.taskId,
      registryType: registryTask.type || null,
      pluginId: registryTask.pluginId || null,
    };

    let task = existingId ? this._tasks.get(existingId) : null;
    if (!task) {
      task = this.createTask({
        title,
        body: asText(meta.description || meta.summary, ""),
        status,
        source,
        assignee: registryTask.agentId ? { type: "agent", id: registryTask.agentId } : null,
        rootSessionPath: registryTask.parentSessionPath || null,
        contextRefs: [{ type: "task_registry", taskId: registryTask.taskId }],
      });
      task = this._tasks.get(task.id);
    } else {
      const previousStatus = task.status;
      task.status = status;
      task.updatedAt = nowIso();
      if (status === "done" && !task.completedAt) task.completedAt = task.updatedAt;
      if (previousStatus !== status) {
        this._appendEvent(task, "task.status", `任务状态：${previousStatus} → ${status}`, { from: previousStatus, to: status });
      }
    }

    const payload = {
      registryTaskId: registryTask.taskId,
      registryType: registryTask.type,
      registryStatus: registryTask.status,
      progress: registryTask.progress || null,
      error: registryTask.error || null,
      result: registryTask.result || null,
    };
    this._appendEvent(task, "registry.updated", `注册任务更新：${registryTask.status}`, payload);
    if (registryTask.result !== undefined && registryTask.result !== null) {
      task.artifacts = [{ type: "registry_result", registryTaskId: registryTask.taskId, artifact: clone(registryTask.result) }];
    }
    this._persist();
    this._emit(task);
    return clone(task);
  }

  addComment(taskId, { author = "system", body, channel = null, meta = {} } = {}) {
    const task = this._tasks.get(taskId);
    if (!task) return null;
    const text = asText(body);
    if (!text) throw new Error("TaskLedger.addComment requires body");
    const comment = {
      id: makeId("comment"),
      author: asText(author, "system"),
      body: text,
      channel: channel || null,
      meta: objectOrNull(meta) || {},
      at: nowIso(),
    };
    task.comments.push(comment);
    task.updatedAt = comment.at;
    this._appendEvent(task, "task.comment", "任务新增评论", { commentId: comment.id, author: comment.author, channel: comment.channel });
    this._persist();
    this._emit(task);
    return clone(comment);
  }

  listTasks(filter = {}) {
    return [...this._tasks.values()]
      .filter((task) => {
        if (filter.status && task.status !== filter.status) return false;
        if (filter.sourceType && task.source?.type !== filter.sourceType) return false;
        if (filter.rootSessionPath && task.rootSessionPath !== filter.rootSessionPath) return false;
        return true;
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(clone);
  }

  getTask(taskId) {
    const task = this._tasks.get(taskId);
    return task ? clone(task) : null;
  }

  _findTaskBySource(type, criteria = {}) {
    for (const task of this._tasks.values()) {
      if (task.source?.type !== type) continue;
      let ok = true;
      for (const [key, value] of Object.entries(criteria)) {
        if (value === undefined || value === null) continue;
        if (task.source?.[key] !== value) { ok = false; break; }
      }
      if (ok) return task;
    }
    return null;
  }

  _appendEvent(task, type, message, payload = null) {
    task.events.unshift({
      id: makeId("evt"),
      type,
      message: asText(message, type),
      payload: payload === null ? null : clone(payload),
      at: nowIso(),
    });
    task.events = task.events.slice(0, 120);
  }

  _emit(task) {
    this._emitEvent?.({ type: "task_ledger_update", task: clone(task) }, task.rootSessionPath || null);
  }

  _persist() {
    if (!this._persistencePath) return;
    try {
      fs.mkdirSync(path.dirname(this._persistencePath), { recursive: true });
      fs.writeFileSync(this._persistencePath, JSON.stringify({ tasks: [...this._tasks.values()] }, null, 2));
    } catch (err) {
      console.warn(`[task-ledger] persist failed: ${err.message}`);
    }
  }

  _loadPersisted() {
    if (!this._persistencePath || !fs.existsSync(this._persistencePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this._persistencePath, "utf8"));
      const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
      for (const task of tasks) {
        if (task?.id) this._tasks.set(task.id, task);
      }
    } catch (err) {
      console.warn(`[task-ledger] load failed: ${err.message}`);
    }
  }
}
