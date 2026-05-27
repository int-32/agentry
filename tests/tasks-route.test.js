import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createTasksRoute } from "../server/routes/tasks.js";
import { TaskLedger } from "../lib/task-ledger.js";

function buildApp(engine) {
  const app = new Hono();
  app.route("/api", createTasksRoute(engine));
  return app;
}

describe("tasks route", () => {
  it("auto-starts a coordinator run when a board task is created with autoStart", async () => {
    const ledger = new TaskLedger();
    const createRun = vi.fn((input) => {
      const run = {
        id: "run-board-1",
        taskId: input.taskId,
        title: input.title,
        goal: input.goal,
        status: "running",
        rootSessionPath: input.rootSessionPath,
        cwd: input.cwd,
        createdByAgentId: input.createdByAgentId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: input.nodes.map(node => ({ ...node, status: "running" })),
        edges: [],
        events: [],
      };
      ledger.attachRun(input.taskId, run);
      return run;
    });
    const app = buildApp({
      taskLedger: ledger,
      taskOrchestrator: { createRun },
      listAgents: () => [
        { id: "coder", name: "Coder" },
        { id: "reviewer", name: "Reviewer" },
      ],
      currentSessionPath: "/tmp/root.jsonl",
      cwd: "/tmp/work",
    });

    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "测试任务",
        body: "完成看板自动执行",
        autoStart: true,
        assignee: { type: "agent", id: "coder" },
        selectedAgentIds: ["coder", "reviewer"],
        contextRefs: [{
          type: "task_board",
          boardId: "default-board",
          coordinatorAgentId: "coder",
          selectedAgentIds: ["coder", "reviewer"],
        }],
      }),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.task.status).toBe("running");
    expect(data.task.runIds).toEqual(["run-board-1"]);
    expect(data.run.id).toBe("run-board-1");
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: data.task.id,
      title: "测试任务",
      createdByAgentId: "coder",
      nodes: [
        expect.objectContaining({
          id: "worker-reviewer",
          agentId: "reviewer",
          task: expect.stringContaining("你的 agent：reviewer"),
        }),
        expect.objectContaining({
          id: "main",
          agentId: "coder",
          dependsOn: ["worker-reviewer"],
          task: expect.stringContaining("协作子代理：reviewer"),
        }),
      ],
    }));
  });

  it("keeps manual task creation lightweight unless autoStart is requested", async () => {
    const ledger = new TaskLedger();
    const createRun = vi.fn();
    const app = buildApp({
      taskLedger: ledger,
      taskOrchestrator: { createRun },
      listAgents: () => [{ id: "coder", name: "Coder" }],
    });

    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "只创建", status: "todo" }),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.task.status).toBe("todo");
    expect(data.run).toBeUndefined();
    expect(createRun).not.toHaveBeenCalled();
  });

  it("uses explicit currentSessionPath for rootSessionPath and does not fallback to engine currentSessionPath", async () => {
    const ledger = new TaskLedger();
    const createRun = vi.fn((input) => {
      return {
        id: "run-task-1",
        taskId: input.taskId,
        title: input.title,
        goal: input.goal,
        status: "running",
        rootSessionPath: input.rootSessionPath,
        cwd: input.cwd,
        createdByAgentId: input.createdByAgentId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: input.nodes.map(node => ({ ...node, status: "running" })),
        edges: [],
        events: [],
      };
    });
    const app = buildApp({
      taskLedger: ledger,
      taskOrchestrator: { createRun },
      listAgents: () => [{ id: "coder", name: "Coder" }],
      currentSessionPath: "/tmp/engine-focus.jsonl",
      cwd: "/tmp/work",
    });

    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "带显式会话路径的任务",
        autoStart: true,
        assignee: { type: "agent", id: "coder" },
        currentSessionPath: "/tmp/explicit-session.jsonl",
      }),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      rootSessionPath: "/tmp/explicit-session.jsonl",
    }));
    expect(data.run.rootSessionPath).toBe("/tmp/explicit-session.jsonl");

    const ledgerTask = ledger.getTask(data.task.id);
    expect(ledgerTask?.rootSessionPath).toBe("/tmp/explicit-session.jsonl");
  });

  it("defaults rootSessionPath to null when no explicit session path is provided", async () => {
    const ledger = new TaskLedger();
    const createRun = vi.fn((input) => ({
      id: "run-task-2",
      taskId: input.taskId,
      title: input.title,
      goal: input.goal,
      status: "running",
      rootSessionPath: input.rootSessionPath,
      cwd: input.cwd,
      createdByAgentId: input.createdByAgentId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: input.nodes.map(node => ({ ...node, status: "running" })),
      edges: [],
      events: [],
    }));
    const app = buildApp({
      taskLedger: ledger,
      taskOrchestrator: { createRun },
      listAgents: () => [{ id: "coder", name: "Coder" }],
      currentSessionPath: "/tmp/engine-focus.jsonl",
      cwd: "/tmp/work",
    });

    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "不带会话路径的任务",
        autoStart: true,
        assignee: { type: "agent", id: "coder" },
      }),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      rootSessionPath: null,
    }));
    expect(data.run.rootSessionPath).toBeNull();
    expect(ledger.getTask(data.task.id)?.rootSessionPath).toBeNull();
  });

  it("rejects creating a running task unless creation also starts a run", async () => {
    const ledger = new TaskLedger();
    const createRun = vi.fn();
    const app = buildApp({
      taskLedger: ledger,
      taskOrchestrator: { createRun },
      listAgents: () => [{ id: "coder", name: "Coder" }],
    });

    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "不能伪造运行中", status: "running" }),
    });

    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("autoStart=true");
    expect(ledger.listTasks()).toHaveLength(0);
    expect(createRun).not.toHaveBeenCalled();
  });

  it("starts an existing board task through the task start endpoint", async () => {
    const ledger = new TaskLedger();
    const task = ledger.createTask({
      title: "补启动任务",
      body: "这条任务已经在看板里，但还没有 run。",
      status: "todo",
      assignee: { type: "agent", id: "coder" },
      contextRefs: [{
        type: "task_board",
        boardId: "default-board",
        coordinatorAgentId: "coder",
        selectedAgentIds: ["coder", "writer"],
      }],
    });
    const createRun = vi.fn((input) => {
      const run = {
        id: "run-existing-1",
        taskId: input.taskId,
        title: input.title,
        goal: input.goal,
        status: "running",
        rootSessionPath: input.rootSessionPath,
        cwd: input.cwd,
        createdByAgentId: input.createdByAgentId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: input.nodes.map(node => ({ ...node, status: "running" })),
        edges: [],
        events: [],
      };
      ledger.attachRun(input.taskId, run);
      return run;
    });
    const app = buildApp({
      taskLedger: ledger,
      taskOrchestrator: { createRun },
      listAgents: () => [
        { id: "coder", name: "Coder" },
        { id: "writer", name: "Writer" },
      ],
      currentSessionPath: "/tmp/root.jsonl",
      cwd: "/tmp/work",
    });

    const res = await app.request(`/api/tasks/${task.id}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.task.status).toBe("running");
    expect(data.task.runIds).toEqual(["run-existing-1"]);
    expect(data.run.taskId).toBe(task.id);
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: task.id,
      title: "补启动任务",
      createdByAgentId: "coder",
      nodes: [
        expect.objectContaining({
          id: "worker-writer",
          agentId: "writer",
          task: expect.stringContaining("你的 agent：writer"),
        }),
        expect.objectContaining({
          id: "main",
          agentId: "coder",
          dependsOn: ["worker-writer"],
          task: expect.stringContaining("协作子代理：writer"),
        }),
      ],
    }));
  });

  it("rejects direct running status changes so running only comes from start", async () => {
    const ledger = new TaskLedger();
    const task = ledger.createTask({ title: "不能直接运行", status: "todo" });
    const app = buildApp({
      taskLedger: ledger,
      taskOrchestrator: { createRun: vi.fn() },
      listAgents: () => [{ id: "coder", name: "Coder" }],
    });

    const res = await app.request(`/api/tasks/${task.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "running" }),
    });

    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("/api/tasks/:id/start");
    expect(ledger.getTask(task.id).status).toBe("todo");
  });

  it("returns active workers and task diagnostics for the board", async () => {
    const ledger = new TaskLedger();
    const task = ledger.createTask({
      title: "分配给不存在的 agent",
      status: "ready",
      assignee: { type: "agent", id: "ghost" },
    });
    const app = buildApp({
      taskLedger: ledger,
      taskOrchestrator: {
        listRuns: () => [],
        listActiveWorkers: () => [{
          runId: "run-1",
          taskId: task.id,
          nodeId: "main",
          agentId: "ghost",
          status: "running",
          stale: false,
        }],
      },
      listAgents: () => [{ id: "coder", name: "Coder" }],
    });

    const workersRes = await app.request("/api/tasks/workers/active");
    const workersData = await workersRes.json();
    expect(workersRes.status).toBe(200);
    expect(workersData.workers[0].taskId).toBe(task.id);

    const tasksRes = await app.request("/api/tasks");
    const tasksData = await tasksRes.json();
    expect(tasksRes.status).toBe(200);
    expect(tasksData.tasks[0].diagnostics[0].kind).toBe("agent_missing");

    const diagnosticsRes = await app.request("/api/tasks/diagnostics");
    const diagnosticsData = await diagnosticsRes.json();
    expect(diagnosticsData.count).toBe(1);
    expect(diagnosticsData.diagnostics[0].task.id).toBe(task.id);
  });

  it("inspects runs and reclaims a stale running task", async () => {
    const ledger = new TaskLedger();
    const task = ledger.createTask({ title: "需要回收", status: "running" });
    const cancelRun = vi.fn((runId) => {
      ledger.updateRunSnapshot({ id: runId, taskId: task.id, status: "aborted", nodes: [] });
      return { id: runId, taskId: task.id, status: "aborted", nodes: [], edges: [], events: [] };
    });
    const app = buildApp({
      taskLedger: ledger,
      taskOrchestrator: {
        inspectRun: () => ({ active: false, activeWorkers: [], staleWorkers: [], run: { id: "run-1" } }),
        findActiveRunForTask: () => ({ id: "run-1", taskId: task.id, status: "running" }),
        cancelRun,
        listRuns: () => [],
        listActiveWorkers: () => [],
      },
      listAgents: () => [],
    });

    const inspectRes = await app.request("/api/tasks/runs/run-1/inspect");
    const inspectData = await inspectRes.json();
    expect(inspectRes.status).toBe(200);
    expect(inspectData.inspection.active).toBe(false);

    const reclaimRes = await app.request(`/api/tasks/${task.id}/reclaim`, { method: "POST" });
    const reclaimData = await reclaimRes.json();
    expect(reclaimRes.status).toBe(200);
    expect(reclaimData.task.status).toBe("ready");
    expect(reclaimData.reclaimedRunId).toBe("run-1");
    expect(cancelRun).toHaveBeenCalledWith("run-1", "任务已被回收，等待重新执行");
  });
});
