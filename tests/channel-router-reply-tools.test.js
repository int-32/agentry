import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";

const { runAgentSessionMock, runAgentPhoneSessionMock } = vi.hoisted(() => ({
  runAgentSessionMock: vi.fn(async () => "OK"),
  runAgentPhoneSessionMock: vi.fn(async () => "OK"),
}));

const { callTextMock } = vi.hoisted(() => ({
  callTextMock: vi.fn(async () => "YES"),
}));

vi.mock("../hub/agent-executor.js", () => ({
  runAgentSession: runAgentSessionMock,
  runAgentPhoneSession: runAgentPhoneSessionMock,
}));

vi.mock("../core/llm-client.js", () => ({
  callText: callTextMock,
}));

vi.mock("../lib/debug-log.js", () => ({
  debugLog: () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  createModuleLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { ChannelRouter } from "../hub/channel-router.js";
import { readAgentPhoneProjection, getAgentPhoneProjectionPath } from "../lib/conversations/agent-phone-projection.js";
import { TaskLedger } from "../lib/task-ledger.js";

describe("ChannelRouter reply tool boundary", () => {
  it("runs channel phone delivery with channel-scoped decision tools", async () => {
    runAgentSessionMock.mockClear();
    runAgentPhoneSessionMock.mockClear();
    callTextMock.mockClear();

    const engine = { marker: "engine" };
    const router = new ChannelRouter({
      hub: {
        engine,
        eventBus: { emit: vi.fn() },
      },
    });

    const result = await router._executeReply(
      "hanako",
      "ch_crew",
      "user: @Agentry please reply OK",
    );

    expect(result).toMatchObject({ replied: false, missingDecision: true });
    expect(runAgentPhoneSessionMock).toHaveBeenCalledOnce();
    const options = runAgentPhoneSessionMock.mock.calls[0][2];
    expect(options).toMatchObject({
      engine,
      conversationId: "ch_crew",
      conversationType: "channel",
      toolMode: "read_only",
    });
    expect(options.extraCustomTools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["channel_read_context", "channel_reply", "channel_pass"]),
    );
    expect(callTextMock).not.toHaveBeenCalled();
  });

  it("adds concrete yuan reflection guidance and channel reply range without forcing API budget", async () => {
    runAgentPhoneSessionMock.mockClear();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-channel-phone-prompt-"));
    const channelsDir = path.join(root, "channels");
    fs.mkdirSync(channelsDir, { recursive: true });
    fs.writeFileSync(
      path.join(channelsDir, "ch_crew.md"),
      "---\nid: ch_crew\nmembers: [butter, hanako]\nagentPhoneReplyMinChars: 20\nagentPhoneReplyMaxChars: 80\n---\n",
      "utf-8",
    );
    const router = new ChannelRouter({
      hub: {
        engine: {
          marker: "engine",
          channelsDir,
          getAgent: () => ({ config: { agent: { yuan: "butter" } } }),
        },
        eventBus: { emit: vi.fn() },
      },
    });

    await router._executeReply(
      "butter",
      "ch_crew",
      "user: 大家怎么看？",
    );

    const rounds = runAgentPhoneSessionMock.mock.calls[0][1];
    const phonePrompt = rounds[0].text;
    expect(phonePrompt).not.toContain("<mood>");
    expect(phonePrompt).not.toContain("</mood>");
    expect(phonePrompt).toContain("PULSE");
    expect(phonePrompt).toContain("<pulse>");
    expect(phonePrompt).toContain("20");
    expect(phonePrompt).toContain("80");
    expect(runAgentPhoneSessionMock.mock.calls[0][2]).not.toHaveProperty("maxTokens");

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("guides non-mentioned channel members to avoid stealing an explicit mention", async () => {
    runAgentPhoneSessionMock.mockClear();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-channel-mentioned-prompt-"));
    const channelsDir = path.join(root, "channels");
    const agentsDir = path.join(root, "agents");
    fs.mkdirSync(channelsDir, { recursive: true });
    fs.mkdirSync(path.join(agentsDir, "hana"), { recursive: true });
    fs.mkdirSync(path.join(agentsDir, "yui"), { recursive: true });
    fs.writeFileSync(
      path.join(channelsDir, "ch_crew.md"),
      "---\nid: ch_crew\nmembers: [hana, yui]\n---\n",
      "utf-8",
    );

    const router = new ChannelRouter({
      hub: {
        engine: {
          marker: "engine",
          channelsDir,
          agentsDir,
          getAgent: (id) => ({ id, agentName: id === "yui" ? "Yui" : "Agentry", config: { agent: { yuan: "hanako" } } }),
        },
        eventBus: { emit: vi.fn() },
      },
    });

    await router._executeReply(
      "hana",
      "ch_crew",
      "user: @Yui 可以先看一下吗？",
      { mentionedAgents: ["yui"], mentionTargeted: false },
    );

    const phonePrompt = runAgentPhoneSessionMock.mock.calls[0][1][0].text;
    expect(phonePrompt).toContain("这轮消息明确 @ 了 Yui");
    expect(phonePrompt).toContain("不要抢答");
    expect(phonePrompt).toContain("channel_pass");

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("passes a channel model override into the phone session when enabled", async () => {
    runAgentPhoneSessionMock.mockClear();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-channel-model-override-"));
    const channelsDir = path.join(root, "channels");
    fs.mkdirSync(channelsDir, { recursive: true });
    fs.writeFileSync(
      path.join(channelsDir, "ch_crew.md"),
      [
        "---",
        "id: ch_crew",
        "members: [butter, hanako]",
        "agentPhoneModelOverrideEnabled: true",
        "agentPhoneModelOverrideId: deepseek-v4-flash",
        "agentPhoneModelOverrideProvider: deepseek",
        "---",
        "",
      ].join("\n"),
      "utf-8",
    );
    const router = new ChannelRouter({
      hub: {
        engine: {
          marker: "engine",
          channelsDir,
          getAgent: () => ({ config: { agent: { yuan: "butter" } } }),
        },
        eventBus: { emit: vi.fn() },
      },
    });

    await router._executeReply(
      "butter",
      "ch_crew",
      "user: 大家怎么看？",
    );

    expect(runAgentPhoneSessionMock.mock.calls[0][2]).toMatchObject({
      modelOverride: { id: "deepseek-v4-flash", provider: "deepseek" },
    });

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("passes channel write tool mode into the phone session when enabled", async () => {
    runAgentPhoneSessionMock.mockClear();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-channel-tool-mode-"));
    const channelsDir = path.join(root, "channels");
    fs.mkdirSync(channelsDir, { recursive: true });
    fs.writeFileSync(path.join(channelsDir, "ch_crew.md"), "---\nid: ch_crew\nmembers: [hanako, yui]\nagentPhoneToolMode: write\n---\n", "utf-8");

    const router = new ChannelRouter({
      hub: {
        engine: { marker: "engine", channelsDir },
        eventBus: { emit: vi.fn() },
      },
    });

    await router._executeReply(
      "hanako",
      "ch_crew",
      "user: @Agentry please reply OK",
    );

    expect(runAgentPhoneSessionMock.mock.calls[0][2]).toMatchObject({
      toolMode: "write",
    });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("passes the linked channel project workspace into the phone session", async () => {
    runAgentPhoneSessionMock.mockClear();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-channel-project-workspace-"));
    const channelsDir = path.join(root, "channels");
    const workspaceRoot = path.join(root, "calculator-app");
    fs.mkdirSync(channelsDir, { recursive: true });
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(
      path.join(channelsDir, "ch_calc.md"),
      [
        "---",
        "id: ch_calc",
        "members: [coder, tester]",
        "projectId: prj_calc",
        "projectName: Calculator",
        `projectWorkspaceRoot: ${workspaceRoot}`,
        "projectTestCommand: npm test",
        "---",
        "",
      ].join("\n"),
      "utf-8",
    );

    const router = new ChannelRouter({
      hub: {
        engine: {
          marker: "engine",
          channelsDir,
          getAgent: () => ({ config: { agent: { yuan: "hanako" } } }),
        },
        eventBus: { emit: vi.fn() },
      },
    });

    await router._executeReply(
      "coder",
      "ch_calc",
      "user: 请实现计算器页面。",
    );

    const rounds = runAgentPhoneSessionMock.mock.calls[0][1];
    const options = runAgentPhoneSessionMock.mock.calls[0][2];
    expect(rounds[0].text).toContain(workspaceRoot);
    expect(rounds[0].text).toContain("npm test");
    expect(options).toMatchObject({ workspaceRoot });

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("persists channel discussion follow-up tasks into TaskLedger", async () => {
    runAgentSessionMock.mockClear();
    runAgentPhoneSessionMock.mockClear();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-channel-task-ledger-"));
    const channelsDir = path.join(root, "channels");
    const agentsDir = path.join(root, "agents");
    const userDir = path.join(root, "user");
    const productDir = path.join(root, "product");
    const workspaceRoot = path.join(root, "calculator-app");
    fs.mkdirSync(path.join(agentsDir, "coder"), { recursive: true });
    fs.mkdirSync(channelsDir, { recursive: true });
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(path.join(productDir, "yuan"), { recursive: true });
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "coder", "config.yaml"), "agent:\n  name: Coder\n", "utf-8");
    fs.writeFileSync(
      path.join(channelsDir, "ch_calc.md"),
      [
        "---",
        "id: ch_calc",
        "members: [coder, reviewer]",
        "projectId: prj_calc",
        "projectName: Calculator",
        `projectWorkspaceRoot: ${workspaceRoot}`,
        "---",
        "",
      ].join("\n"),
      "utf-8",
    );
    const ledgerPath = path.join(root, "task-ledger.json");
    const ledger = new TaskLedger({ persistencePath: ledgerPath });
    const createRun = vi.fn();

    runAgentPhoneSessionMock.mockImplementationOnce(async (_agentId, _rounds, options) => {
      const taskTool = options.extraCustomTools.find((tool) => tool.name === "channel_task_create");
      const replyTool = options.extraCustomTools.find((tool) => tool.name === "channel_reply");
      expect(taskTool).toBeTruthy();
      const result = await taskTool.execute("task-call-1", {
        title: "修复 file 打开后按钮无响应",
        body: "频道确认页面直接打开后点击数字显示不变，需要回修并验证。",
        autoStart: true,
      });
      expect(result.details.autoStartBlockedByToolMode).toBe(true);
      await replyTool.execute("reply-call-1", { content: "已保存回修任务到看板。" });
      return "";
    });

    const router = new ChannelRouter({
      hub: {
        engine: {
          channelsDir,
          agentsDir,
          userDir,
          productDir,
          taskLedger: ledger,
          taskOrchestrator: { createRun },
          isChannelsEnabled: () => true,
          getHomeCwd: () => root,
          listAgents: () => [
            { id: "coder", name: "Coder" },
            { id: "reviewer", name: "Reviewer" },
          ],
          getAgent: (id) => ({ id, agentName: id, config: { agent: { name: id } } }),
        },
        eventBus: { emit: vi.fn() },
      },
    });

    await router._executeCheck(
      "coder",
      "ch_calc",
      [{ sender: "user", timestamp: "2026-05-28 11:29:37", body: "现在点击数字计算器上面的信息都不变" }],
      [],
    );

    const tasks = ledger.listTasks({ sourceType: "channel" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: "修复 file 打开后按钮无响应",
      status: "ready",
      source: {
        type: "channel",
        channelName: "ch_calc",
        toolName: "channel_task_create",
        agentId: "coder",
      },
      cwd: workspaceRoot,
      assignee: { type: "agent", id: "coder" },
      idempotencyKey: "channel:ch_calc:task-call-1",
    });
    expect(tasks[0].contextRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "task_board", boardId: "default-board" }),
      expect.objectContaining({ type: "channel", channelName: "ch_calc", projectId: "prj_calc" }),
    ]));
    expect(createRun).not.toHaveBeenCalled();
    expect(new TaskLedger({ persistencePath: ledgerPath }).listTasks({ sourceType: "channel" })).toHaveLength(1);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("uses a bound task board as the channel task execution domain", async () => {
    runAgentPhoneSessionMock.mockClear();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-channel-task-board-"));
    const channelsDir = path.join(root, "channels");
    const agentsDir = path.join(root, "agents");
    const userDir = path.join(root, "user");
    const productDir = path.join(root, "product");
    fs.mkdirSync(path.join(agentsDir, "coder"), { recursive: true });
    fs.mkdirSync(path.join(agentsDir, "reviewer"), { recursive: true });
    fs.mkdirSync(channelsDir, { recursive: true });
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(path.join(productDir, "yuan"), { recursive: true });
    fs.writeFileSync(
      path.join(channelsDir, "ch_calc.md"),
      [
        "---",
        "id: ch_calc",
        "members: [coder, reviewer]",
        "agentPhoneToolMode: write",
        "taskBoardId: board_calc",
        "taskBoardTitle: Calculator",
        "taskBoardCoordinatorAgentId: reviewer",
        "taskBoardSelectedAgentIds: [reviewer, coder]",
        "---",
        "",
      ].join("\n"),
      "utf-8",
    );
    const ledger = new TaskLedger({ persistencePath: path.join(root, "task-ledger.json") });
    const createRun = vi.fn((input) => ({ id: "run-bound", taskId: input.taskId, status: "running", nodes: input.nodes, edges: [] }));

    runAgentPhoneSessionMock.mockImplementationOnce(async (_agentId, _rounds, options) => {
      const taskTool = options.extraCustomTools.find((tool) => tool.name === "channel_task_create");
      const result = await taskTool.execute("task-call-bound", {
        title: "实现计算器按键反馈",
        body: "频道确认需要修复按键反馈。",
      });
      expect(result.details).toMatchObject({
        taskBoardBound: true,
        taskBoardId: "board_calc",
        autoStartRequestedByTaskBoardBinding: true,
        autoStart: true,
      });
      return "";
    });

    const router = new ChannelRouter({
      hub: {
        engine: {
          channelsDir,
          agentsDir,
          userDir,
          productDir,
          taskLedger: ledger,
          taskOrchestrator: { createRun },
          isChannelsEnabled: () => true,
          getHomeCwd: () => root,
          listAgents: () => [
            { id: "coder", name: "Coder" },
            { id: "reviewer", name: "Reviewer" },
          ],
          getAgent: (id) => ({ id, agentName: id, config: { agent: { name: id } } }),
        },
        eventBus: { emit: vi.fn() },
      },
    });

    await router._executeCheck(
      "coder",
      "ch_calc",
      [{ sender: "user", timestamp: "2026-05-28 12:00:00", body: "这个需要有人做掉" }],
      [],
    );

    const tasks = ledger.listTasks({ sourceType: "channel" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      assignee: { type: "agent", id: "reviewer" },
    });
    expect(tasks[0].contextRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "task_board",
        boardId: "board_calc",
        boardTitle: "Calculator",
        coordinatorAgentId: "reviewer",
        selectedAgentIds: ["reviewer", "coder"],
      }),
    ]));
    expect(createRun).toHaveBeenCalledOnce();
    expect(createRun.mock.calls[0][0].nodes.map((node) => node.agentId)).toEqual(["coder", "reviewer"]);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("emits a complete incremental message from the channel_reply tool, not raw model text", async () => {
    runAgentSessionMock.mockClear();
    runAgentPhoneSessionMock.mockClear();
    runAgentPhoneSessionMock.mockImplementationOnce(async (_agentId, _rounds, options) => {
      const replyTool = options.extraCustomTools.find((tool) => tool.name === "channel_reply");
      await replyTool.execute("tool-call-1", {
        mood: "我想接一下这个球。",
        content: "工具发出的 OK",
      });
      return "RAW MODEL TEXT SHOULD NOT BE POSTED";
    });

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-channel-router-"));
    const channelsDir = path.join(root, "channels");
    const agentsDir = path.join(root, "agents");
    const userDir = path.join(root, "user");
    const productDir = path.join(root, "product");
    fs.mkdirSync(path.join(agentsDir, "hanako"), { recursive: true });
    fs.mkdirSync(channelsDir, { recursive: true });
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(path.join(productDir, "yuan"), { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "hanako", "config.yaml"), "agent:\n  name: Agentry\n", "utf-8");
    fs.writeFileSync(path.join(channelsDir, "ch_crew.md"), "---\nid: ch_crew\nmembers: [hanako]\n---\n", "utf-8");

    const emit = vi.fn();
    const router = new ChannelRouter({
      hub: {
        engine: {
          channelsDir,
          agentsDir,
          userDir,
          productDir,
          isChannelsEnabled: () => true,
        },
        eventBus: { emit },
      },
    });

    const result = await router._executeCheck(
      "hanako",
      "ch_crew",
      [{ sender: "user", timestamp: "2026-05-07 17:00:00", body: "@Agentry ping" }],
      [],
    );

    expect(result.replied).toBe(true);
    expect(result.replyContent).toBe("工具发出的 OK");
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "channel_new_message",
      channelName: "ch_crew",
      sender: "hanako",
      message: expect.objectContaining({
        sender: "hanako",
        body: "工具发出的 OK",
      }),
    }), null);
    expect(emit.mock.calls[0][0].message.timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(fs.readFileSync(path.join(channelsDir, "ch_crew.md"), "utf-8")).toContain("工具发出的 OK");
    expect(fs.readFileSync(path.join(channelsDir, "ch_crew.md"), "utf-8")).not.toContain("RAW MODEL TEXT SHOULD NOT BE POSTED");
  });

  it("treats channel_pass as an explicit viewed-without-reply decision", async () => {
    runAgentSessionMock.mockClear();
    runAgentPhoneSessionMock.mockClear();
    runAgentPhoneSessionMock.mockImplementationOnce(async (_agentId, _rounds, options) => {
      const passTool = options.extraCustomTools.find((tool) => tool.name === "channel_pass");
      await passTool.execute("tool-call-1", {
        mood: "这个话题别人已经接住了。",
        reason: "没有新的补充",
      });
      return "RAW MODEL TEXT SHOULD NOT BE POSTED";
    });

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-channel-pass-"));
    const channelsDir = path.join(root, "channels");
    const agentsDir = path.join(root, "agents");
    const userDir = path.join(root, "user");
    const productDir = path.join(root, "product");
    fs.mkdirSync(path.join(agentsDir, "hanako"), { recursive: true });
    fs.mkdirSync(channelsDir, { recursive: true });
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(path.join(productDir, "yuan"), { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "hanako", "config.yaml"), "agent:\n  name: Agentry\n", "utf-8");
    fs.writeFileSync(path.join(channelsDir, "ch_crew.md"), "---\nid: ch_crew\nmembers: [hanako]\n---\n", "utf-8");

    const emit = vi.fn();
    const activityRecord = vi.fn();
    const router = new ChannelRouter({
      hub: {
        engine: {
          channelsDir,
          agentsDir,
          userDir,
          productDir,
          isChannelsEnabled: () => true,
        },
        eventBus: { emit },
        agentPhoneActivities: { record: activityRecord },
      },
    });

    const result = await router._executeCheck(
      "hanako",
      "ch_crew",
      [{ sender: "user", timestamp: "2026-05-07 17:00:00", body: "谁想接一下？" }],
      [],
    );

    expect(result).toMatchObject({ replied: false, passed: true });
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: "channel_new_message" }), null);
    expect(activityRecord.mock.calls.map((call) => call[0].state)).toContain("no_reply");
    expect(fs.readFileSync(path.join(channelsDir, "ch_crew.md"), "utf-8")).not.toContain("RAW MODEL TEXT SHOULD NOT BE POSTED");

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("records per-agent phone activity while processing channel messages", async () => {
    runAgentSessionMock.mockClear();
    runAgentPhoneSessionMock.mockClear();
    runAgentPhoneSessionMock.mockImplementationOnce(async (_agentId, _rounds, options) => {
      const replyTool = options.extraCustomTools.find((tool) => tool.name === "channel_reply");
      await replyTool.execute("tool-call-1", { content: "OK" });
      return "";
    });

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-channel-phone-"));
    const channelsDir = path.join(root, "channels");
    const agentsDir = path.join(root, "agents");
    const userDir = path.join(root, "user");
    const productDir = path.join(root, "product");
    const agentDir = path.join(agentsDir, "hanako");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.mkdirSync(channelsDir, { recursive: true });
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(path.join(productDir, "yuan"), { recursive: true });
    fs.writeFileSync(path.join(agentDir, "config.yaml"), "agent:\n  name: Agentry\n", "utf-8");
    fs.writeFileSync(path.join(channelsDir, "ch_crew.md"), "---\nid: ch_crew\nmembers: [hanako, yui]\n---\n", "utf-8");

    const activityRecord = vi.fn();
    const router = new ChannelRouter({
      hub: {
        engine: {
          channelsDir,
          agentsDir,
          userDir,
          productDir,
          isChannelsEnabled: () => true,
          getAgent: () => ({ agentDir, config: { agent: { name: "Agentry" } }, personality: "I am Agentry" }),
        },
        eventBus: { emit: vi.fn() },
        agentPhoneActivities: { record: activityRecord },
      },
    });

    await router._executeCheck(
      "hanako",
      "ch_crew",
      [{ sender: "user", timestamp: "2026-05-07 17:00:00", body: "@Agentry ping" }],
      [],
    );

    expect(activityRecord.mock.calls.map((call) => call[0].state)).toEqual(
      expect.arrayContaining(["viewed", "replying", "idle"]),
    );

    const projection = readAgentPhoneProjection(getAgentPhoneProjectionPath(agentDir, "ch_crew"));
    expect(projection.meta).toMatchObject({
      agentId: "hanako",
      conversationId: "ch_crew",
      conversationType: "channel",
      state: "idle",
    });
    expect(projection.activities.map((activity) => activity.state)).toEqual(
      expect.arrayContaining(["viewed", "replying", "idle"]),
    );

    fs.rmSync(root, { recursive: true, force: true });
  });
});
