import fs from "node:fs";
import path from "node:path";
import { Type } from "../pi-sdk/index.js";
import { toolError, toolOk } from "../tools/tool-result.js";

const NODE_STATUSES = new Set(["pending", "running", "blocked", "done", "failed", "aborted"]);
const RESULT_STATUSES = new Set(["done", "blocked", "failed"]);
const WORKER_CUSTOM_TOOLS = ["web_search", "web_fetch", "todo_write", "browser"];
const WORKER_BUILTIN_TOOLS = ["read", "write", "edit", "bash", "grep", "find", "ls"];
const TASK_WORKER_TOOLS = ["task_complete", "task_block", "task_heartbeat", "task_comment"];
const MAX_STORED_WORKER_OUTPUT = 12000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
const DEFAULT_CLAIM_TTL_MS = 45000;

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function asText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeNodeId(value, index) {
  const raw = asText(value, `node-${index + 1}`);
  return raw.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || `node-${index + 1}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function edgeKey(edge) {
  return `${edge.from}->${edge.to}`;
}

function cloneRun(run) {
  return JSON.parse(JSON.stringify(run));
}

function summarizeResult(result) {
  if (typeof result?.replyText === "string" && result.replyText.trim()) {
    return result.replyText.trim().slice(0, 600);
  }
  if (Array.isArray(result?.sessionFiles) && result.sessionFiles.length) {
    return `产物 ${result.sessionFiles.length} 个`;
  }
  if (result?.error) return String(result.error);
  return "";
}

function capText(value, limit = MAX_STORED_WORKER_OUTPUT) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[output truncated: ${text.length - limit} chars omitted]`;
}

function metadataText(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeArtifacts(value) {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value];
}

function parseTaskResultProtocol(text) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return null;
  const match = raw.match(/<task_result\s+status=["']?(done|blocked|failed)["']?\s*>([\s\S]*?)<\/task_result>/i);
  if (!match) return null;
  const status = String(match[1] || "").toLowerCase();
  if (!RESULT_STATUSES.has(status)) return null;
  const body = String(match[2] || "").trim();
  const fields = {};
  let currentKey = null;
  for (const line of body.split(/\r?\n/)) {
    const field = line.match(/^\s*(summary|reason|error|metadata)\s*:\s*(.*)$/i);
    if (field) {
      currentKey = field[1].toLowerCase();
      fields[currentKey] = field[2] || "";
    } else if (currentKey) {
      fields[currentKey] = `${fields[currentKey]}\n${line}`.trim();
    }
  }
  return {
    status,
    summary: (fields.summary || body).trim(),
    reason: (fields.reason || fields.error || "").trim(),
    error: (fields.error || "").trim(),
    metadata: (fields.metadata || "").trim(),
  };
}

function visibleWorkerOutput(text) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return "";
  return capText(raw.replace(/<task_result\s+status=["']?(?:done|blocked|failed)["']?\s*>[\s\S]*?<\/task_result>/ig, "").trim());
}

function deriveRunSummary(run) {
  const failed = run.nodes.find(node => node.status === "failed");
  const blocked = run.nodes.find(node => node.status === "blocked");
  const running = run.nodes.find(node => node.status === "running");
  const done = [...run.nodes].reverse().find(node => node.status === "done");
  const node = failed || blocked || running || done || run.nodes[0];
  return node?.summary || "";
}

function dependencyHandoffText(run, node) {
  const deps = Array.isArray(node.dependsOn) ? node.dependsOn : [];
  if (!deps.length) return "";
  const byId = new Map((run.nodes || []).map(item => [item.id, item]));
  const lines = [];
  for (const depId of deps) {
    const dep = byId.get(depId);
    if (!dep) continue;
    lines.push(`### ${dep.title || dep.id} (${dep.agentId || "agent"}, ${dep.status})`);
    if (dep.summary) lines.push(`summary: ${capText(dep.summary, 3000)}`);
    if (dep.resultReason) lines.push(`reason: ${capText(dep.resultReason, 2000)}`);
    if (dep.resultError) lines.push(`error: ${capText(dep.resultError, 2000)}`);
    if (dep.resultMetadata) lines.push(`metadata: ${capText(dep.resultMetadata, 3000)}`);
    if (Array.isArray(dep.artifacts) && dep.artifacts.length) {
      lines.push(`artifacts: ${dep.artifacts.map(item => String(item)).join(", ")}`);
    }
    if (dep.output) lines.push(`visible_output: ${capText(dep.output, 4000)}`);
    lines.push("");
  }
  if (!lines.length) return "";
  return [
    "",
    "---",
    "上游 worker handoff（由任务编排器注入，作为本节点的输入事实）：",
    "",
    ...lines,
    "---",
  ].join("\n");
}

function dateMs(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export class TaskOrchestrator {
  constructor(deps = {}) {
    this._deps = deps;
    this._persistencePath = typeof deps.persistencePath === "string" ? deps.persistencePath : null;
    this._runs = new Map();
    this._controllers = new Map();
    this._heartbeats = new Map();
    this._loadPersisted();
    this._syncLoadedRunsToLedger();
    this._persist();
  }

  listRuns() {
    return [...this._runs.values()]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(cloneRun);
  }

  getRun(runId) {
    const run = this._runs.get(runId);
    return run ? cloneRun(run) : null;
  }

  findActiveRunForTask(taskId) {
    if (!taskId) return null;
    const run = [...this._runs.values()]
      .filter(item => item.taskId === taskId && item.status === "running")
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
      .find(Boolean);
    return run ? cloneRun(run) : null;
  }

  listActiveWorkers() {
    const now = Date.now();
    const workers = [];
    for (const run of this._runs.values()) {
      for (const node of run.nodes || []) {
        if (node.status !== "running") continue;
        workers.push(this._workerInfo(run, node, now));
      }
    }
    return workers.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
  }

  inspectRun(runId) {
    const run = this._runs.get(runId);
    if (!run) return null;
    const now = Date.now();
    const activeWorkers = (run.nodes || [])
      .filter(node => node.status === "running")
      .map(node => this._workerInfo(run, node, now));
    return {
      run: cloneRun(run),
      active: activeWorkers.length > 0,
      activeWorkers,
      staleWorkers: activeWorkers.filter(worker => worker.stale),
    };
  }

  createRun(input = {}) {
    const runId = makeId("run");
    const rootSessionPath = asText(input.rootSessionPath, this._deps.getCurrentSessionPath?.() || null);
    const cwd = asText(input.cwd, this._deps.getCwd?.() || null);
    const nodes = this._normalizeNodes(input.nodes || []);
    if (!nodes.length) throw new Error("task_orchestrate requires at least one node");
    const edges = this._normalizeEdges(input.edges || [], nodes);

    for (const edge of edges) {
      const target = nodes.find(n => n.id === edge.to);
      if (target) target.dependsOn = unique([...(target.dependsOn || []), edge.from]);
    }
    this._validateDependencies(nodes);
    this._mergeDependencyEdges(edges, nodes);

    const title = asText(input.title, "未命名任务");
    const goal = asText(input.goal, "");
    const ledger = this._deps.getTaskLedger?.() || null;
    const ledgerTask = input.taskId
      ? ledger?.getTask?.(input.taskId)
      : ledger?.createTask?.({
        title,
        goal,
        body: goal,
        status: "running",
        source: { type: "task_orchestrate" },
        rootSessionPath,
        cwd,
        assignee: asText(input.createdByAgentId, null),
      });
    const taskId = asText(input.taskId, ledgerTask?.id || null);

    const run = {
      id: runId,
      taskId,
      title,
      goal,
      status: "running",
      summary: "",
      rootSessionPath,
      cwd,
      createdByAgentId: asText(input.createdByAgentId, null),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      nodes,
      edges,
      events: [],
    };
    this._runs.set(runId, run);
    this._appendEvent(run, "created", `任务图已创建：${run.title}`);
    ledger?.attachRun?.(taskId, cloneRun(run));
    this._emit(run);
    queueMicrotask(() => this._schedule(runId));
    return cloneRun(run);
  }

  cancelRun(runId, reason = "canceled") {
    const run = this._runs.get(runId);
    if (!run) return null;
    run.status = "aborted";
    run.updatedAt = nowIso();
    for (const node of run.nodes) {
      if (node.status === "running" || node.status === "pending" || node.status === "blocked") {
        node.status = "aborted";
        node.summary = reason;
        node.updatedAt = nowIso();
      }
      const ctrl = this._controllers.get(`${runId}:${node.id}`);
      if (ctrl) ctrl.abort();
    }
    this._appendEvent(run, "aborted", reason);
    this._emit(run);
    return cloneRun(run);
  }

  _normalizeNodes(nodes) {
    const seen = new Set();
    const agents = this._deps.listAgents?.() || [];
    const defaultAgentId = agents[0]?.id || null;
    const result = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i] || {};
      let id = normalizeNodeId(node.id, i);
      while (seen.has(id)) id = `${id}-${i + 1}`;
      seen.add(id);
      result.push({
        id,
        title: asText(node.title, id),
        task: asText(node.task || node.prompt, asText(node.title, id)),
        agentId: asText(node.agentId || node.agent, defaultAgentId),
        model: asText(node.model, null),
        cwd: asText(node.cwd, null),
        dependsOn: Array.isArray(node.dependsOn) ? unique(node.dependsOn.map(String)) : [],
        status: NODE_STATUSES.has(node.status) ? node.status : "pending",
        sessionPath: null,
        summary: "",
        output: "",
        resultStatus: null,
        resultReason: "",
        resultError: "",
        resultMetadata: "",
        claimLock: null,
        claimExpiresAt: null,
        lastHeartbeatAt: null,
        heartbeatCount: 0,
        artifacts: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    }
    return result;
  }

  _normalizeEdges(edges, nodes) {
    const ids = new Set(nodes.map(n => n.id));
    const result = [];
    const seen = new Set();
    for (const raw of edges) {
      const from = asText(raw?.from);
      const to = asText(raw?.to);
      if (!ids.has(from) || !ids.has(to) || from === to) continue;
      const key = `${from}->${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        from,
        to,
        type: asText(raw.type, "dependency"),
      });
    }
    return result;
  }

  _validateDependencies(nodes) {
    const ids = new Set(nodes.map(n => n.id));
    for (const node of nodes) {
      const invalid = (node.dependsOn || []).filter(dep => !ids.has(dep) || dep === node.id);
      if (invalid.length) {
        throw new Error(`Invalid dependencies for ${node.id}: ${invalid.join(", ")}`);
      }
      node.dependsOn = unique(node.dependsOn || []);
    }
  }

  _mergeDependencyEdges(edges, nodes) {
    const seen = new Set(edges.map(edgeKey));
    for (const node of nodes) {
      for (const dep of node.dependsOn || []) {
        const edge = { from: dep, to: node.id, type: "dependency" };
        const key = edgeKey(edge);
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push(edge);
      }
    }
  }

  _appendEvent(run, type, message, nodeId = null) {
    run.events.unshift({
      id: makeId("evt"),
      type,
      message,
      nodeId,
      at: nowIso(),
    });
    run.events = run.events.slice(0, 80);
  }

  _emit(run, options = {}) {
    const snapshot = cloneRun(run);
    if (options.healthOnly) snapshot.healthOnly = true;
    this._deps.getTaskLedger?.()?.updateRunSnapshot?.(snapshot);
    this._persist();
    this._deps.emitEvent?.({ type: "task_graph_update", run: snapshot }, run.rootSessionPath || null);
  }

  _persist() {
    if (!this._persistencePath) return;
    try {
      fs.mkdirSync(path.dirname(this._persistencePath), { recursive: true });
      fs.writeFileSync(this._persistencePath, JSON.stringify({ runs: [...this._runs.values()] }, null, 2));
    } catch (err) {
      console.warn(`[task-orchestrator] persist failed: ${err.message}`);
    }
  }

  _loadPersisted() {
    if (!this._persistencePath || !fs.existsSync(this._persistencePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this._persistencePath, "utf8"));
      const runs = Array.isArray(parsed?.runs) ? parsed.runs : [];
      for (const run of runs) {
        if (!run?.id) continue;
        const restored = this._restoreRun(run);
        this._runs.set(restored.id, restored);
      }
    } catch (err) {
      console.warn(`[task-orchestrator] load failed: ${err.message}`);
    }
  }

  _restoreRun(run) {
    const restored = {
      ...run,
      nodes: Array.isArray(run.nodes) ? run.nodes.map(node => ({
        ...node,
        claimLock: node.claimLock || null,
        claimExpiresAt: node.claimExpiresAt || null,
        lastHeartbeatAt: node.lastHeartbeatAt || null,
        heartbeatCount: Number.isFinite(node.heartbeatCount) ? node.heartbeatCount : 0,
      })) : [],
      edges: Array.isArray(run.edges) ? run.edges : [],
      events: Array.isArray(run.events) ? run.events : [],
    };
    if (restored.status === "running") {
      restored.status = "blocked";
      restored.summary = restored.summary || "服务重启后，之前的 worker 运行状态无法继续追踪，需要重新开始。";
      for (const node of restored.nodes) {
        if (node.status === "running" || node.status === "pending") {
          node.status = "blocked";
          node.summary = node.summary || "服务重启后 worker 已断开，需要重新开始。";
          node.resultReason = node.resultReason || node.summary;
          node.claimExpiresAt = null;
          node.claimLock = null;
        }
      }
      this._appendEvent(restored, "blocked", "服务重启后，运行中的任务已标记为阻塞");
    }
    return restored;
  }

  _syncLoadedRunsToLedger() {
    const ledger = this._deps.getTaskLedger?.();
    if (!ledger) return;
    for (const run of this._runs.values()) {
      ledger.updateRunSnapshot?.({ ...cloneRun(run), healthOnly: true, silent: true });
    }
  }

  _schedule(runId) {
    const run = this._runs.get(runId);
    if (!run || run.status === "aborted") return;

    const completed = new Set(run.nodes.filter(n => n.status === "done").map(n => n.id));
    let started = 0;
    for (const node of run.nodes) {
      if (node.status !== "pending") continue;
      const depsMet = (node.dependsOn || []).every(id => completed.has(id));
      if (!depsMet) continue;
      this._startNode(run, node);
      started++;
    }

    if (started > 0) this._emit(run);
    this._refreshRunStatus(run);
  }

  _refreshRunStatus(run) {
    if (run.status === "aborted") return;
    const previousStatus = run.status;
    if (run.nodes.some(n => n.status === "failed")) {
      run.status = "failed";
    } else if (run.nodes.some(n => n.status === "blocked") && !run.nodes.some(n => n.status === "running")) {
      run.status = "blocked";
      if (previousStatus !== "blocked") this._appendEvent(run, "blocked", "任务图已阻塞");
    } else if (run.nodes.every(n => n.status === "done")) {
      run.status = "done";
      if (previousStatus !== "done") this._appendEvent(run, "done", "任务图已完成");
    } else {
      run.status = "running";
    }
    run.summary = deriveRunSummary(run);
    run.updatedAt = nowIso();
    this._emit(run);
  }

  _startNode(run, node) {
    const agent = this._deps.getAgentById?.(node.agentId);
    if (!agent) {
      node.status = "failed";
      node.summary = `Agent not found: ${node.agentId}`;
      node.updatedAt = nowIso();
      this._appendEvent(run, "failed", `${node.title} 找不到 agent：${node.agentId}`, node.id);
      return;
    }

    node.status = "running";
    node.startedAt = nowIso();
    node.updatedAt = node.startedAt;
    node.lastHeartbeatAt = node.startedAt;
    node.heartbeatCount = 0;
    node.claimLock = `${run.id}:${node.id}:${Date.now().toString(36)}`;
    node.claimExpiresAt = new Date(Date.now() + this._claimTtlMs()).toISOString();
    this._appendEvent(run, "running", `${node.agentId} 开始执行：${node.title}`, node.id);

    const controller = new AbortController();
    const workerKey = `${run.id}:${node.id}`;
    this._controllers.set(workerKey, controller);
    const persist = path.join(agent.agentDir, "task-runs", run.id);
    const cwd = node.cwd || run.cwd || undefined;
    this._startHeartbeat(run, node, workerKey);
    const taskTools = this._createTaskWorkerTools(run, node, workerKey);
    const workerPrompt = `${node.task}${dependencyHandoffText(run, node)}`;

    const execution = this._deps.executeIsolated?.(workerPrompt, {
      agentId: node.agentId,
      cwd,
      parentSessionPath: run.rootSessionPath || undefined,
      emitEvents: true,
      persist,
      model: node.model || undefined,
      toolFilter: [...WORKER_CUSTOM_TOOLS, ...TASK_WORKER_TOOLS],
      builtinFilter: WORKER_BUILTIN_TOOLS,
      extraTools: taskTools,
      subagentContext: true,
      fileReadSessionPaths: run.rootSessionPath ? [run.rootSessionPath] : [],
      signal: controller.signal,
      onSessionReady: (sessionPath) => {
        node.sessionPath = sessionPath || null;
        node.updatedAt = nowIso();
        this._appendEvent(run, "session", `${node.title} session 已就绪`, node.id);
        this._emit(run);
      },
    });
    if (!execution || typeof execution.then !== "function") {
      this._stopHeartbeat(workerKey);
      this._controllers.delete(workerKey);
      node.status = "failed";
      node.summary = "executeIsolated is unavailable";
      node.updatedAt = nowIso();
      node.claimExpiresAt = null;
      this._appendEvent(run, "failed", `${node.title} 无法启动执行器`, node.id);
      this._emit(run, { healthOnly: true });
      this._refreshRunStatus(run);
      return;
    }

    execution.then(result => {
      if (run.status === "aborted" || controller.signal.aborted) {
        node.status = "aborted";
        node.summary = "aborted";
        return;
      }
      const taskResult = parseTaskResultProtocol(result?.replyText);
      const output = visibleWorkerOutput(result?.replyText);
      node.output = output;
      if (node.completedByTool === true) {
        if (!node.output) node.output = output;
        this._appendEvent(run, "handoff", `${node.title} 已通过任务工具交接`, node.id);
        return;
      }
      node.resultStatus = taskResult?.status || null;
      node.resultMetadata = taskResult?.metadata || "";
      if (result?.error) {
        node.status = "failed";
        node.summary = summarizeResult(result) || String(result.error);
        node.resultError = String(result.error);
        this._appendEvent(run, "failed", `${node.title} 执行失败`, node.id);
      } else if (taskResult?.status === "blocked") {
        node.status = "blocked";
        node.summary = taskResult.reason || taskResult.summary || "需要人工输入";
        node.resultReason = taskResult.reason || taskResult.summary || "";
        this._appendEvent(run, "blocked", `${node.title} 请求人工输入`, node.id);
      } else if (taskResult?.status === "failed") {
        node.status = "failed";
        node.summary = taskResult.error || taskResult.reason || taskResult.summary || "执行失败";
        node.resultError = taskResult.error || taskResult.reason || taskResult.summary || "";
        this._appendEvent(run, "failed", `${node.title} 执行失败`, node.id);
      } else {
        node.status = "done";
        node.summary = taskResult?.summary || summarizeResult(result);
        node.artifacts = Array.isArray(result?.sessionFiles) ? result.sessionFiles : [];
        this._appendEvent(run, "done", `${node.title} 已完成`, node.id);
      }
    }).catch(err => {
      node.status = controller.signal.aborted ? "aborted" : "failed";
      node.summary = err?.message || String(err);
      this._appendEvent(run, node.status, `${node.title} ${node.status}`, node.id);
    }).finally(() => {
      this._stopHeartbeat(workerKey);
      this._controllers.delete(workerKey);
      node.completedAt = nowIso();
      node.updatedAt = node.completedAt;
      node.claimExpiresAt = null;
      node.claimLock = null;
      run.updatedAt = node.updatedAt;
      this._emit(run);
      this._schedule(run.id);
    });
  }

  _heartbeatIntervalMs() {
    const value = Number(this._deps.taskHeartbeatIntervalMs);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_HEARTBEAT_INTERVAL_MS;
  }

  _claimTtlMs() {
    const value = Number(this._deps.taskClaimTtlMs);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_CLAIM_TTL_MS;
  }

  _startHeartbeat(run, node, workerKey) {
    this._stopHeartbeat(workerKey);
    const tick = () => {
      if (!this._controllers.has(workerKey) || run.status === "aborted" || node.status !== "running") return;
      node.lastHeartbeatAt = nowIso();
      node.claimExpiresAt = new Date(Date.now() + this._claimTtlMs()).toISOString();
      node.heartbeatCount = (node.heartbeatCount || 0) + 1;
      node.updatedAt = node.lastHeartbeatAt;
      run.updatedAt = node.lastHeartbeatAt;
      this._emit(run, { healthOnly: true });
    };
    const timer = setInterval(tick, this._heartbeatIntervalMs());
    timer.unref?.();
    this._heartbeats.set(workerKey, timer);
  }

  _stopHeartbeat(workerKey) {
    const timer = this._heartbeats.get(workerKey);
    if (timer) clearInterval(timer);
    this._heartbeats.delete(workerKey);
  }

  _workerInfo(run, node, now = Date.now()) {
    const lastHeartbeatMs = dateMs(node.lastHeartbeatAt);
    const claimExpiresMs = dateMs(node.claimExpiresAt);
    const startedMs = dateMs(node.startedAt);
    return {
      runId: run.id,
      taskId: run.taskId || null,
      nodeId: node.id,
      title: node.title,
      agentId: node.agentId,
      status: node.status,
      sessionPath: node.sessionPath || null,
      claimLock: node.claimLock || null,
      claimExpiresAt: node.claimExpiresAt || null,
      lastHeartbeatAt: node.lastHeartbeatAt || null,
      heartbeatCount: node.heartbeatCount || 0,
      startedAt: node.startedAt || null,
      runtimeMs: startedMs ? Math.max(0, now - startedMs) : 0,
      stale: claimExpiresMs ? claimExpiresMs < now : false,
      heartbeatAgeMs: lastHeartbeatMs ? Math.max(0, now - lastHeartbeatMs) : null,
    };
  }

  _createTaskWorkerTools(run, node, workerKey) {
    const completeNode = ({ status, summary, reason = "", error = "", metadata = "", artifacts = [] }) => {
      if (!this._controllers.has(workerKey) || node.status !== "running") {
        return { ok: false, message: "task worker is no longer running" };
      }
      const at = nowIso();
      node.status = status;
      node.completedByTool = true;
      node.resultStatus = status === "done" ? "done" : status === "blocked" ? "blocked" : "failed";
      node.summary = summary || reason || error || (status === "done" ? "已完成" : status === "blocked" ? "需要人工输入" : "执行失败");
      node.resultReason = reason || "";
      node.resultError = error || "";
      node.resultMetadata = metadataText(metadata);
      node.artifacts = normalizeArtifacts(artifacts);
      node.completedAt = at;
      node.updatedAt = at;
      node.claimExpiresAt = null;
      node.claimLock = null;
      run.updatedAt = at;
      this._appendEvent(run, status, `${node.title} ${status === "done" ? "已通过 task_complete 完成" : status === "blocked" ? "已通过 task_block 阻塞" : "已通过 task_complete 标记失败"}`, node.id);
      this._emit(run);
      this._refreshRunStatus(run);
      return { ok: true, message: node.summary };
    };

    return [
      {
        name: "task_complete",
        label: "完成看板任务",
        description: "完成当前看板 worker 任务并写入结构化 handoff。只作用于当前被分配的任务。",
        parameters: Type.Object({
          summary: Type.String({ description: "完成摘要，说明实际做了什么以及结果。" }),
          metadata: Type.Optional(Type.String({ description: "可选结构化元数据，建议 JSON 字符串，例如验证命令、改动文件、风险。" })),
          artifacts: Type.Optional(Type.Array(Type.String(), { description: "可选产物路径列表。" })),
        }),
        execute: async (_toolCallId, params) => {
          const summary = asText(params.summary);
          if (!summary) return toolError("summary is required");
          const result = completeNode({
            status: "done",
            summary,
            metadata: params.metadata,
            artifacts: params.artifacts,
          });
          return result.ok
            ? toolOk("任务已标记完成。现在停止继续执行，直接结束回复。", { runId: run.id, nodeId: node.id, status: "done" })
            : toolError(result.message, { runId: run.id, nodeId: node.id });
        },
      },
      {
        name: "task_block",
        label: "阻塞看板任务",
        description: "当前 worker 无法继续时调用，写入需要用户或上游处理的具体阻塞原因。",
        parameters: Type.Object({
          reason: Type.String({ description: "明确、可行动的阻塞原因。" }),
          metadata: Type.Optional(Type.String({ description: "可选结构化上下文，建议 JSON 字符串。" })),
        }),
        execute: async (_toolCallId, params) => {
          const reason = asText(params.reason);
          if (!reason) return toolError("reason is required");
          const result = completeNode({
            status: "blocked",
            summary: reason,
            reason,
            metadata: params.metadata,
          });
          return result.ok
            ? toolOk("任务已标记阻塞。现在停止继续执行，直接结束回复。", { runId: run.id, nodeId: node.id, status: "blocked" })
            : toolError(result.message, { runId: run.id, nodeId: node.id });
        },
      },
      {
        name: "task_heartbeat",
        label: "任务心跳",
        description: "长时间工作时发送心跳，说明当前进展并延长当前 worker 的执行 claim。",
        parameters: Type.Object({
          note: Type.Optional(Type.String({ description: "当前进展或正在等待的事项。" })),
        }),
        execute: async (_toolCallId, params) => {
          if (!this._controllers.has(workerKey) || node.status !== "running") {
            return toolError("task worker is no longer running", { runId: run.id, nodeId: node.id });
          }
          const at = nowIso();
          node.lastHeartbeatAt = at;
          node.claimExpiresAt = new Date(Date.now() + this._claimTtlMs()).toISOString();
          node.heartbeatCount = (node.heartbeatCount || 0) + 1;
          node.updatedAt = at;
          run.updatedAt = at;
          const note = asText(params.note);
          this._appendEvent(run, "heartbeat", note || `${node.title} heartbeat`, node.id);
          this._emit(run);
          return toolOk("heartbeat recorded", {
            runId: run.id,
            nodeId: node.id,
            claimExpiresAt: node.claimExpiresAt,
            heartbeatCount: node.heartbeatCount,
          });
        },
      },
      {
        name: "task_comment",
        label: "任务评论",
        description: "给当前看板任务追加评论，用于留下中间结论、问题或交接说明。",
        parameters: Type.Object({
          body: Type.String({ description: "评论内容。" }),
        }),
        execute: async (_toolCallId, params) => {
          const body = asText(params.body);
          if (!body) return toolError("body is required");
          const ledger = this._deps.getTaskLedger?.();
          if (!ledger || !run.taskId) return toolError("task ledger unavailable", { runId: run.id, nodeId: node.id });
          const comment = ledger.addComment?.(run.taskId, {
            author: node.agentId || "worker",
            body,
            channel: "task_worker",
            meta: { runId: run.id, nodeId: node.id },
          });
          if (!comment) return toolError("task not found", { runId: run.id, nodeId: node.id, taskId: run.taskId });
          return toolOk("comment recorded", { runId: run.id, nodeId: node.id, taskId: run.taskId, commentId: comment.id });
        },
      },
    ];
  }
}
