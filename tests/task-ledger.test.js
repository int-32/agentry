import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { TaskLedger } from "../lib/task-ledger.js";

describe("TaskLedger", () => {
  it("creates durable task records with events and comments", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentry-ledger-"));
    const persistencePath = path.join(dir, "task-ledger.json");
    const emitted = [];
    const ledger = new TaskLedger({
      persistencePath,
      emitEvent: (event, sessionPath) => emitted.push({ event, sessionPath }),
    });

    const task = ledger.createTask({
      title: "研究任务模型",
      goal: "比较外部看板系统",
      status: "triage",
      source: { type: "chat", messageId: "m1" },
      rootSessionPath: "/tmp/session.jsonl",
    });
    expect(task.status).toBe("triage");
    expect(task.source).toEqual({ type: "chat", messageId: "m1" });
    expect(task.events[0].type).toBe("task.created");

    const comment = ledger.addComment(task.id, { author: "user", body: "继续拆解", channel: "bridge" });
    expect(comment.body).toBe("继续拆解");
    expect(ledger.getTask(task.id).comments).toHaveLength(1);
    expect(emitted.at(-1).sessionPath).toBe("/tmp/session.jsonl");

    const restored = new TaskLedger({ persistencePath });
    expect(restored.getTask(task.id).comments[0].body).toBe("继续拆解");
  });

  it("maps run snapshots back to task status and artifacts", () => {
    const ledger = new TaskLedger();
    const task = ledger.createTask({ title: "执行图", status: "running" });
    ledger.attachRun(task.id, { id: "run-1", title: "执行图", status: "running" });
    expect(ledger.getTask(task.id).runIds).toEqual(["run-1"]);

    ledger.updateRunSnapshot({
      id: "run-1",
      taskId: task.id,
      status: "done",
      nodes: [{ id: "n1", artifacts: [{ path: "/tmp/a.txt" }] }],
    });
    const finalTask = ledger.getTask(task.id);
    expect(finalTask.status).toBe("done");
    expect(finalTask.artifacts).toEqual([{ runId: "run-1", nodeId: "n1", artifact: { path: "/tmp/a.txt" } }]);
  });

  it("preserves scheduled task status", () => {
    const ledger = new TaskLedger();
    const task = ledger.createTask({ title: "等待明天继续", status: "scheduled" });
    expect(task.status).toBe("scheduled");

    const updated = ledger.updateTask(task.id, { status: "scheduled" });
    expect(updated.status).toBe("scheduled");
  });

  it("keeps task creation idempotent when a key is provided", () => {
    const ledger = new TaskLedger();
    const first = ledger.createTask({ title: "创建一次", idempotencyKey: "chat-call-1" });
    const second = ledger.createTask({ title: "重复调用", idempotencyKey: "chat-call-1" });

    expect(second.id).toBe(first.id);
    expect(second.title).toBe("创建一次");
    expect(ledger.listTasks()).toHaveLength(1);
  });

  it("updates run health without spamming task events", () => {
    const ledger = new TaskLedger();
    const task = ledger.createTask({ title: "心跳任务", status: "running" });
    ledger.attachRun(task.id, { id: "run-1", title: "心跳任务", status: "running" });
    const beforeEvents = ledger.getTask(task.id).events.length;

    ledger.updateRunSnapshot({
      id: "run-1",
      taskId: task.id,
      status: "running",
      healthOnly: true,
      nodes: [{
        id: "main",
        title: "Main",
        agentId: "coder",
        status: "running",
        sessionPath: "/tmp/session.jsonl",
        startedAt: "2026-05-22T00:00:00.000Z",
        lastHeartbeatAt: "2026-05-22T00:00:03.000Z",
        claimExpiresAt: "2026-05-22T00:00:48.000Z",
      }],
    });

    const updated = ledger.getTask(task.id);
    expect(updated.events).toHaveLength(beforeEvents);
    expect(updated.activeWorkerCount).toBe(1);
    expect(updated.lastHeartbeatAt).toBe("2026-05-22T00:00:03.000Z");
    expect(updated.currentWorker.agentId).toBe("coder");
  });

  it("can silently sync run snapshots during startup restore", () => {
    const emitted = [];
    const ledger = new TaskLedger({
      emitEvent: (event, sessionPath) => emitted.push({ event, sessionPath }),
    });
    const task = ledger.createTask({ title: "恢复任务", status: "running" });
    emitted.length = 0;

    ledger.updateRunSnapshot({
      id: "run-restore",
      taskId: task.id,
      status: "blocked",
      healthOnly: true,
      silent: true,
      nodes: [{ id: "main", status: "blocked", resultReason: "服务重启" }],
    });

    const updated = ledger.getTask(task.id);
    expect(updated.status).toBe("blocked");
    expect(updated.runIds).toContain("run-restore");
    expect(emitted).toHaveLength(0);
  });
});
