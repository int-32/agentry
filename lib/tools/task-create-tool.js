import { StringEnum, Type } from "../pi-sdk/index.js";
import {
  asText,
  buildTaskBoardContext,
  firstLine,
  startManualTaskRun,
  uniqueTextList,
} from "../task-orchestration/manual-task-run.js";
import { getToolSessionCwd, getToolSessionPath } from "./tool-session.js";
import { toolError, toolOk } from "./tool-result.js";

const CREATE_STATUSES = ["triage", "todo", "scheduled", "ready", "blocked", "review", "running"];
const NON_STARTABLE_STATUSES = new Set(["scheduled", "blocked", "review"]);

function normalizeStatus(value, fallback) {
  const status = asText(value, fallback);
  return CREATE_STATUSES.includes(status) ? status : null;
}

function listAgents(deps) {
  return typeof deps.listAgents === "function" ? deps.listAgents() : [];
}

function resolveCoordinatorAgentId(deps, params = {}) {
  const agents = listAgents(deps);
  const knownIds = new Set(agents.map(agent => agent.id).filter(Boolean));
  const fallback = deps.currentAgentId || agents[0]?.id || null;
  const requested = asText(params.coordinatorAgentId || params.assigneeAgentId, fallback);
  return knownIds.size && requested && !knownIds.has(requested)
    ? fallback || requested
    : requested;
}

function createRuntime(deps, sessionPath, cwd) {
  return {
    listAgents: () => listAgents(deps),
    currentAgentId: deps.currentAgentId || null,
    getCurrentSessionPath: () => sessionPath || deps.getCurrentSessionPath?.() || null,
    getCwd: () => cwd || deps.getParentCwd?.() || null,
    getTaskOrchestrator: () => deps.getTaskOrchestrator?.() || null,
  };
}

function resolveTaskSource(deps, toolCallId, params, ctx) {
  if (typeof deps.createSource === "function") {
    const source = deps.createSource({ toolCallId, params, ctx });
    if (source && typeof source === "object" && !Array.isArray(source)) return source;
  }
  return {
    type: "chat",
    channel: "agent_tool",
    toolName: "task_create",
    agentId: deps.currentAgentId || null,
    toolCallId: toolCallId || null,
  };
}

function resolveExtraContextRefs(deps, params, ctx) {
  if (typeof deps.getExtraContextRefs !== "function") return [];
  const refs = deps.getExtraContextRefs(params, ctx);
  return Array.isArray(refs) ? refs.filter(Boolean) : [];
}

export function createTaskCreateTool(deps = {}) {
  return {
    name: "task_create",
    label: "创建看板任务",
    description:
      "Create a single project-kanban task from the conversation. By default this also starts a real coordinator agent run, so use it when the user asks to create/track/do a board task. Use task_orchestrate only when the user has confirmed a multi-agent task graph.",
    parameters: Type.Object({
      title: Type.String({ description: "任务标题，简短描述这张看板卡。" }),
      body: Type.Optional(Type.String({ description: "任务具体内容、背景、验收标准或用户原话。" })),
      goal: Type.Optional(Type.String({ description: "可选目标；为空时使用 body 或 title。" })),
      boardId: Type.Optional(Type.String({ description: "目标项目看板 id；省略时进入默认项目看板 default-board。" })),
      boardTitle: Type.Optional(Type.String({ description: "目标项目看板名称，仅用于任务上下文展示。" })),
      status: Type.Optional(StringEnum(CREATE_STATUSES, {
        description: "初始泳道。省略时默认 ready 并自动执行；running 会转为 ready 后启动 run。",
      })),
      autoStart: Type.Optional(Type.Boolean({
        description: "是否创建后立即启动真实 agent 执行。默认 true；如果 status 是 scheduled/blocked/review，默认 false。",
      })),
      coordinatorAgentId: Type.Optional(Type.String({ description: "主代理 agent id；省略时使用当前 agent。" })),
      assigneeAgentId: Type.Optional(Type.String({ description: "coordinatorAgentId 的别名，用于兼容 assignee 表达。" })),
      selectedAgentIds: Type.Optional(Type.Array(Type.String(), {
        description: "本看板可用的 agent id 列表；主代理会从中排除后作为可协作子代理提示给 worker。",
      })),
      priority: Type.Optional(Type.Number({ description: "可选优先级，数字越大越靠前。" })),
      cwd: Type.Optional(Type.String({ description: "任务执行工作目录；省略时继承当前会话 cwd。" })),
      idempotencyKey: Type.Optional(Type.String({ description: "可选幂等键；相同键不会重复创建未归档任务。" })),
    }),

    execute: async (toolCallId, params = {}, _signal, _onUpdate, ctx) => {
      const ledger = deps.getTaskLedger?.();
      if (!ledger?.createTask) return toolError("任务账本未初始化，无法创建看板任务。");

      const title = asText(params.title);
      const body = asText(params.body || params.description);
      const goal = asText(params.goal || params.objective);
      if (!title && !body && !goal) return toolError("title, body, or goal is required");

      const requestedStatus = normalizeStatus(params.status, "ready");
      if (!requestedStatus) return toolError(`Invalid task status: ${params.status}`);
      const initialStatus = requestedStatus === "running" ? "ready" : requestedStatus;
      const explicitAutoStart = typeof params.autoStart === "boolean";
      const autoStart = explicitAutoStart ? params.autoStart : !NON_STARTABLE_STATUSES.has(initialStatus);
      if (requestedStatus === "running" && !autoStart) {
        return toolError("Cannot create a running task without autoStart=true.");
      }
      if (autoStart && !deps.getTaskOrchestrator?.()?.createRun) {
        return toolError("任务编排器未初始化，不能自动启动任务。");
      }

      const sessionPath = getToolSessionPath(ctx) || deps.getCurrentSessionPath?.() || null;
      const cwd = asText(params.cwd, getToolSessionCwd(ctx) || deps.getParentCwd?.() || null);
      const coordinatorAgentId = resolveCoordinatorAgentId(deps, params);
      const selectedAgentIds = uniqueTextList([
        coordinatorAgentId,
        ...(Array.isArray(params.selectedAgentIds) ? params.selectedAgentIds : []),
      ]);
      const boardContext = buildTaskBoardContext({
        boardId: params.boardId,
        boardTitle: params.boardTitle,
        coordinatorAgentId,
        selectedAgentIds,
      });
      const task = ledger.createTask({
        title: title || firstLine(goal || body, "未命名任务"),
        body,
        goal,
        status: initialStatus,
        source: resolveTaskSource(deps, toolCallId, params, ctx),
        assignee: coordinatorAgentId ? { type: "agent", id: coordinatorAgentId } : null,
        priority: Number.isFinite(Number(params.priority)) ? Number(params.priority) : 0,
        rootSessionPath: sessionPath,
        cwd,
        contextRefs: [boardContext, ...resolveExtraContextRefs(deps, params, ctx)],
        idempotencyKey: asText(params.idempotencyKey, toolCallId ? `tool:${toolCallId}` : null),
      });

      const runtime = createRuntime(deps, sessionPath, cwd);
      const run = autoStart ? startManualTaskRun(runtime, task, {
        coordinatorAgentId,
        selectedAgentIds,
      }) : null;
      const latestTask = ledger.getTask?.(task.id) || task;
      const runText = run?.id ? `，并已启动执行 ${run.id}` : autoStart ? "，但没有创建新的执行（可能已有活跃执行）" : "";
      return toolOk(`已创建看板任务 ${latestTask.id}${runText}。`, {
        taskId: latestTask.id,
        title: latestTask.title,
        status: latestTask.status,
        boardId: boardContext.boardId,
        coordinatorAgentId,
        selectedAgentIds,
        autoStart,
        runId: run?.id || latestTask.currentRunId || null,
      });
    },
  };
}
