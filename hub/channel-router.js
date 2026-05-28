/**
 * ChannelRouter — 频道调度（从 engine.js 搬出）
 *
 * 频道 = 内部 Channel，和 Telegram/飞书一样通过 Hub 路由。
 * 包装 channel-ticker（不改 ticker，只提供回调）。
 *
 * 搬出的方法：
 *   _getChannelAgentOrder  → getAgentOrder()
 *   _executeChannelCheck   → _executeCheck()
 *   _executeChannelReply   → _executeReply()
 *   _channelMemorySummarize → _memorySummarize()
 *   _setupChannelPostHandler → setupPostHandler()
 *   toggleChannels          → toggle()
 */

import fs from "fs";
import path from "path";
import { createChannelTicker } from "../lib/channels/channel-ticker.js";
import { Type } from "../lib/pi-sdk/index.js";
import { appendMessage, formatMessagesForLLM, getChannelMeta, getRecentMessages } from "../lib/channels/channel-store.js";
import { extractMentionedAgentIds } from "../lib/channels/channel-mentions.js";
import { loadConfig } from "../lib/memory/config-loader.js";
import { callText } from "../core/llm-client.js";
import { runAgentPhoneSession } from "./agent-executor.js";
import { debugLog } from "../lib/debug-log.js";
import { getLocale } from "../server/i18n.js";
import { createTaskCreateTool } from "../lib/tools/task-create-tool.js";
import {
  getAgentPhoneProjectionPath,
  readAgentPhoneProjection,
  recordAgentPhoneActivity,
} from "../lib/conversations/agent-phone-projection.js";
import { normalizeAgentPhoneToolMode } from "../lib/conversations/agent-phone-session.js";
import {
  DEFAULT_AGENT_PHONE_SETTINGS,
  formatAgentPhonePromptGuidance,
  normalizeAgentPhoneModelOverride,
  positiveIntegerOrDefault,
  positiveIntegerOrNull,
} from "../lib/conversations/agent-phone-prompt.js";

export class ChannelRouter {
  /**
   * @param {object} opts
   * @param {import('./index.js').Hub} opts.hub
   */
  static _AGENT_ORDER_TTL = 30_000; // 30 秒

  constructor({ hub }) {
    this._hub = hub;
    this._ticker = null;
    this._agentOrderCache = null; // { list: string[], ts: number }
  }

  /** @returns {import('../core/engine.js').AgentryEngine} */
  get _engine() { return this._hub.engine; }

  _getAgentInstance(agentId) {
    return this._engine.getAgent?.(agentId)
      || this._engine.agents?.get?.(agentId)
      || null;
  }

  _resolveMemoryMasterEnabled(agentId, { agentInstance = null, cfg = null } = {}) {
    if (agentInstance) return agentInstance.memoryMasterEnabled !== false;
    const resolvedCfg = cfg || loadConfig(path.join(this._engine.agentsDir, agentId, "config.yaml"));
    return resolvedCfg?.memory?.enabled !== false;
  }

  async _recordPhoneActivity(agentId, channelName, state, summary, details = {}) {
    try {
      const agent = this._getAgentInstance(agentId);
      const agentDir = agent?.agentDir || path.join(this._engine.agentsDir, agentId);
      const activity = {
        conversationId: channelName,
        conversationType: "channel",
        agentId,
        state,
        summary,
        details,
      };
      this._hub.agentPhoneActivities?.record?.(activity);
      await recordAgentPhoneActivity({
        agentDir,
        ...activity,
      });
    } catch (err) {
      debugLog()?.warn?.("channel", `phone activity record failed (${agentId}/#${channelName}): ${err.message}`);
    }
  }

  _resolvePhoneToolMode(channelName) {
    try {
      const filePath = path.join(this._engine.channelsDir, `${channelName}.md`);
      if (!fs.existsSync(filePath)) return "read_only";
      return normalizeAgentPhoneToolMode(getChannelMeta(filePath).agentPhoneToolMode);
    } catch {
      return "read_only";
    }
  }

  _resolveChannelPhoneSettings(channelName) {
    try {
      const filePath = path.join(this._engine.channelsDir, `${channelName}.md`);
      if (!fs.existsSync(filePath)) {
        return DEFAULT_AGENT_PHONE_SETTINGS;
      }
      const meta = getChannelMeta(filePath);
      const override = normalizeAgentPhoneModelOverride({
        enabled: meta.agentPhoneModelOverrideEnabled,
        id: meta.agentPhoneModelOverrideId,
        provider: meta.agentPhoneModelOverrideProvider,
      });
      return {
        toolMode: normalizeAgentPhoneToolMode(meta.agentPhoneToolMode),
        replyMinChars: positiveIntegerOrNull(meta.agentPhoneReplyMinChars),
        replyMaxChars: positiveIntegerOrNull(meta.agentPhoneReplyMaxChars),
        reminderIntervalMinutes: positiveIntegerOrDefault(
          meta.agentPhoneReminderIntervalMinutes,
          DEFAULT_AGENT_PHONE_SETTINGS.reminderIntervalMinutes,
        ),
        modelOverrideEnabled: override.enabled,
        modelOverrideModel: override.model,
      };
    } catch {
      return DEFAULT_AGENT_PHONE_SETTINGS;
    }
  }

  _resolveChannelProject(channelName) {
    try {
      const filePath = path.join(this._engine.channelsDir || "", `${channelName}.md`);
      if (!fs.existsSync(filePath)) return null;
      const meta = getChannelMeta(filePath);
      const id = typeof meta.projectId === "string" ? meta.projectId.trim() : "";
      if (!id) return null;
      return {
        id,
        name: typeof meta.projectName === "string" ? meta.projectName.trim() : "",
        workspaceRoot: typeof meta.projectWorkspaceRoot === "string" ? meta.projectWorkspaceRoot.trim() : "",
        docsRoot: typeof meta.projectDocsRoot === "string" ? meta.projectDocsRoot.trim() : "",
        testCommand: typeof meta.projectTestCommand === "string" ? meta.projectTestCommand.trim() : "",
        description: typeof meta.projectDescription === "string" ? meta.projectDescription.trim() : "",
      };
    } catch {
      return null;
    }
  }

  _resolveChannelTaskBoard(channelName) {
    try {
      const filePath = path.join(this._engine.channelsDir || "", `${channelName}.md`);
      if (!fs.existsSync(filePath)) return null;
      const meta = getChannelMeta(filePath);
      const id = typeof meta.taskBoardId === "string" ? meta.taskBoardId.trim() : "";
      if (!id) return null;
      const selectedAgentIds = Array.isArray(meta.taskBoardSelectedAgentIds)
        ? Array.from(new Set(meta.taskBoardSelectedAgentIds.map((item) => String(item || "").trim()).filter(Boolean)))
        : [];
      return {
        id,
        title: typeof meta.taskBoardTitle === "string" ? meta.taskBoardTitle.trim() : "",
        coordinatorAgentId: typeof meta.taskBoardCoordinatorAgentId === "string" ? meta.taskBoardCoordinatorAgentId.trim() : "",
        selectedAgentIds,
      };
    } catch {
      return null;
    }
  }

  _resolveChannelAgentMemberIds(channelName) {
    try {
      const filePath = path.join(this._engine.channelsDir || "", `${channelName}.md`);
      if (!fs.existsSync(filePath)) return [];
      const meta = getChannelMeta(filePath);
      return Array.isArray(meta.members)
        ? meta.members.map((id) => String(id || "").trim()).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }

  _formatPhonePromptGuidance(agentId, settings, isZh) {
    return formatAgentPhonePromptGuidance({
      agentId,
      agent: this._getAgentInstance(agentId),
      agentsDir: this._engine.agentsDir,
      settings,
      isZh,
      zhConversationName: "群聊",
      enConversationName: "channel",
    });
  }

  _resolvePhoneSessionPath(agentId, channelName) {
    try {
      const agent = this._getAgentInstance(agentId);
      const agentDir = agent?.agentDir || path.join(this._engine.agentsDir, agentId);
      const projection = readAgentPhoneProjection(getAgentPhoneProjectionPath(agentDir, channelName));
      const stored = projection.meta.phoneSessionFile;
      if (!stored || typeof stored !== "string") return null;
      const resolved = path.resolve(agentDir, ...stored.split("/").filter(Boolean));
      const base = path.resolve(agentDir);
      if (!resolved.startsWith(base + path.sep) && resolved !== base) return null;
      return resolved;
    } catch {
      return null;
    }
  }

  _createChannelTaskTool(agentId, channelName, { phoneSettings = null, channelProject = null } = {}) {
    const engine = this._engine;
    const isZh = getLocale().startsWith("zh");
    const settings = phoneSettings || this._resolveChannelPhoneSettings(channelName);
    const channelMemberIds = this._resolveChannelAgentMemberIds(channelName);
    const channelTaskBoard = this._resolveChannelTaskBoard(channelName);
    const taskCreateTool = createTaskCreateTool({
      getTaskLedger: () => engine.taskLedger,
      getTaskOrchestrator: () => engine.taskOrchestrator,
      getCurrentSessionPath: () => null,
      getParentCwd: () => channelProject?.workspaceRoot || engine.getHomeCwd?.(agentId) || engine.cwd || null,
      listAgents: () => this._listMentionableAgents(),
      currentAgentId: agentId,
      createSource: ({ toolCallId }) => ({
        type: "channel",
        channel: channelName,
        channelName,
        toolName: "channel_task_create",
        agentId,
        toolCallId: toolCallId || null,
        projectId: channelProject?.id || null,
      }),
      getExtraContextRefs: () => [{
        type: "channel",
        channelName,
        projectId: channelProject?.id || null,
        projectName: channelProject?.name || null,
      }],
    });

    return {
      name: "channel_task_create",
      label: isZh ? "保存频道任务" : "Save channel task",
      description: isZh
        ? "把频道沟通中形成的后续工作保存到绑定项目看板 Task Ledger，避免只在聊天里承诺后遗漏。绑定看板且频道工具权限为 write 时默认启动主代理执行；只读频道只保存不执行。"
        : "Save follow-up work from channel discussion into the bound project kanban Task Ledger so it is not lost in chat. When a board is bound and channel tool mode is write, execution starts by default; read-only channels only save.",
      parameters: Type.Object({
        title: Type.String({ description: isZh ? "任务标题，简短描述要跟踪的工作。" : "Short title for the work to track." }),
        body: Type.Optional(Type.String({ description: isZh ? "任务背景、验收标准、频道结论或用户原话。" : "Context, acceptance criteria, channel decision, or user wording." })),
        goal: Type.Optional(Type.String({ description: isZh ? "可选目标；为空时使用 body 或 title。" : "Optional goal; falls back to body or title." })),
        status: Type.Optional(Type.String({ description: isZh ? "初始状态，默认 todo；需要准备执行时可用 ready。" : "Initial status, defaults to todo; use ready when prepared for execution." })),
        autoStart: Type.Optional(Type.Boolean({ description: isZh ? "是否立即启动执行。默认 false；只在频道工具权限为 write 时生效。" : "Whether to start execution immediately. Defaults false and only works in channel write mode." })),
        coordinatorAgentId: Type.Optional(Type.String({ description: isZh ? "主代理 id；省略时使用当前发起保存的 agent。" : "Coordinator agent id; defaults to the current agent." })),
        selectedAgentIds: Type.Optional(Type.Array(Type.String(), { description: isZh ? "可协作 agent id 列表；省略时使用频道成员。" : "Collaborator-capable agent ids; defaults to channel members." })),
        boardId: Type.Optional(Type.String({ description: isZh ? "目标看板 id；默认 default-board，确保任务在默认看板可见。" : "Target board id; defaults to default-board so the task is visible." })),
        boardTitle: Type.Optional(Type.String({ description: isZh ? "目标看板名称。" : "Target board title." })),
        priority: Type.Optional(Type.Number({ description: isZh ? "可选优先级，数字越大越靠前。" : "Optional priority; higher sorts first." })),
        cwd: Type.Optional(Type.String({ description: isZh ? "任务执行目录；省略时使用频道关联项目工作空间。" : "Task working directory; defaults to the linked channel project workspace." })),
        idempotencyKey: Type.Optional(Type.String({ description: isZh ? "可选幂等键；相同键不会重复创建未归档任务。" : "Optional idempotency key; same key will not create a duplicate unarchived task." })),
      }),
      execute: async (toolCallId, params = {}, signal, onUpdate) => {
        const boundBoardAutoStart = !!channelTaskBoard?.id && params.autoStart !== false && !params.status;
        const requestedAutoStart = params.autoStart === true || params.status === "running" || boundBoardAutoStart;
        const orchestratorAvailable = !!engine.taskOrchestrator?.createRun;
        const canAutoStart = settings.toolMode === "write" && orchestratorAvailable;
        const autoStart = requestedAutoStart && canAutoStart;
        const status = params.status === "running"
          ? (autoStart ? "running" : "ready")
          : (params.status || (requestedAutoStart ? "ready" : "todo"));
        const safeParams = {
          ...params,
          status,
          autoStart,
          boardId: params.boardId || channelTaskBoard?.id || "default-board",
          boardTitle: params.boardTitle || channelTaskBoard?.title || (isZh ? "默认项目" : "Default project"),
          cwd: params.cwd || channelProject?.workspaceRoot || undefined,
          coordinatorAgentId: params.coordinatorAgentId || params.assigneeAgentId || channelTaskBoard?.coordinatorAgentId || agentId,
          selectedAgentIds: Array.isArray(params.selectedAgentIds)
            ? params.selectedAgentIds
            : channelTaskBoard?.selectedAgentIds?.length
              ? channelTaskBoard.selectedAgentIds
              : channelMemberIds,
          idempotencyKey: params.idempotencyKey || (toolCallId ? `channel:${channelName}:${toolCallId}` : undefined),
        };
        const result = await taskCreateTool.execute(toolCallId, safeParams, signal, onUpdate, null);
        result.details = {
          ...(result.details || {}),
          taskBoardBound: !!channelTaskBoard?.id,
          taskBoardId: safeParams.boardId,
          autoStartRequestedByTaskBoardBinding: boundBoardAutoStart,
        };
        if (requestedAutoStart && !canAutoStart) {
          result.details = {
            ...(result.details || {}),
            autoStartBlockedByToolMode: settings.toolMode !== "write",
            autoStartUnavailable: settings.toolMode === "write" && !orchestratorAvailable,
          };
          if (Array.isArray(result.content) && result.content[0]?.type === "text") {
            result.content[0].text += isZh
              ? (settings.toolMode !== "write"
                ? " 当前频道工具权限为只读，任务已保存但未自动执行。"
                : " 当前任务执行器不可用，任务已保存但未自动执行。")
              : (settings.toolMode !== "write"
                ? " Channel tool mode is read-only, so the task was saved but not started."
                : " The task orchestrator is unavailable, so the task was saved but not started.");
          }
        }
        return result;
      },
    };
  }

  _createChannelPhoneTools(agentId, channelName, { setDecision, phoneSettings = null, channelProject = null } = {}) {
    const engine = this._engine;
    const isZh = getLocale().startsWith("zh");
    const channelFile = path.join(engine.channelsDir || "", `${channelName}.md`);
    let decided = false;

    const markDecision = (decision) => {
      if (decided) return false;
      decided = true;
      setDecision?.(decision);
      return true;
    };

    return [
      {
        name: "channel_read_context",
        label: isZh ? "读取频道上下文" : "Read channel context",
        description: isZh
          ? "读取当前手机群聊频道的最近消息。数据源是频道聊天记录 Truth，不是你的 phone session。"
          : "Read recent messages from the current phone channel. The source is the channel transcript Truth, not your phone session.",
        parameters: Type.Object({
          count: Type.Optional(Type.Number({
            description: isZh ? "要读取的最近消息数量，默认 20，最多 50。" : "Number of recent messages to read, defaults to 20, max 50.",
          })),
        }),
        execute: async (_toolCallId, params = {}) => {
          if (!fs.existsSync(channelFile)) {
            return {
              content: [{ type: "text", text: isZh ? "频道不存在。" : "Channel not found." }],
              details: { action: "read_context", error: "channel not found" },
            };
          }
          const count = Math.max(1, Math.min(50, Number(params.count) || 20));
          const messages = getRecentMessages(channelFile, count);
          return {
            content: [{
              type: "text",
              text: messages.length > 0 ? formatMessagesForLLM(messages) : (isZh ? "频道暂无消息。" : "No channel messages."),
            }],
            details: { action: "read_context", channel: channelName, messageCount: messages.length },
          };
        },
      },
      this._createChannelTaskTool(agentId, channelName, { phoneSettings, channelProject }),
      {
        name: "channel_reply",
        label: isZh ? "发送频道消息" : "Send channel message",
        description: isZh
          ? "把本轮回复发送到当前频道。只有这个工具的 content 会写入群聊；普通生成文本只会留在你的手机动态里。"
          : "Send this turn's reply to the current channel. Only this tool's content is posted; ordinary generated text stays in your phone activity.",
        parameters: Type.Object({
          content: Type.String({
            description: isZh ? "要发送到频道的正文。不要包含 mood、解释或工具调用说明。" : "Message body to post. Do not include mood, explanations, or tool-call notes.",
          }),
          mood: Type.Optional(Type.String({
            description: isZh ? "可选：本次发言前的内省摘要，只记录在工具详情中，不发送到频道。" : "Optional private mood summary. Stored in tool details, not posted.",
          })),
        }),
        execute: async (_toolCallId, params = {}) => {
          const content = String(params.content || "").trim();
          if (!content) {
            return {
              content: [{ type: "text", text: isZh ? "发送失败：content 为空。" : "Send failed: content is empty." }],
              details: { action: "reply", error: "empty content" },
            };
          }
          if (decided) {
            return {
              content: [{ type: "text", text: isZh ? "本轮已经完成过频道决定。" : "This phone turn already made a channel decision." }],
              details: { action: "reply", error: "already decided" },
            };
          }
          if (engine.isChannelsEnabled && !engine.isChannelsEnabled()) {
            return {
              content: [{ type: "text", text: isZh ? "发送失败：频道功能已关闭。" : "Send failed: channels are disabled." }],
              details: { action: "reply", error: "channels disabled" },
            };
          }
          if (!fs.existsSync(channelFile)) {
            return {
              content: [{ type: "text", text: isZh ? "发送失败：频道不存在。" : "Send failed: channel not found." }],
              details: { action: "reply", error: "channel not found" },
            };
          }

          const { timestamp } = await appendMessage(channelFile, agentId, content);
          const decision = {
            type: "reply",
            replied: true,
            replyContent: content,
            timestamp,
            mood: typeof params.mood === "string" ? params.mood : null,
          };
          markDecision(decision);

          this._hub.eventBus.emit({
            type: "channel_new_message",
            channelName,
            sender: agentId,
            message: { sender: agentId, timestamp, body: content },
          }, null);

          return {
            content: [{ type: "text", text: isZh ? `已发送到 #${channelName}` : `Posted to #${channelName}` }],
            details: { action: "reply", channel: channelName, timestamp, mood: decision.mood },
          };
        },
      },
      {
        name: "channel_pass",
        label: isZh ? "本轮不发言" : "Pass this turn",
        description: isZh
          ? "表示你已经看过这批手机群聊消息，但本轮选择不在频道发言。"
          : "Mark these phone channel messages as seen while choosing not to post this turn.",
        parameters: Type.Object({
          reason: Type.Optional(Type.String({
            description: isZh ? "简短说明为什么本轮不发言。" : "Brief reason for not posting this turn.",
          })),
          mood: Type.Optional(Type.String({
            description: isZh ? "可选：本次判断的内省摘要。" : "Optional private mood summary for this decision.",
          })),
        }),
        execute: async (_toolCallId, params = {}) => {
          if (decided) {
            return {
              content: [{ type: "text", text: isZh ? "本轮已经完成过频道决定。" : "This phone turn already made a channel decision." }],
              details: { action: "pass", error: "already decided" },
            };
          }
          const decision = {
            type: "pass",
            replied: false,
            passed: true,
            reason: typeof params.reason === "string" ? params.reason : "",
            mood: typeof params.mood === "string" ? params.mood : null,
          };
          markDecision(decision);
          return {
            content: [{ type: "text", text: isZh ? "已标记为本轮不发言。" : "Marked as pass for this turn." }],
            details: { action: "pass", channel: channelName, reason: decision.reason, mood: decision.mood },
          };
        },
      },
    ];
  }

  // ──────────── 生命周期 ────────────

  start() {
    const engine = this._engine;
    if (!engine.channelsDir) return;
    if (this._ticker) return;

    this._ticker = createChannelTicker({
      channelsDir: engine.channelsDir,
      agentsDir: engine.agentsDir,
      getAgentOrder: () => this.getAgentOrder(),
      executeCheck: (agentId, channelName, newMessages, allUpdates, opts) =>
        this._executeCheck(agentId, channelName, newMessages, allUpdates, opts),
      onMemorySummarize: (agentId, channelName, contextText) =>
        this._memorySummarize(agentId, channelName, contextText),
      onEvent: (event, data) => {
        this._hub.eventBus.emit({ type: event, ...data }, null);
      },
    });
    this._ticker.start();
  }

  ensureStarted() {
    if (this._ticker) return true;
    if (!this._engine.isChannelsEnabled?.()) return false;
    this.start();
    this.setupPostHandler();
    return !!this._ticker;
  }

  async stop() {
    if (this._ticker) {
      await this._ticker.stop();
      this._ticker = null;
    }
  }

  async toggle(enabled) {
    if (enabled) {
      if (this._ticker) return;
      this.start();
      this.setupPostHandler();
    } else {
      await this.stop();
    }
  }

  triggerImmediate(channelName, opts) {
    this.ensureStarted();
    return this._ticker?.triggerImmediate(channelName, opts) || Promise.resolve();
  }

  refreshProactiveSchedule() {
    if (!this.ensureStarted()) return;
    this._ticker?.refreshSchedule?.();
  }

  _listMentionableAgents() {
    if (typeof this._engine.listAgents === "function") {
      return this._engine.listAgents();
    }
    return this.getAgentOrder().map((id) => {
      const agent = this._getAgentInstance(id);
      if (agent?.agentName) return { id, name: agent.agentName, agentName: agent.agentName };
      try {
        const cfg = loadConfig(path.join(this._engine.agentsDir, id, "config.yaml"));
        return { id, name: cfg?.agent?.name || id };
      } catch {
        return { id, name: id };
      }
    });
  }

  _extractMentionedAgents(channelName, message) {
    const text = typeof message === "string" ? message : message?.body;
    if (!text) return [];
    const channelFile = path.join(this._engine.channelsDir || "", `${channelName}.md`);
    const meta = getChannelMeta(channelFile);
    return extractMentionedAgentIds(text, {
      channelMembers: Array.isArray(meta.members) ? meta.members : [],
      agents: this._listMentionableAgents(),
    });
  }

  /**
   * 注入频道 post 回调到当前 agent
   * agent 用 channel tool 发消息后，触发其他 agent 的手机送达
   */
  setupPostHandler() {
    for (const [, agent] of this._engine.agents || []) {
      agent.setChannelPostHandler((channelName, senderId, message) => {
        debugLog()?.log("channel", `agent ${senderId} posted to #${channelName}, triggering phone delivery`);
        if (message) {
          this._hub.eventBus.emit({
            type: "channel_new_message",
            channelName,
            sender: senderId,
            message,
          }, null);
        }
        const mentionedAgents = this._extractMentionedAgents(channelName, message);
        const opts = mentionedAgents.length > 0 ? { mentionedAgents } : undefined;
        this.triggerImmediate(channelName, opts)?.catch(err =>
          console.error(`[channel] agent post delivery 失败: ${err.message}`)
        );
      });
    }
  }

  // ──────────── 频道 Agent 顺序 ────────────

  /** 获取频道轮转候选 agent 列表；具体频道 membership 由 channel frontmatter 决定 */
  getAgentOrder() {
    const now = Date.now();
    if (this._agentOrderCache && now - this._agentOrderCache.ts < ChannelRouter._AGENT_ORDER_TTL) {
      return this._agentOrderCache.list;
    }
    try {
      const entries = fs.readdirSync(this._engine.agentsDir, { withFileTypes: true });
      const list = entries
        .filter(e => e.isDirectory())
        .filter(e => {
          const configPath = path.join(this._engine.agentsDir, e.name, "config.yaml");
          return fs.existsSync(configPath);
        })
        .map(e => e.name);
      this._agentOrderCache = { list, ts: now };
      return list;
    } catch {
      return [];
    }
  }

  // ──────────── Phone Delivery + Reply ────────────

  /**
   * 频道检查回调：未读消息送达 → Agent Phone Session → 频道工具写入或 pass
   * 从 engine._executeChannelCheck 搬入
   */
  async _executeCheck(agentId, channelName, newMessages, _allChannelUpdates, {
    signal,
    proactive = false,
    mentionedAgents = [],
    mentionTargeted = false,
  } = {}) {
    const msgText = formatMessagesForLLM(newMessages);
    const isZh = getLocale().startsWith("zh");
    const lastNewMessage = newMessages[newMessages.length - 1] || null;
    await this._recordPhoneActivity(
      agentId,
      channelName,
      "viewed",
      isZh ? `已查看 ${newMessages.length} 条新消息` : `Viewed ${newMessages.length} new message(s)`,
      {
        messageCount: newMessages.length,
        lastMessageTimestamp: lastNewMessage?.timestamp || null,
      },
    );

    // ── 手机送达：不做 utility 预判，Agent 必须用频道专属工具完成本轮 ──
    try {
      await this._recordPhoneActivity(
        agentId,
        channelName,
        "replying",
        proactive
          ? (isZh ? "收到频道提醒，正在看群聊" : "Received channel reminder and is reading")
          : (isZh ? "正在查看手机群聊" : "Reading phone channel messages"),
        { messageCount: newMessages.length, proactive },
      );
      const decision = await this._executeReply(agentId, channelName, msgText, {
        signal,
        messageCount: newMessages.length,
        proactive,
        mentionedAgents,
        mentionTargeted,
      });

      if (decision?.replied) {
        console.log(`\x1b[90m[channel] ${agentId} replied #${channelName} (${decision.replyContent.length} chars)\x1b[0m`);
        debugLog()?.log("channel", `${agentId} replied #${channelName} (${decision.replyContent.length} chars)`);
        await this._recordPhoneActivity(
          agentId,
          channelName,
          "idle",
          isZh ? "已回复" : "Replied",
          {
            replyTimestamp: decision.timestamp,
            ...(decision.mood ? { mood: decision.mood } : {}),
            ...(this._resolvePhoneSessionPath(agentId, channelName)
              ? { sessionPath: this._resolvePhoneSessionPath(agentId, channelName) }
              : {}),
          },
        );
        return { replied: true, replyContent: decision.replyContent };
      }

      if (decision?.passed) {
        await this._recordPhoneActivity(
          agentId,
          channelName,
          "no_reply",
          isZh ? "已查看，选择不发言" : "Viewed and chose not to post",
          {
            messageCount: newMessages.length,
            ...(decision.reason ? { reason: decision.reason } : {}),
            ...(decision.mood ? { mood: decision.mood } : {}),
            ...(this._resolvePhoneSessionPath(agentId, channelName)
              ? { sessionPath: this._resolvePhoneSessionPath(agentId, channelName) }
              : {}),
          },
        );
        return { replied: false, passed: true };
      }

      await this._recordPhoneActivity(
        agentId,
        channelName,
        "error",
        isZh ? "没有调用频道回复工具" : "Did not call a channel decision tool",
        {
          messageCount: newMessages.length,
          ...(this._resolvePhoneSessionPath(agentId, channelName)
            ? { sessionPath: this._resolvePhoneSessionPath(agentId, channelName) }
            : {}),
        },
      );
      return { replied: false, missingDecision: true };
    } catch (err) {
      console.error(`[channel] 回复失败 (${agentId}/#${channelName}): ${err.message}`);
      debugLog()?.error("channel", `回复失败 (${agentId}/#${channelName}): ${err.message}`);
      await this._recordPhoneActivity(
        agentId,
        channelName,
        "error",
        isZh ? "处理消息失败" : "Failed to process message",
        { error: err.message },
      );
      return { replied: false };
    }
  }

  /**
   * 将未读群聊消息送入 Agent Phone session。频道写入只能由 channel_reply 工具完成。
   */
  _formatMentionGuidance(agentId, mentionedAgents, mentionTargeted, isZh) {
    const ids = Array.from(new Set(
      Array.isArray(mentionedAgents)
        ? mentionedAgents.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())
        : [],
    ));
    if (ids.length === 0) return "";

    const names = ids
      .map((id) => this._resolveChannelMemorySenderName(id, isZh))
      .filter(Boolean)
      .join(isZh ? "、" : ", ");
    if (mentionTargeted || ids.includes(agentId)) {
      return isZh
        ? [
          `- 这轮消息明确 @ 了你（${names || agentId}），你是本轮优先被提醒的成员`,
          "- 请判断是否需要回应；如果只是确认收到或暂时不需要发言，也可以调用 channel_pass",
        ].join("\n")
        : [
          `- This turn explicitly @mentioned you (${names || agentId}); you were prioritized for this phone check`,
          "- Decide whether a reply is useful; if there is nothing to add, call channel_pass",
        ].join("\n");
    }

    return isZh
      ? [
        `- 这轮消息明确 @ 了 ${names || ids.join("、")}，你也能看到这段频道 Truth，但不要抢答`,
        "- 除非你确实需要补充、纠错或推进话题，否则调用 channel_pass",
      ].join("\n")
      : [
        `- This turn explicitly @mentioned ${names || ids.join(", ")}. You can still see this channel Truth, but do not steal the reply`,
        "- Unless you truly need to add context, correct something, or move the topic forward, call channel_pass",
      ].join("\n");
  }

  _formatChannelBehaviorGuidance(agentId, mentionedAgents, mentionTargeted, isZh) {
    const mentionGuidance = this._formatMentionGuidance(agentId, mentionedAgents, mentionTargeted, isZh);
    if (mentionGuidance) return mentionGuidance;
    return isZh
      ? [
        "- 你可以因为被问到、被提到、想补充、想推动话题、表达情绪、主动开启话题或觉得有价值而发言",
        "- 不需要只在事情与你直接相关时才发言",
      ].join("\n")
      : [
        "- You may post because you were asked, mentioned, have something useful to add, want to move the topic, want to start a topic, or feel it is worth saying",
        "- You do not need the topic to be directly about you",
      ].join("\n");
  }

  _formatChannelProjectGuidance(project, isZh) {
    if (!project?.id) return "";
    const lines = isZh
      ? [
        "频道关联项目：",
        `- 项目：${project.name || project.id}`,
        project.workspaceRoot ? `- 工作空间：${project.workspaceRoot}` : "",
        project.docsRoot ? `- 文档目录：${project.docsRoot}` : "",
        project.testCommand ? `- 验证命令：${project.testCommand}` : "",
        project.description ? `- 项目说明：${project.description}` : "",
        "- 本频道内涉及研发、测试、架构工作时，默认使用这个项目工作空间；不要使用 Agent 默认空间，除非用户另行指定。",
      ]
      : [
        "Linked project:",
        `- Project: ${project.name || project.id}`,
        project.workspaceRoot ? `- Workspace: ${project.workspaceRoot}` : "",
        project.docsRoot ? `- Docs: ${project.docsRoot}` : "",
        project.testCommand ? `- Test command: ${project.testCommand}` : "",
        project.description ? `- Notes: ${project.description}` : "",
        "- For development, testing, and architecture work in this channel, use this project workspace by default unless the user says otherwise.",
      ];
    return lines.filter(Boolean).join("\n");
  }

  async _executeReply(agentId, channelName, msgText, {
    signal,
    messageCount = null,
    proactive = false,
    mentionedAgents = [],
    mentionTargeted = false,
  } = {}) {
    const isZh = getLocale().startsWith("zh");
    const phoneSettings = this._resolveChannelPhoneSettings(channelName);
    const channelProject = this._resolveChannelProject(channelName);
    const promptGuidance = this._formatPhonePromptGuidance(agentId, phoneSettings, isZh);
    const behaviorGuidance = this._formatChannelBehaviorGuidance(agentId, mentionedAgents, mentionTargeted, isZh);
    const projectGuidance = this._formatChannelProjectGuidance(channelProject, isZh);
    const zhIntro = proactive
      ? `你的手机收到了 #${channelName} 的频道提醒。\n\n`
        + `以下是最近的频道内容，来源是频道聊天记录 Truth，不是用户单独发给你的请求，也不一定是新消息：\n\n`
      : `你的手机收到了 #${channelName} 的新群聊消息。\n\n`
        + `这些是这部手机尚未处理的新消息，来源是频道聊天记录 Truth，不是用户单独发给你的请求：\n\n`;
    const enIntro = proactive
      ? `Your phone received a channel reminder for #${channelName}.\n\n`
        + `Here is recent channel content. The source is the channel transcript Truth, not a direct user request, and it may not be new:\n\n`
      : `Your phone received new messages in #${channelName}.\n\n`
        + `These are the new messages this phone has not processed yet. The source is the channel transcript Truth, not a direct user request:\n\n`;
    let activeSessionPath = null;
    let decision = null;
    await runAgentPhoneSession(
      agentId,
      [
        {
          text: isZh
            ? zhIntro
              + (projectGuidance ? `${projectGuidance}\n\n` : "")
              + `${msgText || "（没有新消息）"}\n\n`
              + `请像群聊成员一样阅读并行动：\n`
              + `${behaviorGuidance}\n`
              + `- 需要旧上下文时，用 channel_read_context 读取频道 Truth；需要事实和长期背景时，用 search_memory\n`
              + `- 如果沟通形成了后续工作、回修、验证项或需要有人执行的决定，先调用 channel_task_create 保存到看板，再回复；不要只靠文字承诺或 todo_write 做持久追踪\n`
              + `${promptGuidance}\n`
              + `- 本轮最后必须调用 channel_reply 或 channel_pass 之一完成动作\n`
              + `- 不要把最终群聊回复写在普通文本里；只有 channel_reply.content 会进入群聊`
            : enIntro
              + (projectGuidance ? `${projectGuidance}\n\n` : "")
              + `${msgText || "(No new messages)"}\n\n`
              + `Read and act like a group chat member:\n`
              + `${behaviorGuidance}\n`
              + `- Use channel_read_context for older channel Truth; use search_memory for facts and long-term background\n`
              + `- If the discussion creates follow-up work, fixes, verification, or a decision someone must act on, call channel_task_create to save it to the kanban before replying; do not rely on text promises or todo_write for durable tracking\n`
              + `${promptGuidance}\n`
              + `- End this turn by calling exactly one of channel_reply or channel_pass\n`
              + `- Do not write the final channel reply as ordinary text; only channel_reply.content enters the channel`,
          capture: true,
        },
      ],
      {
        engine: this._engine,
        signal,
        conversationId: channelName,
        conversationType: "channel",
        toolMode: phoneSettings.toolMode,
        modelOverride: phoneSettings.modelOverrideEnabled ? phoneSettings.modelOverrideModel : null,
        workspaceRoot: channelProject?.workspaceRoot || null,
        emitEvents: true,
        extraCustomTools: this._createChannelPhoneTools(agentId, channelName, {
          phoneSettings,
          channelProject,
          setDecision: (next) => { if (!decision) decision = next; },
        }),
        onSessionReady: (sessionPath) => {
          activeSessionPath = sessionPath;
          return this._recordPhoneActivity(
            agentId,
            channelName,
            "replying",
            isZh ? "正在查看手机群聊" : "Reading phone channel messages",
            {
              ...(messageCount != null ? { messageCount } : {}),
              sessionPath,
            },
          );
        },
        onActivity: (state, summary, details) =>
          this._recordPhoneActivity(
            agentId,
            channelName,
            state,
            summary,
            {
              ...(details || {}),
              ...(activeSessionPath ? { sessionPath: activeSessionPath } : {}),
            },
        ),
      },
    );

    return decision || { replied: false, missingDecision: true };
  }

  _resolveChannelMemorySenderName(sender, isZh) {
    const rawSender = String(sender || "").trim();
    if (!rawSender) return isZh ? "未知角色" : "Unknown";
    if (rawSender === "system") return isZh ? "系统" : "System";

    const engine = this._engine;
    if (rawSender === "user" || rawSender === engine.userName) {
      return engine.userName || (isZh ? "用户" : "User");
    }

    const agent = this._getAgentInstance(rawSender);
    if (agent?.agentName) return agent.agentName;

    try {
      const cfg = loadConfig(path.join(engine.agentsDir, rawSender, "config.yaml"));
      const name = cfg?.agent?.name;
      if (typeof name === "string" && name.trim()) return name.trim();
    } catch {
      // Best effort for legacy channel logs whose sender no longer exists.
    }

    return rawSender;
  }

  _formatChannelMemoryContext(agentId, payload, isZh) {
    if (typeof payload === "string") return payload;

    const lines = [];
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    for (const message of messages) {
      const speaker = this._resolveChannelMemorySenderName(message?.sender, isZh);
      const body = String(message?.body || "").trim();
      if (!body) continue;
      const timestamp = String(message?.timestamp || "").trim();
      lines.push(timestamp ? `[${timestamp}] ${speaker}: ${body}` : `${speaker}: ${body}`);
    }

    const replyContent = String(payload?.replyContent || "").trim();
    if (replyContent) {
      const replyLabel = isZh ? "[我的回复]" : "[My reply]";
      const agentName = this._resolveChannelMemorySenderName(agentId, isZh);
      lines.push(`${replyLabel} ${agentName}: ${replyContent}`);
    }

    const legacyText = String(payload?.contextText || "").trim();
    if (legacyText) lines.push(legacyText);
    return lines.join("\n\n");
  }

  _channelMemorySystemPrompt(isZh) {
    return isZh
      ? [
        "把频道聊天记录 Truth 压缩成可搜索的长期记忆摘要。",
        "只输出 1 到 3 条干净短句，用分号分隔；每条必须写清“谁做了什么 / 决定了什么 / 状态发生了什么变化”。",
        "如果输入包含已有频道记忆，请把已有记忆和本次频道内容合并重写，修掉旧 ID、含混主语和杂乱摘要。",
        "使用输入里的角色显示名，不要保留 sender id，不要写聊天流水、标题、项目符号、mood、泛称或含混主语。",
        "如果这批内容没有长期检索价值，只输出 NO_MEMORY。",
      ].join("\n")
      : [
        "Compress the channel transcript Truth into searchable long-term memory.",
        "Output 1 to 3 clean short facts separated by semicolons; each fact must state who did what, what was decided, or what state changed.",
        "If existing channel memory is provided, merge and rewrite it with the current channel content, cleaning old ids, vague subjects, and messy summaries.",
        "Use the display names from the input. Do not keep sender ids, chat logs, headings, bullets, mood, vague subjects, or generic group references.",
        "If there is no durable searchable value, output NO_MEMORY.",
      ].join("\n");
  }

  _normalizeChannelMemorySummary(rawSummary) {
    return String(rawSummary || "")
      .trim()
      .replace(/^```(?:\w+)?\s*/u, "")
      .replace(/\s*```$/u, "")
      .trim();
  }

  _isEmptyChannelMemorySummary(summaryText) {
    const normalized = String(summaryText || "").trim().toUpperCase();
    return !normalized || normalized === "NO_MEMORY" || normalized === "无记忆";
  }

  _getPreviousChannelMemoryFacts(factStore, sessionId) {
    if (typeof factStore?.getBySession !== "function") {
      return [];
    }
    return factStore.getBySession(sessionId) || [];
  }

  _clearPreviousChannelMemoryFacts(factStore, sessionId, previousFacts = null) {
    if (typeof factStore?.delete !== "function") {
      return;
    }
    const facts = Array.isArray(previousFacts)
      ? previousFacts
      : this._getPreviousChannelMemoryFacts(factStore, sessionId);
    for (const fact of facts) {
      if (fact?.id != null) factStore.delete(fact.id);
    }
  }

  _formatChannelMemoryPromptContent(channelName, contextText, previousFacts, isZh) {
    const previousText = previousFacts
      .map(fact => String(fact?.fact || "").trim())
      .filter(Boolean)
      .join("\n");
    const clippedContext = contextText.slice(0, 3000);
    const clippedPrevious = previousText.slice(0, 2000);
    if (isZh) {
      return [
        `频道 #${channelName}`,
        "已有频道记忆（可能包含旧 ID 或杂乱摘要，请清洗并合并）：",
        clippedPrevious || "（无）",
        "本次频道内容：",
        clippedContext,
      ].join("\n");
    }
    return [
      `Channel #${channelName}`,
      "Existing channel memory (may contain old ids or messy summaries; clean and merge it):",
      clippedPrevious || "(none)",
      "Current channel content:",
      clippedContext,
    ].join("\n");
  }

  /**
   * 频道记忆摘要
   * 从 engine._channelMemorySummarize 搬入
   */
  async _memorySummarize(agentId, channelName, payload) {
    const engine = this._engine;
    let factStore = null;
    let needClose = false;
    try {
      // 记忆 master 关闭时不写入新记忆（频道摘要是写侧操作）
      const agentInstance = this._getAgentInstance(agentId);
      const memoryMasterOn = this._resolveMemoryMasterEnabled(agentId, { agentInstance });
      if (!memoryMasterOn) {
        console.log(`\x1b[90m[channel] ${agentId} memory master 已关闭，跳过频道记忆摘要\x1b[0m`);
        return;
      }

      const utilCfg = engine.resolveUtilityConfig({ agentId }) || {};
      const { utility: model, api_key, base_url, api } = utilCfg;
      if (!api_key || !base_url || !api) {
        console.log(`\x1b[90m[channel] ${agentId} 无 API 配置，跳过记忆摘要\x1b[0m`);
        return;
      }

      const isZhMem = getLocale().startsWith("zh");
      const contextText = this._formatChannelMemoryContext(agentId, payload, isZhMem);
      if (!contextText.trim()) return;

      // 写入 agent 的 fact store
      const sessionId = `channel-${channelName}`;

      if (agentInstance?.factStore) {
        factStore = agentInstance.factStore;
      } else {
        const { FactStore } = await import("../lib/memory/fact-store.js");
        const dbPath = path.join(engine.agentsDir, agentId, "memory", "facts.db");
        factStore = new FactStore(dbPath);
        needClose = true;
      }

      const previousFacts = this._getPreviousChannelMemoryFacts(factStore, sessionId);
      const rawSummary = await callText({
        api, model,
        apiKey: api_key,
        baseUrl: base_url,
        systemPrompt: this._channelMemorySystemPrompt(isZhMem),
        messages: [{
          role: "user",
          content: this._formatChannelMemoryPromptContent(channelName, contextText, previousFacts, isZhMem),
        }],
        temperature: 0.3,
        maxTokens: 200,
      });
      const summaryText = this._normalizeChannelMemorySummary(rawSummary);

      const now = new Date();
      this._clearPreviousChannelMemoryFacts(factStore, sessionId, previousFacts);
      if (this._isEmptyChannelMemorySummary(summaryText)) {
        console.log(`\x1b[90m[channel] ${agentId} memory cleared/no durable summary (#${channelName})\x1b[0m`);
        return;
      }
      factStore.add({
        fact: `[#${channelName}] ${summaryText}`,
        tags: [isZhMem ? "频道" : "channel", channelName],
        time: now.toISOString().slice(0, 16),
        session_id: sessionId,
      });

      console.log(`\x1b[90m[channel] ${agentId} memory saved (#${channelName}, ${summaryText.length} chars)\x1b[0m`);
    } catch (err) {
      console.error(`[channel] 记忆摘要失败 (${agentId}/#${channelName}): ${err.message}`);
    } finally {
      if (needClose) factStore?.close?.();
    }
  }
}
