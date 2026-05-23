const DEFAULT_BOARD_ID = "default-board";

export function asText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function firstLine(value, fallback) {
  const text = asText(value);
  if (!text) return fallback;
  return text.split(/\r?\n/).map(line => line.trim()).find(Boolean)?.slice(0, 80) || fallback;
}

export function uniqueTextList(value) {
  const input = Array.isArray(value) ? value : [];
  return [...new Set(input.map(item => asText(item)).filter(Boolean))];
}

export function findTaskBoardContext(task) {
  return (task?.contextRefs || []).find(item => (
    item && typeof item === "object" && !Array.isArray(item) && item.type === "task_board"
  )) || {};
}

function listAgents(runtime) {
  return typeof runtime?.listAgents === "function" ? runtime.listAgents() : [];
}

function agentLabel(agent) {
  return asText(agent?.name || agent?.displayName || agent?.id, "agent");
}

function nodeIdForAgent(agentId, fallback) {
  return asText(agentId, fallback)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function currentAgentId(runtime) {
  return asText(runtime?.currentAgentId || runtime?.getCurrentAgentId?.(), null);
}

function currentSessionPath(runtime) {
  return asText(runtime?.currentSessionPath || runtime?.getCurrentSessionPath?.(), null);
}

function currentCwd(runtime) {
  return asText(runtime?.deskCwd || runtime?.cwd || runtime?.getCwd?.(), null);
}

function taskOrchestrator(runtime) {
  return runtime?.taskOrchestrator || runtime?.getTaskOrchestrator?.() || null;
}

export function resolveBoardAgentContext(runtime, task, body = {}) {
  const boardContext = findTaskBoardContext(task);
  const agents = listAgents(runtime);
  const knownIds = new Set(agents.map(agent => agent.id).filter(Boolean));
  const fallbackAgentId = agents[0]?.id || currentAgentId(runtime) || null;
  const coordinatorAgentId = asText(
    body.coordinatorAgentId ||
    body.assigneeAgentId ||
    task.assignee?.id ||
    boardContext.coordinatorAgentId ||
    currentAgentId(runtime) ||
    fallbackAgentId,
    fallbackAgentId,
  );
  const rawSelectedAgentIds = uniqueTextList(body.selectedAgentIds || boardContext.selectedAgentIds);
  const selectedAgentIds = knownIds.size
    ? rawSelectedAgentIds.filter(id => knownIds.has(id))
    : rawSelectedAgentIds;
  const collaboratorAgentIds = selectedAgentIds.filter(id => id !== coordinatorAgentId);
  const resolvedCoordinatorAgentId = knownIds.has(coordinatorAgentId) ? coordinatorAgentId : (fallbackAgentId || coordinatorAgentId);
  return {
    coordinatorAgentId: resolvedCoordinatorAgentId,
    collaboratorAgentIds,
    selectedAgentIds: uniqueTextList([resolvedCoordinatorAgentId, ...collaboratorAgentIds]),
    agentsById: new Map(agents.map(agent => [agent.id, agent])),
  };
}

export function buildTaskBoardContext(input = {}) {
  const selectedAgentIds = uniqueTextList(input.selectedAgentIds);
  const boardId = asText(input.boardId, DEFAULT_BOARD_ID);
  return {
    type: "task_board",
    boardId,
    boardTitle: asText(input.boardTitle, boardId === DEFAULT_BOARD_ID ? "默认项目" : ""),
    coordinatorAgentId: asText(input.coordinatorAgentId, null),
    selectedAgentIds,
  };
}

export function buildManualTaskPrompt(task, collaboratorAgentIds = []) {
  const taskBody = [task.goal, task.body].filter(Boolean).join("\n\n") || task.title;
  const collaboratorLine = collaboratorAgentIds.length
    ? `\n协作子代理：${collaboratorAgentIds.join(", ")}。这些子代理已作为上游 worker 执行；你启动时会收到它们的结构化完成摘要、metadata、产物和阻塞信息。`
    : "\n当前看板未选择子代理，请直接完成任务。";
  return [
    "你是项目看板的主代理。请根据下面的任务完成最终收口，必要时先检查代码和当前项目状态。",
    "",
    "执行规则：",
    "- 你必须真实执行任务所需的检查、修改、整合或验证；不能只复述任务。",
    "- 如果有上游子代理结果，先阅读依赖 handoff，再判断是否需要补充执行、修正或验证。",
    "- 优先使用任务工具交接结果：完成时调用 task_complete，无法继续且需要人工输入时调用 task_block。",
    "- 长时间执行时调用 task_heartbeat 写入进展；有中间结论、问题或交接说明时调用 task_comment 留在任务详情里。",
    "- task_complete 的 summary 要说明实际完成了什么；metadata 可放 JSON 字符串，包含验证命令、改动文件、风险或结果。",
    "- 如果当前环境没有任务工具，才退回文本协议：完成输出 <task_result status=\"done\">，阻塞输出 <task_result status=\"blocked\">，失败输出 <task_result status=\"failed\">。",
    "- 不要把“需要用户决定/授权/确认”的情况标记为 done。",
    "",
    `任务标题：${task.title}`,
    `任务内容：${taskBody}`,
    collaboratorLine,
  ].join("\n");
}

export function buildCollaboratorTaskPrompt(task, coordinatorAgentId, collaboratorAgentId) {
  const taskBody = [task.goal, task.body].filter(Boolean).join("\n\n") || task.title;
  return [
    "你是项目看板的协作子代理。请独立完成你能负责的一部分工作，并把结果结构化交接给主代理。",
    "",
    "执行规则：",
    "- 你必须真实检查、分析、实现或验证任务中与你相关的部分；不能只回复建议。",
    "- 避免和其他 worker 做无意义重复；如果任务没有明确分工，就优先从你的能力角度补充实现、审查、验证或风险发现。",
    "- 如需修改共享文件，保持范围最小，并在 task_complete metadata 中列出 changed_files、tests_run、risks 或 artifacts。",
    "- 完成时调用 task_complete；无法继续且需要用户或主代理输入时调用 task_block。",
    "- 长时间执行时调用 task_heartbeat；有中间结论时调用 task_comment。",
    "- 不要把“需要用户决定/授权/确认”的情况标记为 done。",
    "",
    `主代理：${coordinatorAgentId || "(未指定)"}`,
    `你的 agent：${collaboratorAgentId}`,
    `任务标题：${task.title}`,
    `任务内容：${taskBody}`,
  ].join("\n");
}

export function startManualTaskRun(runtime, task, body = {}) {
  const orchestrator = taskOrchestrator(runtime);
  if (!orchestrator?.createRun) return null;
  const activeRun = orchestrator.findActiveRunForTask?.(task.id);
  if (activeRun) return activeRun;
  if (task.status === "running" && task.currentRunId) {
    return orchestrator.getRun?.(task.currentRunId) || { id: task.currentRunId, taskId: task.id, status: "running" };
  }
  const { coordinatorAgentId, collaboratorAgentIds, agentsById } = resolveBoardAgentContext(runtime, task, body);
  const collaboratorNodes = collaboratorAgentIds.map((agentId, index) => {
    const agent = agentsById?.get?.(agentId);
    const id = `worker-${nodeIdForAgent(agentId, `agent-${index + 1}`)}`;
    return {
      id,
      title: `${agentLabel(agent)} 协作：${task.title}`,
      task: buildCollaboratorTaskPrompt(task, coordinatorAgentId, agentId),
      agentId,
    };
  });
  const mainNode = {
    id: "main",
    title: collaboratorNodes.length ? `汇总并完成：${task.title}` : `执行：${task.title}`,
    task: buildManualTaskPrompt(task, collaboratorAgentIds),
    agentId: coordinatorAgentId,
    dependsOn: collaboratorNodes.map(node => node.id),
  };
  return orchestrator.createRun({
    taskId: task.id,
    title: task.title,
    goal: task.goal || task.body || task.title,
    rootSessionPath: task.rootSessionPath || currentSessionPath(runtime) || null,
    cwd: task.cwd || currentCwd(runtime) || null,
    createdByAgentId: coordinatorAgentId,
    nodes: [...collaboratorNodes, mainNode],
  });
}
