import { describe, expect, it, vi } from "vitest";
import { TaskLedger } from "../lib/task-ledger.js";
import { TaskOrchestrator } from "../lib/task-orchestration/task-orchestrator.js";
import { createTaskCreateTool } from "../lib/tools/task-create-tool.js";

const mockCtx = (sessionPath = "/test/session.jsonl", cwd = "/test/workspace") => ({
  sessionManager: {
    getSessionFile: () => sessionPath,
    getCwd: () => cwd,
  },
});

function waitFor(predicate, timeoutMs = 800) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("timeout"));
      setTimeout(tick, 5);
    };
    tick();
  });
}

describe("task_create tool", () => {
  it("creates a board task and starts a coordinator run by default", async () => {
    const ledger = new TaskLedger();
    const createRun = vi.fn((input) => {
      const run = {
        id: "run-chat-1",
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
    const tool = createTaskCreateTool({
      getTaskLedger: () => ledger,
      getTaskOrchestrator: () => ({ createRun, findActiveRunForTask: () => null }),
      listAgents: () => [
        { id: "coder", name: "Coder" },
        { id: "reviewer", name: "Reviewer" },
      ],
      currentAgentId: "coder",
    });

    const result = await tool.execute("call-task-1", {
      title: "实现对话创建任务",
      body: "像 Hermes 一样从 agent tool 创建并执行看板任务。",
      boardId: "project-alpha",
      boardTitle: "项目 Alpha",
      selectedAgentIds: ["coder", "reviewer"],
    }, null, null, mockCtx());

    expect(result.details.taskId).toBeTruthy();
    expect(result.details.runId).toBe("run-chat-1");
    expect(result.details.status).toBe("running");
    const task = ledger.getTask(result.details.taskId);
    expect(task).toMatchObject({
      title: "实现对话创建任务",
      status: "running",
      source: {
        type: "chat",
        channel: "agent_tool",
        toolName: "task_create",
        agentId: "coder",
        toolCallId: "call-task-1",
      },
      assignee: { type: "agent", id: "coder" },
      rootSessionPath: "/test/session.jsonl",
      cwd: "/test/workspace",
      idempotencyKey: "tool:call-task-1",
    });
    expect(task.contextRefs[0]).toMatchObject({
      type: "task_board",
      boardId: "project-alpha",
      boardTitle: "项目 Alpha",
      coordinatorAgentId: "coder",
      selectedAgentIds: ["coder", "reviewer"],
    });
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: task.id,
      title: "实现对话创建任务",
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

  it("can create a lightweight board card without starting execution", async () => {
    const ledger = new TaskLedger();
    const createRun = vi.fn();
    const tool = createTaskCreateTool({
      getTaskLedger: () => ledger,
      getTaskOrchestrator: () => ({ createRun }),
      listAgents: () => [{ id: "coder", name: "Coder" }],
      currentAgentId: "coder",
    });

    const result = await tool.execute("call-task-2", {
      title: "稍后处理",
      status: "todo",
      autoStart: false,
    }, null, null, mockCtx());

    expect(result.details.autoStart).toBe(false);
    expect(result.details.runId).toBeNull();
    expect(ledger.getTask(result.details.taskId).status).toBe("todo");
    expect(createRun).not.toHaveBeenCalled();
  });

  it("uses the tool call id as a default idempotency key", async () => {
    const ledger = new TaskLedger();
    const tool = createTaskCreateTool({
      getTaskLedger: () => ledger,
      getTaskOrchestrator: () => ({
        findActiveRunForTask: () => null,
        createRun: (input) => {
          const run = {
            id: `run-${input.taskId}`,
            taskId: input.taskId,
            title: input.title,
            status: "running",
            nodes: input.nodes.map(node => ({ ...node, status: "running" })),
            edges: [],
            events: [],
          };
          ledger.attachRun(input.taskId, run);
          return run;
        },
      }),
      listAgents: () => [{ id: "coder", name: "Coder" }],
      currentAgentId: "coder",
    });

    const first = await tool.execute("same-call", { title: "不要重复创建" }, null, null, mockCtx());
    const second = await tool.execute("same-call", { title: "不要重复创建" }, null, null, mockCtx());

    expect(first.details.taskId).toBe(second.details.taskId);
    expect(ledger.listTasks()).toHaveLength(1);
  });

  it("starts selected collaborator agents as real worker nodes and lets the coordinator finish after handoff", async () => {
    const ledger = new TaskLedger();
    const calls = [];
    const agents = [
      { id: "coder", name: "Coder", agentDir: "/tmp/agent-coder" },
      { id: "reviewer", name: "Reviewer", agentDir: "/tmp/agent-reviewer" },
    ];
    const orchestrator = new TaskOrchestrator({
      listAgents: () => agents,
      getAgentById: (id) => agents.find(agent => agent.id === id),
      getTaskLedger: () => ledger,
      getCwd: () => "/test/workspace",
      getCurrentSessionPath: () => "/test/session.jsonl",
      emitEvent: () => {},
      executeIsolated: async (prompt, opts) => {
        calls.push({ agentId: opts.agentId, prompt });
        const complete = opts.extraTools.find(tool => tool.name === "task_complete");
        expect(complete).toBeTruthy();
        if (opts.agentId === "reviewer") {
          await complete.execute("review-done", {
            summary: "reviewer 已完成独立检查",
            metadata: "{\"checked\":true}",
          });
          return { replyText: "reviewer output", sessionFiles: [] };
        }
        expect(prompt).toContain("上游 worker handoff");
        expect(prompt).toContain("reviewer 已完成独立检查");
        await complete.execute("main-done", {
          summary: "主代理已汇总 reviewer 结果并完成任务",
          metadata: "{\"coordinated\":true}",
        });
        return { replyText: "coordinator output", sessionFiles: [] };
      },
    });
    const tool = createTaskCreateTool({
      getTaskLedger: () => ledger,
      getTaskOrchestrator: () => orchestrator,
      listAgents: () => agents,
      currentAgentId: "coder",
    });

    const result = await tool.execute("call-task-graph", {
      title: "验证子代理自动完成",
      body: "创建任务后 reviewer 先执行，coder 汇总。",
      selectedAgentIds: ["coder", "reviewer"],
    }, null, null, mockCtx());

    await waitFor(() => ledger.getTask(result.details.taskId)?.status === "done");
    const run = orchestrator.getRun(result.details.runId);
    expect(run.status).toBe("done");
    expect(run.nodes.map(node => [node.id, node.agentId, node.status])).toEqual([
      ["worker-reviewer", "reviewer", "done"],
      ["main", "coder", "done"],
    ]);
    expect(calls.map(call => call.agentId)).toEqual(["reviewer", "coder"]);
    expect(ledger.getTask(result.details.taskId).result).toContain("主代理已汇总");
  });
});
