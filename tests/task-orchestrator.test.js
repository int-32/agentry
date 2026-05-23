import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TaskOrchestrator } from "../lib/task-orchestration/task-orchestrator.js";
import { TaskLedger } from "../lib/task-ledger.js";

function waitFor(predicate, timeoutMs = 500) {
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

describe("TaskOrchestrator", () => {
  it("runs dependency-free nodes in parallel and waits for dependencies", async () => {
    const starts = [];
    const agent = { agentDir: "/tmp/agent-coder" };
    const orchestrator = new TaskOrchestrator({
      listAgents: () => [{ id: "coder", name: "coder" }],
      getAgentById: () => agent,
      getCwd: () => "/tmp/work",
      getCurrentSessionPath: () => "/tmp/session.jsonl",
      emitEvent: () => {},
      executeIsolated: async (prompt, opts) => {
        starts.push(prompt);
        opts.onSessionReady?.(`/tmp/${prompt}.jsonl`);
        await new Promise(resolve => setTimeout(resolve, prompt === "review" ? 1 : 15));
        return { replyText: `${prompt} done`, sessionFiles: [] };
      },
    });

    const run = orchestrator.createRun({
      title: "并发测试",
      nodes: [
        { id: "frontend", title: "Frontend", task: "frontend", agentId: "coder" },
        { id: "backend", title: "Backend", task: "backend", agentId: "coder" },
        { id: "review", title: "Review", task: "review", agentId: "coder", dependsOn: ["frontend", "backend"] },
      ],
    });

    await waitFor(() => orchestrator.getRun(run.id)?.status === "done");
    const finalRun = orchestrator.getRun(run.id);
    expect(finalRun.status).toBe("done");
    expect(finalRun.edges).toEqual([
      { from: "frontend", to: "review", type: "dependency" },
      { from: "backend", to: "review", type: "dependency" },
    ]);
    expect(starts.slice(0, 2).sort()).toEqual(["backend", "frontend"]);
    expect(starts[2]).toContain("review");
    expect(starts[2]).toContain("上游 worker handoff");
    expect(starts[2]).toContain("Frontend");
    expect(starts[2]).toContain("backend done");
    expect(finalRun.nodes.map(n => n.status)).toEqual(["done", "done", "done"]);
  });

  it("rejects invalid dependencies instead of leaving nodes blocked forever", () => {
    const orchestrator = new TaskOrchestrator({
      listAgents: () => [{ id: "coder", name: "coder" }],
      getCwd: () => "/tmp/work",
      getCurrentSessionPath: () => "/tmp/session.jsonl",
      emitEvent: () => {},
    });

    expect(() => orchestrator.createRun({
      title: "坏依赖",
      nodes: [
        { id: "frontend", title: "Frontend", task: "frontend", agentId: "coder", dependsOn: ["missing"] },
      ],
    })).toThrow("Invalid dependencies for frontend: missing");
  });

  it("creates and updates a ledger task for orchestration runs", async () => {
    const ledger = new TaskLedger();
    const agent = { agentDir: "/tmp/agent-coder" };
    const orchestrator = new TaskOrchestrator({
      listAgents: () => [{ id: "coder", name: "coder" }],
      getAgentById: () => agent,
      getCwd: () => "/tmp/work",
      getCurrentSessionPath: () => "/tmp/session.jsonl",
      emitEvent: () => {},
      getTaskLedger: () => ledger,
      executeIsolated: async (prompt, opts) => {
        opts.onSessionReady?.(`/tmp/${prompt}.jsonl`);
        return { replyText: `${prompt} done`, sessionFiles: [{ path: "/tmp/out.txt" }] };
      },
    });

    const run = orchestrator.createRun({
      title: "账本映射",
      goal: "验证 run 挂到 task",
      nodes: [{ id: "one", title: "One", task: "one", agentId: "coder" }],
    });
    expect(run.taskId).toBeTruthy();
    expect(ledger.getTask(run.taskId).runIds).toEqual([run.id]);

    await waitFor(() => orchestrator.getRun(run.id)?.status === "done");
    const finalRun = orchestrator.getRun(run.id);
    expect(finalRun.summary).toContain("one done");
    expect(finalRun.nodes[0].output).toContain("one done");
    const task = ledger.getTask(run.taskId);
    expect(task.status).toBe("done");
    expect(task.latestSummary).toContain("one done");
    expect(task.result).toContain("one done");
    expect(task.artifacts[0].runId).toBe(run.id);
  });

  it("marks a run blocked when a worker returns the task result protocol as blocked", async () => {
    const ledger = new TaskLedger();
    const agent = { agentDir: "/tmp/agent-coder" };
    const orchestrator = new TaskOrchestrator({
      listAgents: () => [{ id: "coder", name: "coder" }],
      getAgentById: () => agent,
      getCwd: () => "/tmp/work",
      getCurrentSessionPath: () => "/tmp/session.jsonl",
      emitEvent: () => {},
      getTaskLedger: () => ledger,
      executeIsolated: async (_prompt, opts) => {
        opts.onSessionReady?.("/tmp/blocked.jsonl");
        return {
          replyText: [
            "需要人工处理。",
            "<task_result status=\"blocked\">",
            "reason: 目标目录没有授权，无法读取项目结构。",
            "summary: 已启动 worker，但需要用户授权目录。",
            "metadata: {\"cwd\":\"/tmp/private\"}",
            "</task_result>",
          ].join("\n"),
          sessionFiles: [],
        };
      },
    });

    const run = orchestrator.createRun({
      title: "阻塞协议",
      goal: "验证 blocked 结果",
      nodes: [{ id: "one", title: "One", task: "one", agentId: "coder" }],
    });

    await waitFor(() => orchestrator.getRun(run.id)?.status === "blocked");
    const finalRun = orchestrator.getRun(run.id);
    expect(finalRun.status).toBe("blocked");
    expect(finalRun.nodes[0].status).toBe("blocked");
    expect(finalRun.nodes[0].summary).toContain("目标目录没有授权");
    expect(finalRun.nodes[0].output).toContain("需要人工处理");
    expect(finalRun.nodes[0].resultMetadata).toContain("/tmp/private");
    expect(ledger.getTask(finalRun.taskId).status).toBe("blocked");
    expect(ledger.getTask(finalRun.taskId).blockers[0].reason).toContain("目标目录没有授权");
  });

  it("lets a worker complete a task through the structured task_complete tool", async () => {
    const ledger = new TaskLedger();
    const agent = { agentDir: "/tmp/agent-coder" };
    const orchestrator = new TaskOrchestrator({
      listAgents: () => [{ id: "coder", name: "coder" }],
      getAgentById: () => agent,
      getCwd: () => "/tmp/work",
      getCurrentSessionPath: () => "/tmp/session.jsonl",
      emitEvent: () => {},
      getTaskLedger: () => ledger,
      executeIsolated: async (_prompt, opts) => {
        const tool = opts.extraTools.find(item => item.name === "task_complete");
        expect(tool).toBeTruthy();
        const result = await tool.execute("call-1", {
          summary: "已读取 package 信息并确认脚本可用",
          metadata: "{\"scripts\":[\"test\",\"build:renderer\"]}",
          artifacts: ["/tmp/package-summary.md"],
        });
        expect(result.details.status).toBe("done");
        return { replyText: "普通收尾回复不应该覆盖结构化结果", sessionFiles: [] };
      },
    });

    const run = orchestrator.createRun({
      title: "工具完成",
      goal: "验证 task_complete",
      nodes: [{ id: "one", title: "One", task: "one", agentId: "coder" }],
    });

    await waitFor(() => orchestrator.getRun(run.id)?.status === "done");
    const finalRun = orchestrator.getRun(run.id);
    expect(finalRun.nodes[0].status).toBe("done");
    expect(finalRun.nodes[0].resultStatus).toBe("done");
    expect(finalRun.nodes[0].summary).toContain("package 信息");
    expect(finalRun.nodes[0].resultMetadata).toContain("build:renderer");
    expect(finalRun.nodes[0].artifacts).toEqual(["/tmp/package-summary.md"]);
    expect(finalRun.nodes[0].output).toContain("普通收尾回复");
    expect(orchestrator.listActiveWorkers()).toEqual([]);
    const task = ledger.getTask(finalRun.taskId);
    expect(task.status).toBe("done");
    expect(task.result).toContain("package 信息");
    expect(task.artifacts[0].artifact).toBe("/tmp/package-summary.md");
  });

  it("lets a worker block a task through the structured task_block tool", async () => {
    const ledger = new TaskLedger();
    const agent = { agentDir: "/tmp/agent-coder" };
    const orchestrator = new TaskOrchestrator({
      listAgents: () => [{ id: "coder", name: "coder" }],
      getAgentById: () => agent,
      getCwd: () => "/tmp/work",
      getCurrentSessionPath: () => "/tmp/session.jsonl",
      emitEvent: () => {},
      getTaskLedger: () => ledger,
      executeIsolated: async (_prompt, opts) => {
        const tool = opts.extraTools.find(item => item.name === "task_block");
        expect(tool).toBeTruthy();
        const result = await tool.execute("call-1", {
          reason: "缺少外部 API token，无法继续验证真实调用。",
          metadata: "{\"missing\":\"API_TOKEN\"}",
        });
        expect(result.details.status).toBe("blocked");
        return { replyText: "等待用户补充 token", sessionFiles: [] };
      },
    });

    const run = orchestrator.createRun({
      title: "工具阻塞",
      goal: "验证 task_block",
      nodes: [{ id: "one", title: "One", task: "one", agentId: "coder" }],
    });

    await waitFor(() => orchestrator.getRun(run.id)?.status === "blocked");
    const finalRun = orchestrator.getRun(run.id);
    expect(finalRun.nodes[0].status).toBe("blocked");
    expect(finalRun.nodes[0].resultStatus).toBe("blocked");
    expect(finalRun.nodes[0].summary).toContain("API token");
    expect(finalRun.nodes[0].resultReason).toContain("API token");
    expect(finalRun.nodes[0].resultMetadata).toContain("API_TOKEN");
    expect(ledger.getTask(finalRun.taskId).status).toBe("blocked");
    expect(ledger.getTask(finalRun.taskId).blockers[0].reason).toContain("API token");
  });

  it("records worker comments and explicit heartbeat progress for task details", async () => {
    const ledger = new TaskLedger();
    const agent = { agentDir: "/tmp/agent-coder" };
    const orchestrator = new TaskOrchestrator({
      taskHeartbeatIntervalMs: 10_000,
      taskClaimTtlMs: 80,
      listAgents: () => [{ id: "coder", name: "coder" }],
      getAgentById: () => agent,
      getCwd: () => "/tmp/work",
      getCurrentSessionPath: () => "/tmp/session.jsonl",
      emitEvent: () => {},
      getTaskLedger: () => ledger,
      executeIsolated: async (_prompt, opts) => {
        const heartbeat = opts.extraTools.find(item => item.name === "task_heartbeat");
        const comment = opts.extraTools.find(item => item.name === "task_comment");
        const complete = opts.extraTools.find(item => item.name === "task_complete");
        expect(heartbeat).toBeTruthy();
        expect(comment).toBeTruthy();
        expect(complete).toBeTruthy();

        const heartbeatResult = await heartbeat.execute("call-heartbeat", { note: "已读取任务输入，正在跑验证。" });
        expect(heartbeatResult.details.heartbeatCount).toBe(1);
        const commentResult = await comment.execute("call-comment", { body: "中间结论：需要保留结构化 handoff。" });
        expect(commentResult.details.commentId).toBeTruthy();
        await complete.execute("call-complete", { summary: "评论和心跳已写入任务详情" });
        return { replyText: "done", sessionFiles: [] };
      },
    });

    const run = orchestrator.createRun({
      title: "进展记录",
      goal: "验证 task_heartbeat 和 task_comment",
      nodes: [{ id: "one", title: "One", task: "one", agentId: "coder" }],
    });

    await waitFor(() => orchestrator.getRun(run.id)?.status === "done");
    const finalRun = orchestrator.getRun(run.id);
    expect(finalRun.nodes[0].heartbeatCount).toBe(1);
    expect(finalRun.nodes[0].lastHeartbeatAt).toBeTruthy();
    expect(finalRun.events.some(event => event.type === "heartbeat" && event.message.includes("正在跑验证"))).toBe(true);
    const task = ledger.getTask(finalRun.taskId);
    expect(task.comments).toHaveLength(1);
    expect(task.comments[0]).toMatchObject({
      author: "coder",
      channel: "task_worker",
      body: "中间结论：需要保留结构化 handoff。",
    });
    expect(task.lastHeartbeatAt).toBe(finalRun.nodes[0].lastHeartbeatAt);
    expect(task.result).toContain("评论和心跳");
  });

  it("persists run handoff details so task drawers survive restart", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentry-task-runs-"));
    const persistencePath = path.join(dir, "task-runs.json");
    const ledger = new TaskLedger();
    const agent = { agentDir: "/tmp/agent-coder" };
    const deps = {
      persistencePath,
      listAgents: () => [{ id: "coder", name: "coder" }],
      getAgentById: () => agent,
      getCwd: () => "/tmp/work",
      getCurrentSessionPath: () => "/tmp/session.jsonl",
      emitEvent: () => {},
      getTaskLedger: () => ledger,
      executeIsolated: async (_prompt, opts) => {
        opts.onSessionReady?.("/tmp/done.jsonl");
        return {
          replyText: [
            "完成了真实检查。",
            "<task_result status=\"done\">",
            "summary: 已完成项目分析，发现 2 个待处理点。",
            "metadata: {\"checks\":2}",
            "</task_result>",
          ].join("\n"),
          sessionFiles: [],
        };
      },
    };
    const orchestrator = new TaskOrchestrator(deps);
    const run = orchestrator.createRun({
      title: "持久化详情",
      nodes: [{ id: "one", title: "One", task: "one", agentId: "coder" }],
    });

    await waitFor(() => orchestrator.getRun(run.id)?.status === "done");
    const restored = new TaskOrchestrator({ ...deps, executeIsolated: undefined });
    const restoredRun = restored.getRun(run.id);
    expect(restoredRun.status).toBe("done");
    expect(restoredRun.summary).toContain("项目分析");
    expect(restoredRun.nodes[0].output).toContain("完成了真实检查");
    expect(restoredRun.nodes[0].resultMetadata).toContain("checks");
  });

  it("tracks active worker heartbeat and run inspection while executing", async () => {
    let resolveWorker;
    const agent = { agentDir: "/tmp/agent-coder" };
    const orchestrator = new TaskOrchestrator({
      taskHeartbeatIntervalMs: 10,
      taskClaimTtlMs: 80,
      listAgents: () => [{ id: "coder", name: "coder" }],
      getAgentById: () => agent,
      getCwd: () => "/tmp/work",
      getCurrentSessionPath: () => "/tmp/session.jsonl",
      emitEvent: () => {},
      executeIsolated: async (_prompt, opts) => {
        opts.onSessionReady?.("/tmp/worker-session.jsonl");
        await new Promise(resolve => { resolveWorker = resolve; });
        return {
          replyText: [
            "<task_result status=\"done\">",
            "summary: heartbeat observed",
            "</task_result>",
          ].join("\n"),
          sessionFiles: [],
        };
      },
    });

    const run = orchestrator.createRun({
      title: "心跳检查",
      nodes: [{ id: "one", title: "One", task: "one", agentId: "coder" }],
    });

    await waitFor(() => orchestrator.listActiveWorkers().length === 1);
    await waitFor(() => (orchestrator.getRun(run.id)?.nodes[0].heartbeatCount || 0) > 0, 1000);
    const [worker] = orchestrator.listActiveWorkers();
    expect(worker.runId).toBe(run.id);
    expect(worker.sessionPath).toBe("/tmp/worker-session.jsonl");
    expect(worker.claimExpiresAt).toBeTruthy();

    const inspection = orchestrator.inspectRun(run.id);
    expect(inspection.active).toBe(true);
    expect(inspection.activeWorkers[0].nodeId).toBe("one");

    resolveWorker();
    await waitFor(() => orchestrator.getRun(run.id)?.status === "done", 1000);
    expect(orchestrator.listActiveWorkers()).toEqual([]);
  });
});
