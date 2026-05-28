import { useEffect, useMemo, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { useStore } from '../../stores';
import type {
  TaskBoard,
  TaskDiagnostic,
  TaskLedgerArtifact,
  TaskLedgerBlocker,
  TaskLedgerEvent,
  TaskGraphNode,
  TaskLedgerStatus,
  TaskLedgerTask,
  TaskRun,
} from '../../stores/task-graph-slice';
import type { Agent } from '../../types';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { logAsyncPerf } from '../../utils/perf';
import { TASK_DRAG_MIME, hasTaskDrag } from '../../utils/task-drag';
import styles from './TaskPage.module.css';

const CARD_W = 238;
const CARD_H = 104;
const LABEL_W = 132;
const COL_W = 296;
const ROW_H = 144;
const TOP = 30;
const LANE_GAP = 18;
const DEFAULT_BOARD_ID = 'default-board';
const TASK_REFRESH_TTL_MS = 15_000;
let lastTaskRefreshAt = 0;

type KanbanColumn = {
  id: TaskLedgerStatus;
  title: string;
  description: string;
};

const KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'triage', title: '待分类', description: '原始想法 - 规范制定者将完善规格' },
  { id: 'todo', title: '待办', description: '等待依赖项或未分配' },
  { id: 'scheduled', title: '已调度', description: '等待已知的时间延迟或已调度的跟进' },
  { id: 'ready', title: '就绪', description: '依赖项已满足；分配一个配置文件以便调度' },
  { id: 'running', title: '进行中', description: '已被工作者认领 - 执行中' },
  { id: 'blocked', title: '阻塞', description: '工作者请求人工输入' },
  { id: 'review', title: 'REVIEW', description: '等待验收、评审或修改意见' },
  { id: 'done', title: '已完成', description: '已完成' },
];

function statusLabel(status: string): string {
  switch (status) {
    case 'triage': return '待分类';
    case 'todo': return '待办';
    case 'scheduled': return '已调度';
    case 'ready': return '就绪';
    case 'running': return '进行中';
    case 'review': return 'REVIEW';
    case 'done': return '已完成';
    case 'failed': return '失败';
    case 'blocked': return '阻塞';
    case 'cancelled':
    case 'aborted': return '已取消';
    case 'archived': return '归档';
    case 'pending':
    default: return '等待';
  }
}

function statusClass(status: string): string {
  switch (status) {
    case 'triage': return styles.statusTriage;
    case 'scheduled': return styles.statusScheduled;
    case 'running': return styles.statusRunning;
    case 'review': return styles.statusReview;
    case 'done': return styles.statusDone;
    case 'failed': return styles.statusFailed;
    case 'blocked': return styles.statusBlocked;
    case 'cancelled':
    case 'aborted': return styles.statusAborted;
    default: return '';
  }
}

function columnToneClass(status: string): string {
  switch (status) {
    case 'triage': return styles.columnToneTriage;
    case 'todo': return styles.columnToneTodo;
    case 'scheduled': return styles.columnToneScheduled;
    case 'ready': return styles.columnToneReady;
    case 'running': return styles.columnToneRunning;
    case 'blocked': return styles.columnToneBlocked;
    case 'review': return styles.columnToneReview;
    case 'done': return styles.columnToneDone;
    default: return '';
  }
}

function taskMatchesColumn(task: TaskLedgerTask, columnId: TaskLedgerStatus): boolean {
  if (columnId === 'blocked') return task.status === 'blocked' || task.status === 'failed';
  return task.status === columnId;
}

function nodeClass(status: string): string {
  switch (status) {
    case 'running': return styles.nodeRunning;
    case 'done': return styles.nodeDone;
    case 'failed': return styles.nodeFailed;
    case 'aborted': return styles.nodeAborted;
    default: return '';
  }
}

function formatTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms?: number | null): string {
  if (!Number.isFinite(ms || 0) || !ms) return '';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} 秒`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分钟`;
  return `${(ms / 3_600_000).toFixed(1)} 小时`;
}

function formatPath(value?: string | null): string {
  if (!value) return '继承当前工作区';
  const parts = value.split('/').filter(Boolean);
  if (parts.length <= 2) return value;
  return `.../${parts.slice(-2).join('/')}`;
}

function diagnosticSeverityClass(severity?: string | null): string {
  switch (severity) {
    case 'critical': return styles.diagnosticCritical;
    case 'error': return styles.diagnosticError;
    case 'warning': return styles.diagnosticWarning;
    default: return '';
  }
}

function diagnosticLabel(severity?: string | null): string {
  switch (severity) {
    case 'critical': return '严重';
    case 'error': return '错误';
    case 'warning': return '提醒';
    default: return '诊断';
  }
}

function sourceLabel(task: TaskLedgerTask): string {
  const type = task.source?.type || 'manual';
  switch (type) {
    case 'manual': return '本地';
    case 'channel': return '频道';
    case 'subagent': return 'Subagent';
    case 'plugin': return 'Plugin';
    case 'cron': return 'Cron';
    case 'task_registry': return 'Registry';
    default: return String(type);
  }
}

function getTaskBoardId(task: TaskLedgerTask): string {
  const ref = (task.contextRefs || []).find((item): item is { type?: string; boardId?: string } => (
    !!item && typeof item === 'object' && !Array.isArray(item) && (item as { type?: string }).type === 'task_board'
  ));
  return ref?.boardId || DEFAULT_BOARD_ID;
}

function latestRunForTask(task: TaskLedgerTask, runsById: Record<string, TaskRun>): TaskRun | null {
  const runs = (task.runIds || [])
    .map(id => runsById[id])
    .filter((run): run is TaskRun => !!run)
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  return runs[0] || null;
}

function taskRunSummary(run: TaskRun | null): string {
  if (!run) return '';
  const failed = run.nodes.find(node => node.status === 'failed');
  const blocked = run.nodes.find(node => node.status === 'blocked');
  const active = run.nodes.find(node => node.status === 'running') || run.nodes.find(node => node.status === 'pending');
  const done = [...run.nodes].reverse().find(node => node.status === 'done');
  const node = failed || blocked || active || done || run.nodes[0];
  return run.summary || node?.summary || node?.task || '';
}

function taskResultSummary(task: TaskLedgerTask, run: TaskRun | null): string {
  return task.latestSummary || task.result || taskRunSummary(run);
}

function latestRunOutcome(run: TaskRun | null) {
  if (!run) return null;
  const failed = run.nodes.find(node => node.status === 'failed');
  const blocked = run.nodes.find(node => node.status === 'blocked');
  const running = run.nodes.find(node => node.status === 'running') || run.nodes.find(node => node.status === 'pending');
  const done = [...run.nodes].reverse().find(node => node.status === 'done');
  const node = failed || blocked || running || done || run.nodes[0] || null;
  if (!node) return null;
  return {
    run,
    node,
    status: failed ? 'failed' : blocked ? 'blocked' : running ? running.status : done ? 'done' : node.status,
    summary: node.summary || run.summary || '',
    reason: node.resultReason || node.resultError || '',
    metadata: node.resultMetadata || '',
    output: node.output || '',
    task: node.task || '',
  };
}

function formatDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function compactValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function artifactLabel(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return compactValue(value) || '产物';
  const obj = value as Record<string, unknown>;
  const preferred = obj.path || obj.filePath || obj.url || obj.name || obj.id || obj.title;
  return typeof preferred === 'string' && preferred.trim() ? preferred : '结构化产物';
}

function artifactDetail(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return compactValue(value);
}

function collectArtifacts(task: TaskLedgerTask, runs: TaskRun[]): Array<{ id: string; label: string; detail: string; runId?: string | null; nodeId?: string | null }> {
  const items: Array<{ id: string; label: string; detail: string; runId?: string | null; nodeId?: string | null }> = [];
  const seen = new Set<string>();
  const push = (artifact: unknown, runId?: string | null, nodeId?: string | null) => {
    const label = artifactLabel(artifact);
    const detail = artifactDetail(artifact);
    const key = `${runId || ''}:${nodeId || ''}:${label}:${detail}`;
    if (!label || seen.has(key)) return;
    seen.add(key);
    items.push({ id: key || `artifact-${items.length}`, label, detail, runId, nodeId });
  };

  for (const item of task.artifacts || []) {
    const artifact = (item as TaskLedgerArtifact).artifact !== undefined ? (item as TaskLedgerArtifact).artifact : item;
    push(artifact, (item as TaskLedgerArtifact).runId, (item as TaskLedgerArtifact).nodeId);
  }
  for (const run of runs) {
    for (const node of run.nodes || []) {
      for (const artifact of node.artifacts || []) push(artifact, run.id, node.id);
    }
  }
  return items;
}

function collectBlockers(task: TaskLedgerTask, latestRun: TaskRun | null): TaskLedgerBlocker[] {
  const blockers: TaskLedgerBlocker[] = [...(task.blockers || [])];
  for (const node of latestRun?.nodes || []) {
    if (node.status !== 'blocked' && node.status !== 'failed') continue;
    const reason = node.resultReason || node.resultError || node.summary;
    if (!reason) continue;
    blockers.push({
      runId: latestRun?.id || null,
      nodeId: node.id,
      agentId: node.agentId,
      reason,
      at: node.completedAt || node.updatedAt || latestRun?.updatedAt || null,
    });
  }
  const seen = new Set<string>();
  return blockers.filter(item => {
    const key = `${item.runId || ''}:${item.nodeId || ''}:${item.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type ActivityItem = {
  id: string;
  at: string;
  label: string;
  message: string;
  meta?: string;
  tone?: 'comment' | 'run' | 'task';
};

function eventLabel(type?: string): string {
  switch (type) {
    case 'task.created': return '创建';
    case 'task.status': return '状态';
    case 'task.updated': return '更新';
    case 'run.created': return '启动';
    case 'run.updated': return '运行';
    case 'created': return '创建';
    case 'running': return '运行';
    case 'done': return '完成';
    case 'blocked': return '阻塞';
    case 'failed': return '失败';
    case 'heartbeat': return '进展';
    case 'session': return '会话';
    case 'handoff': return '交接';
    default: return type || '事件';
  }
}

function buildActivity(task: TaskLedgerTask, runs: TaskRun[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const event of task.events || []) {
    const item = event as TaskLedgerEvent;
    items.push({
      id: `task:${item.id}`,
      at: item.at,
      label: eventLabel(item.type),
      message: item.message || item.type,
      meta: item.meta ? compactValue(item.meta) : '',
      tone: 'task',
    });
  }
  for (const run of runs.slice(0, 4)) {
    for (const event of run.events || []) {
      items.push({
        id: `run:${run.id}:${event.id}`,
        at: event.at,
        label: eventLabel(event.type),
        message: event.message,
        meta: run.title,
        tone: 'run',
      });
    }
  }
  for (const comment of task.comments || []) {
    items.push({
      id: `comment:${comment.id}`,
      at: comment.at,
      label: '评论',
      message: comment.body,
      meta: comment.author || comment.channel || '',
      tone: 'comment',
    });
  }
  return items
    .filter(item => item.at && item.message)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 14);
}

function buildAvailableAgents(storeAgents: Agent[], currentAgentId?: string | null, agentName?: string | null): Agent[] {
  const fallbackId = currentAgentId || 'current-agent';
  const fallbackAgent = [{ id: fallbackId, name: agentName || fallbackId, yuan: '', isPrimary: true }];
  if (!storeAgents.length) return fallbackAgent;
  if (currentAgentId && !storeAgents.some(agent => agent.id === currentAgentId)) return [...fallbackAgent, ...storeAgents];
  return storeAgents;
}

function agentDisplayName(agents: Agent[], agentId?: string | null): string {
  if (!agentId) return '未选择';
  const agent = agents.find(item => item.id === agentId);
  return agent?.name || agentId;
}

function channelDisplayName(channels: Array<{ id: string; name?: string }>, channelId?: string | null): string {
  if (!channelId) return '未绑定';
  const channel = channels.find(item => item.id === channelId);
  return channel?.name || channelId;
}

function boardAgentSummary(board: TaskBoard, agents: Agent[]) {
  const coordinatorId = board.coordinatorAgentId || agents[0]?.id || null;
  const childIds = board.selectedAgentIds.filter(id => id && id !== coordinatorId);
  const childNames = childIds.map(id => agentDisplayName(agents, id));
  return {
    coordinatorId,
    coordinatorName: agentDisplayName(agents, coordinatorId),
    childIds,
    childText: childNames.length ? childNames.join('、') : '无',
  };
}

function deriveDepths(run: TaskRun): Map<string, number> {
  const byId = new Map(run.nodes.map(node => [node.id, node]));
  const cache = new Map<string, number>();
  const visit = (node: TaskGraphNode, seen = new Set<string>()): number => {
    if (cache.has(node.id)) return cache.get(node.id)!;
    if (seen.has(node.id)) return 0;
    seen.add(node.id);
    const deps = node.dependsOn || [];
    if (!deps.length) { cache.set(node.id, 0); return 0; }
    const depth = 1 + Math.max(...deps.map(dep => {
      const depNode = byId.get(dep);
      return depNode ? visit(depNode, new Set(seen)) : 0;
    }));
    cache.set(node.id, depth);
    return depth;
  };
  for (const node of run.nodes) visit(node);
  return cache;
}

function buildLanes(run: TaskRun): string[] {
  const lanes: string[] = [];
  for (const node of run.nodes) if (!lanes.includes(node.agentId)) lanes.push(node.agentId);
  return lanes.length ? lanes : ['agent'];
}

function buildGraphLayout(run: TaskRun) {
  const depths = deriveDepths(run);
  const lanes = buildLanes(run);
  const originalIndex = new Map(run.nodes.map((node, index) => [node.id, index]));
  const positions = new Map<string, { x: number; y: number }>();
  const laneLayouts: Array<{ id: string; top: number; height: number }> = [];
  let y = TOP;
  let maxDepth = 0;

  for (const lane of lanes) {
    const laneNodes = run.nodes
      .filter(node => node.agentId === lane)
      .sort((a, b) => {
        const depthDelta = (depths.get(a.id) || 0) - (depths.get(b.id) || 0);
        if (depthDelta !== 0) return depthDelta;
        return (originalIndex.get(a.id) || 0) - (originalIndex.get(b.id) || 0);
      });
    const laneHeight = Math.max(ROW_H, laneNodes.length * ROW_H);
    laneLayouts.push({ id: lane, top: y, height: laneHeight });
    laneNodes.forEach((node, index) => {
      const depth = depths.get(node.id) || 0;
      maxDepth = Math.max(maxDepth, depth);
      positions.set(node.id, { x: LABEL_W + depth * COL_W, y: y + index * ROW_H });
    });
    y += laneHeight + LANE_GAP;
  }
  return { lanes: laneLayouts, positions, width: LABEL_W + (maxDepth + 1) * COL_W + 32, height: Math.max(260, y + 12) };
}

function RunStats({ run }: { run: TaskRun }) {
  const counts = run.nodes.reduce<Record<string, number>>((acc, node) => {
    acc[node.status] = (acc[node.status] || 0) + 1;
    return acc;
  }, {});
  return (
    <div className={styles.stats}>
      <span className={styles.chip}>总计 {run.nodes.length}</span>
      <span className={styles.chip}>运行 {counts.running || 0}</span>
      <span className={styles.chip}>完成 {counts.done || 0}</span>
      <span className={styles.chip}>等待 {counts.pending || 0}</span>
      {(counts.failed || 0) > 0 && <span className={styles.chip}>失败 {counts.failed}</span>}
    </div>
  );
}

function TaskGraph({ run }: { run: TaskRun }) {
  const layout = useMemo(() => buildGraphLayout(run), [run]);
  return (
    <div className={styles.graphCanvas} style={{ width: layout.width, height: layout.height }}>
      {layout.lanes.map((lane) => (
        <div key={lane.id} className={styles.laneLabel} style={{ top: lane.top + Math.max(0, (lane.height - 28) / 2) }}>{lane.id}</div>
      ))}
      <svg className={styles.edgeLayer} width={layout.width} height={layout.height}>
        {run.edges.map((edge) => {
          const from = layout.positions.get(edge.from);
          const to = layout.positions.get(edge.to);
          if (!from || !to) return null;
          const startX = from.x + CARD_W;
          const startY = from.y + CARD_H / 2;
          const endX = to.x;
          const endY = to.y + CARD_H / 2;
          const midX = startX + Math.max(36, (endX - startX) / 2);
          return <path key={`${edge.from}-${edge.to}-${edge.type || 'dep'}`} d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#task-arrow)" />;
        })}
        <defs><marker id="task-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" /></marker></defs>
      </svg>
      {run.nodes.map((node) => {
        const pos = layout.positions.get(node.id);
        if (!pos) return null;
        return (
          <div key={node.id} className={`${styles.nodeCard} ${nodeClass(node.status)}`} style={{ left: pos.x, top: pos.y }}>
            <div className={styles.nodeHeader}>
              <div className={styles.nodeTitle}>{node.title}</div>
              <span className={`${styles.status} ${statusClass(node.status)}`}>{statusLabel(node.status)}</span>
            </div>
            <div className={styles.nodeAgent}>{node.agentId}</div>
            <div className={styles.nodeSummary}>{node.summary || (node.sessionPath ? 'session 已创建，等待输出' : node.task)}</div>
          </div>
        );
      })}
    </div>
  );
}

function TaskCard({ task, latestRun, selected, onOpen, onDragEnd }: {
  task: TaskLedgerTask;
  latestRun?: TaskRun | null;
  selected: boolean;
  onOpen: (task: TaskLedgerTask) => void;
  onDragEnd?: () => void;
}) {
  const runSummary = taskResultSummary(task, latestRun || null);
  const topDiagnostic = task.diagnostics?.[0] || null;
  return (
    <button
      type="button"
      className={`${styles.kanbanCard} ${selected ? styles.kanbanCardSelected : ''}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(TASK_DRAG_MIME, task.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(task)}
    >
      <div className={styles.kanbanCardHeader}>
        <span className={styles.kanbanCardTitle}>{task.title}</span>
        <span className={`${styles.status} ${statusClass(task.status)}`}>{statusLabel(task.status)}</span>
      </div>
      {topDiagnostic && (
        <div className={`${styles.kanbanCardDiagnostic} ${diagnosticSeverityClass(topDiagnostic.severity)}`}>
          <span>{diagnosticLabel(topDiagnostic.severity)}</span>
          <strong>{topDiagnostic.title}</strong>
        </div>
      )}
      {(task.goal || task.body) && <div className={styles.kanbanCardBody}>{task.goal || task.body}</div>}
      <div className={styles.kanbanCardMeta}>
        <span>{sourceLabel(task)}</span>
        {task.assignee?.id && <span>{task.assignee.id}</span>}
        {latestRun ? <span>{statusLabel(latestRun.status)} · {latestRun.nodes[0]?.agentId || latestRun.createdByAgentId || 'agent'}</span> : task.runIds?.length ? <span>{task.runIds.length} run</span> : null}
        {!!task.artifacts?.length && <span>{task.artifacts.length} 产物</span>}
        {!!task.blockers?.length && <span>{task.blockers.length} 阻塞</span>}
        {!!task.comments?.length && <span>{task.comments.length} 评论</span>}
      </div>
      {runSummary && <div className={styles.kanbanCardRunSummary}>{runSummary}</div>}
    </button>
  );
}

function BoardAgentSettings({ board, agents }: { board: TaskBoard; agents: Agent[] }) {
  const updateTaskBoard = useStore(s => s.updateTaskBoard);
  const storeChannels = useStore(s => s.channels);
  const channels = useMemo(() => storeChannels.filter(channel => !channel.isDM), [storeChannels]);
  const knownIds = new Set(agents.map(agent => agent.id));
  const coordinatorId = board.coordinatorAgentId && knownIds.has(board.coordinatorAgentId)
    ? board.coordinatorAgentId
    : agents[0]?.id || null;
  const selectedIds = board.selectedAgentIds.filter(id => knownIds.has(id));
  const effectiveSelectedIds = coordinatorId && !selectedIds.includes(coordinatorId) ? [coordinatorId, ...selectedIds] : selectedIds;
  const effectiveSelectedKey = effectiveSelectedIds.join('|');
  const [bindingError, setBindingError] = useState('');

  useEffect(() => {
    if (!coordinatorId) return;
    if (board.coordinatorAgentId !== coordinatorId || effectiveSelectedIds.length !== board.selectedAgentIds.length) {
      updateTaskBoard(board.id, { coordinatorAgentId: coordinatorId, selectedAgentIds: effectiveSelectedIds });
    }
  }, [board.coordinatorAgentId, board.id, board.selectedAgentIds.length, coordinatorId, effectiveSelectedIds, updateTaskBoard]);

  useEffect(() => {
    if (!board.channelId || !coordinatorId) return;
    let cancelled = false;
    hanaFetch(`/api/channels/${encodeURIComponent(board.channelId)}/task-board`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        boardId: board.id,
        boardTitle: board.title,
        coordinatorAgentId: coordinatorId,
        selectedAgentIds: effectiveSelectedIds,
      }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setBindingError('');
        useStore.setState((state) => ({
          channels: state.channels.map(channel => (
            channel.id === board.channelId ? { ...channel, taskBoard: data.taskBoard || null } : channel
          )),
        }));
      })
      .catch((err) => {
        if (!cancelled) setBindingError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [board.channelId, board.id, board.title, coordinatorId, effectiveSelectedKey]);

  const chooseCoordinator = (agentId: string) => {
    const next = effectiveSelectedIds.includes(agentId) ? effectiveSelectedIds : [agentId, ...effectiveSelectedIds];
    updateTaskBoard(board.id, { coordinatorAgentId: agentId, selectedAgentIds: next });
  };

  const toggleAgent = (agentId: string) => {
    if (agentId === coordinatorId) return;
    const next = effectiveSelectedIds.includes(agentId)
      ? effectiveSelectedIds.filter(id => id !== agentId)
      : [...effectiveSelectedIds, agentId];
    updateTaskBoard(board.id, { selectedAgentIds: next });
  };

  const chooseChannel = async (channelId: string) => {
    const previousChannelId = board.channelId || '';
    updateTaskBoard(board.id, { channelId: channelId || null });
    setBindingError('');
    if (previousChannelId && previousChannelId !== channelId) {
      try {
        const res = await hanaFetch(`/api/channels/${encodeURIComponent(previousChannelId)}/task-board`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
        useStore.setState((state) => ({
          channels: state.channels.map(channel => (
            channel.id === previousChannelId ? { ...channel, taskBoard: null } : channel
          )),
        }));
      } catch (err) {
        setBindingError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  return (
    <section className={styles.summaryPanel}>
      <div className={styles.panelTitleRow}>
        <div>
          <div className={styles.sectionTitle}>项目 Agent</div>
          <div className={styles.sectionHint}>选择主 agent 和配合执行的其他 agent。</div>
        </div>
      </div>
      <label className={styles.coordinatorSelect}>
        <span>主 agent</span>
        <select value={coordinatorId || ''} onChange={event => chooseCoordinator(event.target.value)}>
          {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>)}
        </select>
      </label>
      <label className={styles.coordinatorSelect}>
        <span>绑定频道</span>
        <select value={board.channelId || ''} onChange={event => chooseChannel(event.target.value)}>
          <option value="">不绑定频道</option>
          {channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name || channel.id}</option>)}
        </select>
      </label>
      <div className={styles.sectionHint}>
        频道任务会进入这个看板；write 模式下绑定频道会默认启动主 agent。当前：{channelDisplayName(channels, board.channelId)}
      </div>
      {bindingError && <div className={styles.creatorError}>频道绑定失败：{bindingError}</div>}
      <div className={styles.agentPicker}>
        {agents.map(agent => {
          const selected = effectiveSelectedIds.includes(agent.id);
          const coordinator = agent.id === coordinatorId;
          return (
            <button key={agent.id} type="button" className={`${styles.agentPickButton} ${selected ? styles.agentPickButtonSelected : ''}`} onClick={() => toggleAgent(agent.id)} disabled={coordinator} aria-pressed={selected}>
              <span className={styles.agentPickMark}>{coordinator ? '主控' : selected ? '已选' : '可选'}</span>
              <span className={styles.agentPickName}>{agent.name || agent.id}</span>
              <span className={styles.agentPickMeta}>{agent.id}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function TaskDetailPanel({ task }: {
  task: TaskLedgerTask;
}) {
  const applyTaskLedgerUpdate = useStore(s => s.applyTaskLedgerUpdate);
  const runsById = useStore(s => s.taskRunsById);
  const runs = useMemo(() => (task.runIds || [])
    .map(id => runsById[id])
    .filter((run): run is TaskRun => !!run)
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))), [runsById, task.runIds]);
  const latestRun = runs[0] || null;
  const latestOutcome = latestRunOutcome(latestRun);
  const latestResult = taskResultSummary(task, latestRun);
  const diagnostics = task.diagnostics || [];
  const runningNodes = latestRun?.nodes.filter(node => node.status === 'running') || [];
  const taskBrief = task.body || task.goal || '';
  const contextRefs = Array.isArray(task.contextRefs) ? task.contextRefs : [];
  const artifacts = collectArtifacts(task, runs);
  const blockers = collectBlockers(task, latestRun);
  const activity = buildActivity(task, runs);
  const [title, setTitle] = useState(task.title || '');
  const [body, setBody] = useState(task.body || task.goal || '');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState('');
  const [commenting, setCommenting] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    setTitle(task.title || '');
    setBody(task.body || task.goal || '');
    setEditing(false);
    setComment('');
    setDetailError('');
  }, [task.id, task.title, task.body, task.goal]);

  useEffect(() => {
    let cancelled = false;
    hanaFetch(`/api/tasks/${encodeURIComponent(task.id)}`)
      .then(res => res.json())
      .then(data => {
        if (!cancelled && data.task) applyTaskLedgerUpdate(data.task);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [applyTaskLedgerUpdate, task.id]);

  const saveDetails = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() && !body.trim()) { setDetailError('标题和内容不能同时为空。'); return; }
    setSaving(true);
    setDetailError('');
    try {
      const res = await hanaFetch(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body }) });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.task) applyTaskLedgerUpdate(data.task);
      setEditing(false);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err));
    } finally { setSaving(false); }
  };

  const addComment = async (event: FormEvent) => {
    event.preventDefault();
    const text = comment.trim();
    if (!text) return;
    setCommenting(true);
    setDetailError('');
    try {
      const res = await hanaFetch(`/api/tasks/${encodeURIComponent(task.id)}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text, channel: 'desktop' }) });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.task) applyTaskLedgerUpdate(data.task);
      setComment('');
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err));
    } finally { setCommenting(false); }
  };

  return (
    <aside className={styles.taskDetailPanel}>
      {editing ? (
        <form className={styles.taskDetailEditForm} onSubmit={saveDetails}>
          <label className={styles.creatorField}><span>标题</span><input value={title} onChange={event => setTitle(event.target.value)} /></label>
          <label className={styles.creatorField}><span>内容</span><textarea value={body} onChange={event => setBody(event.target.value)} rows={5} /></label>
          <div className={styles.taskDetailActions}>
            <button type="button" className={styles.secondaryAction} onClick={() => setEditing(false)} disabled={saving}>取消</button>
            <button type="submit" className={styles.primaryAction} disabled={saving}>{saving ? '保存中' : '保存'}</button>
          </div>
        </form>
      ) : (
        <>
          <div className={styles.taskDetailHeader}>
            <div><div className={styles.sectionTitle}>{task.title}</div><div className={styles.sectionHint}>{sourceLabel(task)} · {statusLabel(task.status)}</div></div>
            <button type="button" className={styles.secondaryAction} onClick={() => setEditing(true)}>编辑</button>
          </div>
        </>
      )}
      {detailError && <div className={styles.creatorError}>{detailError}</div>}
      <section className={styles.detailSection}>
        <div className={styles.sectionTitle}>任务内容</div>
        <div className={styles.detailBlock}>
          <div className={styles.detailBlockLabel}>工作说明</div>
          <div className={styles.detailBlockText}>{taskBrief || '没有填写具体工作内容。'}</div>
        </div>
        {task.goal && task.body && task.goal !== task.body && (
          <div className={styles.detailBlock}>
            <div className={styles.detailBlockLabel}>目标</div>
            <div className={styles.detailBlockText}>{task.goal}</div>
          </div>
        )}
        {!!contextRefs.length && (
          <details className={styles.detailDisclosure}>
            <summary>上下文引用 · {contextRefs.length}</summary>
            <pre>{JSON.stringify(contextRefs, null, 2)}</pre>
          </details>
        )}
      </section>
      <div className={styles.taskDetailGrid}>
        <span>来源</span><strong>{sourceLabel(task)}</strong>
        <span>执行</span><strong>{task.runIds?.length || 0} run</strong>
        <span>产物</span><strong>{artifacts.length || 0}</strong>
        <span>阻塞</span><strong>{blockers.length || 0}</strong>
        <span>目录</span><strong title={task.cwd || ''}>{formatPath(task.cwd)}</strong>
        <span>负责人</span><strong>{task.assignee?.id || latestRun?.createdByAgentId || '未分配'}</strong>
        <span>活跃 worker</span><strong>{task.activeWorkerCount || runningNodes.length || 0}</strong>
        <span>心跳</span><strong>{formatTime(task.lastHeartbeatAt) || '无'}</strong>
        <span>创建</span><strong>{formatDateTime(task.createdAt)}</strong>
        <span>评论</span><strong>{task.comments?.length || 0}</strong>
        <span>更新</span><strong>{formatDateTime(task.updatedAt)}</strong>
      </div>
      {!!diagnostics.length && (
        <section className={styles.diagnosticSection}>
          <div className={styles.sectionTitle}>诊断</div>
          <div className={styles.diagnosticList}>
            {diagnostics.map((item: TaskDiagnostic) => (
              <div key={`${item.kind}-${item.title}`} className={`${styles.diagnosticItem} ${diagnosticSeverityClass(item.severity)}`}>
                <div className={styles.diagnosticHeader}>
                  <span>{diagnosticLabel(item.severity)}</span>
                  <strong>{item.title}</strong>
                </div>
                <div className={styles.diagnosticDetail}>{item.detail}</div>
              </div>
            ))}
          </div>
        </section>
      )}
      {(task.currentWorker || runningNodes.length > 0) && (
        <section className={styles.detailSection}>
          <div className={styles.sectionTitle}>当前 worker</div>
          <div className={styles.workerHealthList}>
            {(runningNodes.length ? runningNodes : [{
              id: task.currentWorker?.nodeId || 'worker',
              title: task.currentWorker?.title || 'worker',
              agentId: task.currentWorker?.agentId || '',
              sessionPath: task.currentWorker?.sessionPath || null,
              startedAt: task.currentWorker?.startedAt || null,
              lastHeartbeatAt: task.currentWorker?.lastHeartbeatAt || null,
              claimExpiresAt: task.currentWorker?.claimExpiresAt || null,
              heartbeatCount: 0,
              status: 'running' as const,
              task: '',
              dependsOn: [],
            }]).map(node => {
              const heartbeatAge = node.lastHeartbeatAt ? Date.now() - new Date(node.lastHeartbeatAt).getTime() : null;
              return (
                <div key={node.id} className={styles.workerHealthItem}>
                  <div className={styles.runNodeHeader}>
                    <span>{node.agentId || 'agent'} · {node.title}</span>
                    <span className={`${styles.status} ${statusClass(node.status)}`}>{statusLabel(node.status)}</span>
                  </div>
                  <div className={styles.workerHealthGrid}>
                    <span>session</span><strong title={node.sessionPath || ''}>{formatPath(node.sessionPath)}</strong>
                    <span>开始</span><strong>{formatDateTime(node.startedAt)}</strong>
                    <span>最近心跳</span><strong>{formatTime(node.lastHeartbeatAt) || '无'}{heartbeatAge ? ` · ${formatDuration(heartbeatAge)}前` : ''}</strong>
                    <span>claim 到期</span><strong>{formatTime(node.claimExpiresAt) || '无'}</strong>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <section className={styles.resultSection}>
        <div className={styles.panelTitleRow}>
          <div>
            <div className={styles.sectionTitle}>执行结果</div>
            <div className={styles.sectionHint}>展示 worker handoff，而不是只显示状态。</div>
          </div>
          {latestOutcome && <span className={`${styles.status} ${statusClass(latestOutcome.status)}`}>{statusLabel(latestOutcome.status)}</span>}
        </div>
        {!latestRun ? (
          <div className={styles.kanbanEmpty}>还没有执行结果。</div>
        ) : (
          <div className={styles.resultBody}>
            <div className={styles.detailBlock}>
              <div className={styles.detailBlockLabel}>{latestOutcome?.status === 'blocked' ? '阻塞原因' : latestOutcome?.status === 'failed' ? '失败原因' : latestOutcome?.status === 'running' || latestOutcome?.status === 'pending' ? '当前进度' : '完成摘要'}</div>
              <div className={styles.detailBlockText}>{latestOutcome?.reason || latestResult || latestOutcome?.summary || 'worker 已启动，尚未产生结果。'}</div>
            </div>
            {latestOutcome?.metadata && (
              <div className={styles.detailBlock}>
                <div className={styles.detailBlockLabel}>结构化元数据</div>
                <pre className={styles.resultPre}>{latestOutcome.metadata}</pre>
              </div>
            )}
            {!!artifacts.length && (
              <div className={styles.detailBlock}>
                <div className={styles.detailBlockLabel}>产物</div>
                <div className={styles.artifactList}>
                  {artifacts.slice(0, 8).map(item => (
                    <div key={item.id} className={styles.artifactItem}>
                      <div className={styles.artifactTitle} title={item.label}>{item.label}</div>
                      <div className={styles.artifactMeta}>
                        {item.runId && <span>{item.runId}</span>}
                        {item.nodeId && <span>{item.nodeId}</span>}
                      </div>
                      {item.detail && item.detail !== item.label && <pre>{item.detail}</pre>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!!blockers.length && (
              <div className={styles.detailBlock}>
                <div className={styles.detailBlockLabel}>阻塞记录</div>
                <div className={styles.blockerList}>
                  {blockers.slice(0, 6).map((item, index) => (
                    <div key={`${item.runId || 'task'}-${item.nodeId || index}-${item.reason}`} className={styles.blockerItem}>
                      <div className={styles.blockerReason}>{item.reason}</div>
                      <div className={styles.artifactMeta}>
                        {item.agentId && <span>{item.agentId}</span>}
                        {item.nodeId && <span>{item.nodeId}</span>}
                        {item.at && <span>{formatDateTime(item.at)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {latestOutcome?.output && (
              <details className={styles.detailDisclosure} open={latestOutcome.status !== 'done'}>
                <summary>worker 输出</summary>
                <pre>{latestOutcome.output}</pre>
              </details>
            )}
          </div>
        )}
      </section>
      {latestRun && (
        <section className={styles.executionGraphSection}>
          <div className={styles.panelTitleRow}>
            <div>
              <div className={styles.sectionTitle}>执行过程</div>
              <div className={styles.sectionHint}>展示这次 agent 接管后的节点、依赖和实时状态。</div>
            </div>
            <span className={`${styles.status} ${statusClass(latestRun.status)}`}>{statusLabel(latestRun.status)}</span>
          </div>
          <RunStats run={latestRun} />
          <div className={styles.executionGraphScroll}><TaskGraph run={latestRun} /></div>
        </section>
      )}
      <section className={styles.activitySection}>
        <div className={styles.panelTitleRow}>
          <div>
            <div className={styles.sectionTitle}>活动</div>
            <div className={styles.sectionHint}>状态变化、worker 事件和评论会合并在这里。</div>
          </div>
        </div>
        {!activity.length ? (
          <div className={styles.kanbanEmpty}>暂无活动记录</div>
        ) : (
          <div className={styles.activityList}>
            {activity.map(item => (
              <div key={item.id} className={`${styles.activityItem} ${item.tone === 'comment' ? styles.activityComment : item.tone === 'run' ? styles.activityRun : ''}`}>
                <span className={styles.activityTime}>{formatTime(item.at)}</span>
                <span className={styles.activityLabel}>{item.label}</span>
                <div className={styles.activityContent}>
                  <div className={styles.activityMessage}>{item.message}</div>
                  {item.meta && <div className={styles.activityMeta}>{item.meta}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className={styles.executionSection}>
        <div className={styles.panelTitleRow}>
          <div>
            <div className={styles.sectionTitle}>执行记录</div>
            <div className={styles.sectionHint}>每次 agent 接管都会留下 session、工作指令和交接结果。</div>
          </div>
          {latestRun && <span className={`${styles.status} ${statusClass(latestRun.status)}`}>{statusLabel(latestRun.status)}</span>}
        </div>
        {!runs.length ? (
          <div className={styles.kanbanEmpty}>还没有执行记录。点击“开始执行”会启动主代理 worker。</div>
        ) : runs.slice(0, 4).map(run => (
          <div key={run.id} className={styles.runHistoryItem}>
            <div className={styles.runHistoryHeader}>
              <strong>{run.title}</strong>
              <span>{formatTime(run.updatedAt || run.createdAt)} · {statusLabel(run.status)}</span>
            </div>
            <div className={styles.runNodeList}>
              {run.nodes.map(node => (
                <div key={node.id} className={styles.runNodeItem}>
                  <div className={styles.runNodeHeader}>
                    <span>{node.agentId} · {node.title}</span>
                    <span className={`${styles.status} ${statusClass(node.status)}`}>{statusLabel(node.status)}</span>
                  </div>
                  {node.sessionPath && <div className={styles.runSessionPath} title={node.sessionPath}>session: {formatPath(node.sessionPath)}</div>}
                  <div className={styles.runNodeSummary}>{node.summary || (node.status === 'running' ? 'agent 正在执行，等待输出...' : '暂无 handoff 摘要')}</div>
                  {(node.resultReason || node.resultError || node.resultMetadata) && (
                    <div className={styles.runNodeResultMeta}>
                      {node.resultReason && <div><strong>reason</strong><span>{node.resultReason}</span></div>}
                      {node.resultError && <div><strong>error</strong><span>{node.resultError}</span></div>}
                      {node.resultMetadata && <div><strong>metadata</strong><span>{node.resultMetadata}</span></div>}
                    </div>
                  )}
                  {node.output && (
                    <details className={styles.detailDisclosure}>
                      <summary>worker 输出</summary>
                      <pre>{node.output}</pre>
                    </details>
                  )}
                  {node.task && (
                    <details className={styles.detailDisclosure}>
                      <summary>工作指令</summary>
                      <pre>{node.task}</pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
            {!!run.events?.length && (
              <div className={styles.runEventList}>
                {run.events.slice(0, 6).map(event => (
                  <div key={event.id} className={styles.event}>
                    <span className={styles.eventTime}>{formatTime(event.at)}</span>
                    <span className={styles.eventText}>{event.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>
      <section className={styles.commentSection}>
        <div className={styles.sectionTitle}>评论</div>
        <div className={styles.commentList}>
          {(task.comments || []).slice(-6).map(item => <div key={item.id} className={styles.commentItem}><div className={styles.commentMeta}>{item.author || 'user'} · {formatTime(item.at)}</div><div className={styles.commentBody}>{item.body}</div></div>)}
          {!task.comments?.length && <div className={styles.kanbanEmpty}>暂无评论</div>}
        </div>
        <form className={styles.commentForm} onSubmit={addComment}>
          <textarea value={comment} onChange={event => setComment(event.target.value)} placeholder="添加评论..." rows={3} />
          <button type="submit" className={styles.primaryAction} disabled={commenting || !comment.trim()}>{commenting ? '添加中' : '添加评论'}</button>
        </form>
      </section>
    </aside>
  );
}

function BoardDrawer({ title, subtitle, onClose, children }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className={styles.drawerBackdrop} onMouseDown={onClose}>
      <aside className={styles.drawerPanel} onMouseDown={event => event.stopPropagation()}>
        <div className={styles.drawerHeader}>
          <div>
            <div className={styles.drawerTitle}>{title}</div>
            {subtitle && <div className={styles.drawerSubtitle}>{subtitle}</div>}
          </div>
          <button type="button" className={styles.drawerCloseButton} onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className={styles.drawerBody}>{children}</div>
      </aside>
    </div>
  );
}

function LocalTaskCreator({ board, agents, initialStatus }: { board: TaskBoard; agents: Agent[]; initialStatus: TaskLedgerStatus }) {
  const deskBasePath = useStore(s => s.deskBasePath);
  const setTaskCreatorOpen = useStore(s => s.setTaskCreatorOpen);
  const applyTaskLedgerUpdate = useStore(s => s.applyTaskLedgerUpdate);
  const applyTaskGraphUpdate = useStore(s => s.applyTaskGraphUpdate);
  const setActiveTaskLedgerId = useStore(s => s.setActiveTaskLedgerId);
  const agentSummary = useMemo(() => boardAgentSummary(board, agents), [agents, board]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<TaskLedgerStatus>(initialStatus);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() && !body.trim()) { setError('请填写标题或任务内容。'); return; }
    setSubmitting(true); setError('');
    try {
      const assignee = agentSummary.coordinatorId ? { type: 'agent', id: agentSummary.coordinatorId } : null;
      const res = await hanaFetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          body,
          status,
          cwd: deskBasePath || null,
          assignee,
          autoStart: true,
          coordinatorAgentId: agentSummary.coordinatorId,
          selectedAgentIds: [agentSummary.coordinatorId, ...agentSummary.childIds].filter(Boolean),
          contextRefs: [{ type: 'task_board', boardId: board.id, boardTitle: board.title, coordinatorAgentId: agentSummary.coordinatorId, selectedAgentIds: [agentSummary.coordinatorId, ...agentSummary.childIds].filter(Boolean) }],
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.task) { applyTaskLedgerUpdate(data.task); setActiveTaskLedgerId(data.task.id); }
      if (data.run) applyTaskGraphUpdate(data.run);
      setTaskCreatorOpen(false);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSubmitting(false); }
  };

  return (
    <div className={styles.creatorWrap}>
      <div className={styles.creatorPanel}>
        <div className={styles.creatorHeader}>
          <div><div className={styles.eyebrow}>Local Task</div><div className={styles.mainTitle}>新建任务</div></div>
          <button type="button" className={styles.secondaryAction} onClick={() => setTaskCreatorOpen(false)}>取消</button>
        </div>
        <div className={styles.creatorMeta}><span>所属看板：{board.title}</span><span>主代理：{agentSummary.coordinatorName}</span><span>子代理：{agentSummary.childText}</span></div>
        <form onSubmit={submit}>
          <label className={styles.creatorField}><span>标题</span><input value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：实现任务创建入口" autoFocus /></label>
          <label className={styles.creatorField}><span>内容</span><textarea value={body} onChange={event => setBody(event.target.value)} placeholder="任务目标、背景或验收标准" rows={5} /></label>
          <label className={styles.coordinatorSelect}>
            <span>初始状态</span>
            <select value={status} onChange={event => setStatus(event.target.value as TaskLedgerStatus)}>
              {KANBAN_COLUMNS.map(column => <option key={column.id} value={column.id}>{column.title}</option>)}
            </select>
          </label>
          {error && <div className={styles.creatorError}>{error}</div>}
          <div className={styles.creatorActions}><button type="submit" className={styles.primaryAction} disabled={submitting}>{submitting ? '创建中...' : '创建任务'}</button></div>
        </form>
      </div>
    </div>
  );
}

function BoardCreator() {
  const addTaskBoard = useStore(s => s.addTaskBoard);
  const setTaskBoardCreatorOpen = useStore(s => s.setTaskBoardCreatorOpen);
  const currentAgentId = useStore(s => s.currentAgentId);
  const agentName = useStore(s => s.agentName);
  const storeAgents = useStore(s => s.agents);
  const agents = useMemo(() => buildAvailableAgents(storeAgents, currentAgentId, agentName), [agentName, currentAgentId, storeAgents]);
  const [title, setTitle] = useState('');
  const [coordinatorAgentId, setCoordinatorAgentId] = useState(currentAgentId || agents[0]?.id || '');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const at = new Date().toISOString();
    const id = `task-board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    addTaskBoard({ id, title: title.trim() || '未命名项目', coordinatorAgentId: coordinatorAgentId || null, selectedAgentIds: coordinatorAgentId ? [coordinatorAgentId] : [], createdAt: at, updatedAt: at });
    setTaskBoardCreatorOpen(false);
  };

  return (
    <div className={styles.creatorWrap}>
      <div className={styles.creatorPanel}>
        <div className={styles.creatorHeader}>
          <div><div className={styles.eyebrow}>Project Board</div><div className={styles.mainTitle}>新建项目看板</div></div>
          <button type="button" className={styles.secondaryAction} onClick={() => setTaskBoardCreatorOpen(false)}>取消</button>
        </div>
        <form onSubmit={submit}>
          <label className={styles.creatorField}><span>项目名称</span><input value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：任务模块重构" autoFocus /></label>
          <label className={styles.coordinatorSelect}><span>主 agent</span><select value={coordinatorAgentId} onChange={event => setCoordinatorAgentId(event.target.value)}>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>)}</select></label>
          <div className={styles.creatorActions}><button type="submit" className={styles.primaryAction}>创建看板</button></div>
        </form>
      </div>
    </div>
  );
}

function LocalTaskBoard({ board, tasks, agents, onCreateTask }: {
  board: TaskBoard;
  tasks: TaskLedgerTask[];
  agents: Agent[];
  onCreateTask: (status: TaskLedgerStatus) => void;
}) {
  const applyTaskLedgerUpdate = useStore(s => s.applyTaskLedgerUpdate);
  const applyTaskGraphUpdate = useStore(s => s.applyTaskGraphUpdate);
  const storeChannels = useStore(s => s.channels);
  const channels = useMemo(() => storeChannels.filter(channel => !channel.isDM), [storeChannels]);
  const agentSummary = useMemo(() => boardAgentSummary(board, agents), [board, agents]);
  const channelName = channelDisplayName(channels, board.channelId);
  const visibleTasks = tasks.filter(task => task.status !== 'archived' && task.status !== 'cancelled');
  const columns = KANBAN_COLUMNS.map(column => ({ ...column, tasks: visibleTasks.filter(task => taskMatchesColumn(task, column.id)) }));
  const activeTaskId = useStore(s => s.activeTaskLedgerId);
  const setActiveTaskLedgerId = useStore(s => s.setActiveTaskLedgerId);
  const runsById = useStore(s => s.taskRunsById);
  const activeTask = activeTaskId ? visibleTasks.find(task => task.id === activeTaskId) || null : null;
  const [updatingStatus, setUpdatingStatus] = useState<TaskLedgerStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [drawer, setDrawer] = useState<'agents' | 'task' | null>(null);
  const [columnDropTarget, setColumnDropTarget] = useState<TaskLedgerStatus | null>(null);
  const [archiveDropActive, setArchiveDropActive] = useState(false);

  const updateTaskStatus = async (task: TaskLedgerTask, nextStatus: TaskLedgerStatus) => {
    if (updatingStatus || task.status === nextStatus) return;
    if (nextStatus === 'running') {
      await startTaskExecution(task);
      return;
    }
    setUpdatingStatus(nextStatus); setStatusError('');
    try {
      const res = await hanaFetch(`/api/tasks/${encodeURIComponent(task.id)}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.task) applyTaskLedgerUpdate(data.task);
    } catch (err) { setStatusError(err instanceof Error ? err.message : String(err)); }
    finally { setUpdatingStatus(null); }
  };

  const startTaskExecution = async (task: TaskLedgerTask) => {
    if (updatingStatus || task.status === 'running') return;
    setUpdatingStatus('running'); setStatusError('');
    try {
      const res = await hanaFetch(`/api/tasks/${encodeURIComponent(task.id)}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coordinatorAgentId: agentSummary.coordinatorId,
          selectedAgentIds: [agentSummary.coordinatorId, ...agentSummary.childIds].filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.task) applyTaskLedgerUpdate(data.task);
      if (data.run) applyTaskGraphUpdate(data.run);
    } catch (err) { setStatusError(err instanceof Error ? err.message : String(err)); }
    finally { setUpdatingStatus(null); }
  };

  const openTask = (task: TaskLedgerTask) => {
    setActiveTaskLedgerId(task.id);
    setDrawer('task');
  };

  const isTaskDragEvent = (event: DragEvent) => hasTaskDrag(event.dataTransfer);

  const getDraggedTask = (event: DragEvent) => {
    const taskId = event.dataTransfer.getData(TASK_DRAG_MIME);
    return visibleTasks.find(item => item.id === taskId) || null;
  };

  const clearDropState = () => {
    setColumnDropTarget(null);
    setArchiveDropActive(false);
  };

  const handleColumnDrag = (event: DragEvent, status: TaskLedgerStatus) => {
    if (!isTaskDragEvent(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (columnDropTarget !== status) setColumnDropTarget(status);
  };

  const leaveColumn = (event: DragEvent, status: TaskLedgerStatus) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    if (columnDropTarget === status) setColumnDropTarget(null);
  };

  const dropTaskOnColumn = async (event: DragEvent, status: TaskLedgerStatus) => {
    if (!isTaskDragEvent(event)) return;
    event.preventDefault();
    setColumnDropTarget(null);
    const task = getDraggedTask(event);
    if (!task) return;
    await updateTaskStatus(task, status);
  };

  const archiveDroppedTask = async (event: DragEvent) => {
    if (!isTaskDragEvent(event)) return;
    event.preventDefault();
    clearDropState();
    const task = getDraggedTask(event);
    if (!task) return;
    await updateTaskStatus(task, 'archived');
    if (activeTaskId === task.id) setDrawer(null);
  };

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.eyebrow}>Project Kanban</div>
          <div className={styles.mainTitle}>{board.title}</div>
          <div className={styles.goal}>本地项目看板 · 频道：{channelName} · 主代理：{agentSummary.coordinatorName} · 子代理：{agentSummary.childText}</div>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.secondaryAction} onClick={() => setDrawer('agents')}>项目 Agent</button>
          <button type="button" className={styles.primaryAction} onClick={() => onCreateTask('triage')}>新建任务</button>
        </div>
      </header>
      {statusError && <div className={styles.creatorError}>{statusError}</div>}
      <div className={styles.kanbanBody}>
        <div className={styles.kanbanColumns}>
          {columns.map(column => (
            <section
              key={column.id}
              className={`${styles.kanbanColumn} ${columnToneClass(column.id)} ${columnDropTarget === column.id ? styles.kanbanColumnDropTarget : ''}`}
              onDragEnter={(event) => handleColumnDrag(event, column.id)}
              onDragOver={(event) => handleColumnDrag(event, column.id)}
              onDragLeave={(event) => leaveColumn(event, column.id)}
              onDrop={(event) => dropTaskOnColumn(event, column.id)}
            >
              <div className={styles.kanbanColumnHeader}>
                <div className={styles.kanbanColumnTitleRow}>
                  <span className={styles.kanbanColumnCheck} aria-hidden="true" />
                  <span className={styles.kanbanColumnDot} aria-hidden="true" />
                  <span className={styles.kanbanColumnTitle}>{column.title}</span>
                  <strong>{column.tasks.length}</strong>
                </div>
                <button type="button" className={styles.kanbanColumnAddButton} onClick={() => onCreateTask(column.id)} aria-label={`在${column.title}中新建任务`}>+</button>
              </div>
              <div className={styles.kanbanColumnDescription}>{column.description}</div>
              <div className={styles.kanbanColumnCards}>
                {column.tasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    latestRun={latestRunForTask(task, runsById)}
                    selected={task.id === activeTaskId}
                    onOpen={openTask}
                    onDragEnd={clearDropState}
                  />
                ))}
                {!column.tasks.length && <div className={styles.kanbanEmpty}>- 无任务 -</div>}
              </div>
            </section>
          ))}
          <div
            className={`${styles.archiveDropZone} ${archiveDropActive ? styles.archiveDropZoneActive : ''}`}
            onDragEnter={(event) => {
              if (!isTaskDragEvent(event)) return;
              event.preventDefault();
              setArchiveDropActive(true);
            }}
            onDragOver={(event) => {
              if (!isTaskDragEvent(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDragLeave={() => setArchiveDropActive(false)}
            onDrop={archiveDroppedTask}
          >
            <div className={styles.archiveDropIcon}>⌫</div>
            <div>拖放到此处归档</div>
          </div>
        </div>
      </div>
      {drawer === 'agents' && (
        <BoardDrawer title="项目 Agent" subtitle="选择主 agent 和协作 agent" onClose={() => setDrawer(null)}>
          <BoardAgentSettings board={board} agents={agents} />
        </BoardDrawer>
      )}
      {drawer === 'task' && activeTask && (
        <BoardDrawer title="任务详情" subtitle={`${sourceLabel(activeTask)} · ${statusLabel(activeTask.status)}`} onClose={() => setDrawer(null)}>
          <TaskDetailPanel task={activeTask} />
        </BoardDrawer>
      )}
    </>
  );
}

function EmptyProjectBoard({ board, agents }: { board: TaskBoard; agents: Agent[] }) {
  const setTaskCreatorOpen = useStore(s => s.setTaskCreatorOpen);
  const storeChannels = useStore(s => s.channels);
  const channels = useMemo(() => storeChannels.filter(channel => !channel.isDM), [storeChannels]);
  const agentSummary = useMemo(() => boardAgentSummary(board, agents), [board, agents]);
  const channelName = channelDisplayName(channels, board.channelId);
  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.eyebrow}>Project Kanban</div>
          <div className={styles.mainTitle}>{board.title}</div>
          <div className={styles.goal}>空项目看板 · 频道：{channelName} · 主代理：{agentSummary.coordinatorName} · 子代理：{agentSummary.childText}</div>
        </div>
        <button type="button" className={styles.primaryAction} onClick={() => setTaskCreatorOpen(true)}>新建任务</button>
      </header>
      <div className={styles.body}>
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>这个项目还没有任务</div>
          <div>左侧可以切换不同项目看板；当前看板会保存自己的主 agent 和协作 agent 选择。</div>
          <button type="button" className={styles.primaryAction} onClick={() => setTaskCreatorOpen(true)}>新建任务</button>
        </div>
        <BoardAgentSettings board={board} agents={agents} />
      </div>
    </>
  );
}

export function TaskSidebar() {
  const boardsById = useStore(s => s.taskBoardsById);
  const boardOrder = useStore(s => s.taskBoardOrder);
  const activeBoardId = useStore(s => s.activeTaskBoardId);
  const setActiveTaskBoardId = useStore(s => s.setActiveTaskBoardId);
  const setTaskBoardCreatorOpen = useStore(s => s.setTaskBoardCreatorOpen);
  const tasksById = useStore(s => s.taskLedgerTasksById);
  const storeChannels = useStore(s => s.channels);
  const channels = useMemo(() => storeChannels.filter(channel => !channel.isDM), [storeChannels]);
  const currentAgentId = useStore(s => s.currentAgentId);
  const agentName = useStore(s => s.agentName);
  const storeAgents = useStore(s => s.agents);
  const agents = useMemo(() => buildAvailableAgents(storeAgents, currentAgentId, agentName), [agentName, currentAgentId, storeAgents]);
  const tasks = Object.values(tasksById);

  return (
    <>
      <div className={`sidebar-header ${styles.boardSidebarHeader}`}>
        <span className="sidebar-title">看板</span>
        <button
          type="button"
          className={styles.boardSidebarAddButton}
          onClick={() => setTaskBoardCreatorOpen(true)}
          aria-label="新建看板"
          title="新建看板"
        >
          +
        </button>
      </div>
      <div className={styles.sidebarRunList}>
        {boardOrder.map(boardId => {
          const board = boardsById[boardId];
          if (!board) return null;
          const count = tasks.filter(task => getTaskBoardId(task) === board.id && task.status !== 'archived' && task.status !== 'cancelled').length;
          const agentSummary = boardAgentSummary(board, agents);
          return (
            <button key={board.id} className={`${styles.sidebarRunItem} ${board.id === activeBoardId ? styles.sidebarRunItemActive : ''}`} onClick={() => setActiveTaskBoardId(board.id)}>
              <span className={styles.sidebarRunTitle}>{board.title}</span>
              <span className={styles.sidebarRunMeta}><span>{count} 任务</span><span>{channelDisplayName(channels, board.channelId)}</span><span>{agentSummary.coordinatorName}</span></span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export function TaskPage() {
  const boardsById = useStore(s => s.taskBoardsById);
  const activeBoardId = useStore(s => s.activeTaskBoardId);
  const activeBoard = boardsById[activeBoardId] || boardsById[DEFAULT_BOARD_ID];
  const tasksById = useStore(s => s.taskLedgerTasksById);
  const tasks = Object.values(tasksById).filter(task => getTaskBoardId(task) === activeBoard.id);
  const creatorOpen = useStore(s => s.taskCreatorOpen);
  const boardCreatorOpen = useStore(s => s.taskBoardCreatorOpen);
  const setTaskRuns = useStore(s => s.setTaskRuns);
  const setTaskLedgerTasks = useStore(s => s.setTaskLedgerTasks);
  const setTaskRunsLoading = useStore(s => s.setTaskRunsLoading);
  const setTaskRunsError = useStore(s => s.setTaskRunsError);
  const loading = useStore(s => s.taskRunsLoading);
  const error = useStore(s => s.taskRunsError);
  const connected = useStore(s => s.connected);
  const currentAgentId = useStore(s => s.currentAgentId);
  const agentName = useStore(s => s.agentName);
  const storeAgents = useStore(s => s.agents);
  const agents = useMemo(() => buildAvailableAgents(storeAgents, currentAgentId, agentName), [agentName, currentAgentId, storeAgents]);
  const [taskCreatorInitialStatus, setTaskCreatorInitialStatus] = useState<TaskLedgerStatus>('triage');

  const openTaskCreator = (status: TaskLedgerStatus) => {
    setTaskCreatorInitialStatus(status);
    useStore.getState().setTaskCreatorOpen(true);
  };

  useEffect(() => {
    if (!connected) { setTaskRunsLoading(false); return; }
    const now = Date.now();
    const hasCachedData = Object.keys(useStore.getState().taskLedgerTasksById).length > 0;
    if (lastTaskRefreshAt > 0 && now - lastTaskRefreshAt < TASK_REFRESH_TTL_MS) {
      setTaskRunsLoading(false);
      return;
    }
    let cancelled = false;
    setTaskRunsLoading(!hasCachedData);
    logAsyncPerf('tasks.refresh', () => Promise.all([
      hanaFetch('/api/tasks').then(res => res.json()),
      hanaFetch('/api/tasks/runs').then(res => res.json()),
    ]), () => ({ cached: hasCachedData }))
      .then(([taskData, runData]) => {
        if (cancelled) return;
        if (taskData.error) throw new Error(taskData.error);
        if (runData.error) throw new Error(runData.error);
        lastTaskRefreshAt = Date.now();
        setTaskLedgerTasks(Array.isArray(taskData.tasks) ? taskData.tasks : []);
        setTaskRuns(Array.isArray(runData.runs) ? runData.runs : []);
        setTaskRunsLoading(false);
      })
      .catch(err => {
        if (!cancelled) {
          setTaskRunsError(err.message || String(err));
          setTaskRunsLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [connected, setTaskLedgerTasks, setTaskRuns, setTaskRunsError, setTaskRunsLoading]);

  return (
    <div className={styles.taskPage}>
      {creatorOpen ? <LocalTaskCreator board={activeBoard} agents={agents} initialStatus={taskCreatorInitialStatus} /> : boardCreatorOpen ? <BoardCreator /> : <LocalTaskBoard board={activeBoard} tasks={tasks} agents={agents} onCreateTask={openTaskCreator} />}
      {error && <div className={styles.pageNotice}>加载失败：{error}</div>}
      {loading && <div className={styles.pageNotice}>正在加载任务...</div>}
    </div>
  );
}
