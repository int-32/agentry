import { Type } from "../pi-sdk/index.js";
import { getToolSessionCwd, getToolSessionPath } from "./tool-session.js";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createTaskOrchestrateTool(deps = {}) {
  return {
    name: "task_orchestrate",
    label: "创建任务编排",
    description:
      "在用户确认后创建一个多 agent 任务图。用 nodes 表示可并发的工作包，用 dependsOn/edges 表示依赖；后端会按依赖并发派发 worker agent。",
    parameters: Type.Object({
      title: Type.String({ description: "任务图标题，简短描述本次工作" }),
      goal: Type.Optional(Type.String({ description: "用户确认后的任务目标和验收口径" })),
      nodes: Type.Array(
        Type.Object({
          id: Type.Optional(Type.String({ description: "节点 ID，建议使用英文短 id，如 backend 或 review" })),
          title: Type.String({ description: "节点标题" }),
          task: Type.String({ description: "派给目标 agent 的完整工作包说明" }),
          agentId: Type.String({ description: "执行该节点的 agent id，必须来自当前团队列表" }),
          dependsOn: Type.Optional(Type.Array(Type.String(), { description: "依赖的节点 id 列表" })),
          model: Type.Optional(Type.String({ description: "可选模型覆盖" })),
          cwd: Type.Optional(Type.String({ description: "可选执行工作目录；省略则继承当前会话 cwd" })),
        }),
        { description: "任务节点列表；无依赖的节点会并发启动" },
      ),
      edges: Type.Optional(Type.Array(
        Type.Object({
          from: Type.String({ description: "依赖来源节点 id" }),
          to: Type.String({ description: "依赖目标节点 id" }),
          type: Type.Optional(Type.String({ description: "边类型，默认 dependency" })),
        }),
        { description: "可选依赖边，等价于目标节点 dependsOn" },
      )),
    }),

    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const orchestrator = deps.getTaskOrchestrator?.();
      if (!orchestrator) {
        return { content: [{ type: "text", text: "任务编排器未初始化。" }] };
      }
      const run = orchestrator.createRun({
        title: text(params.title) || "未命名任务",
        goal: text(params.goal),
        nodes: Array.isArray(params.nodes) ? params.nodes : [],
        edges: Array.isArray(params.edges) ? params.edges : [],
        rootSessionPath: getToolSessionPath(ctx) || deps.getCurrentSessionPath?.() || null,
        cwd: getToolSessionCwd(ctx) || deps.getParentCwd?.() || null,
        createdByAgentId: deps.currentAgentId || null,
      });
      return {
        content: [{
          type: "text",
          text: `已创建任务编排 ${run.id}，${run.nodes.length} 个节点会按依赖并发执行。`,
        }],
        details: {
          runId: run.id,
          title: run.title,
          status: run.status,
          nodeCount: run.nodes.length,
        },
      };
    },
  };
}
