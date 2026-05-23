export type TaskNodeStatus = 'pending' | 'running' | 'blocked' | 'done' | 'failed' | 'aborted';
export type TaskRunStatus = 'running' | 'blocked' | 'done' | 'failed' | 'aborted';
export type TaskLedgerStatus = 'triage' | 'todo' | 'scheduled' | 'ready' | 'running' | 'blocked' | 'review' | 'done' | 'failed' | 'cancelled' | 'archived';

export interface TaskLedgerComment {
  id: string;
  author: string;
  body: string;
  channel?: string | null;
  meta?: Record<string, unknown>;
  at: string;
}

export interface TaskLedgerEvent {
  id: string;
  type: string;
  message: string;
  at: string;
  meta?: Record<string, unknown>;
}

export interface TaskLedgerArtifact {
  runId?: string | null;
  nodeId?: string | null;
  artifact?: unknown;
  type?: string | null;
  registryTaskId?: string | null;
}

export interface TaskLedgerBlocker {
  runId?: string | null;
  nodeId?: string | null;
  agentId?: string | null;
  reason: string;
  at?: string | null;
}

export interface TaskDiagnostic {
  kind: string;
  severity: 'warning' | 'error' | 'critical' | string;
  title: string;
  detail: string;
  data?: Record<string, unknown>;
}

export interface TaskLedgerTask {
  id: string;
  idempotencyKey?: string | null;
  title: string;
  body?: string;
  goal?: string;
  status: TaskLedgerStatus;
  source?: { type?: string; [key: string]: unknown };
  assignee?: { type?: string; id?: string; [key: string]: unknown } | null;
  priority?: number;
  rootSessionPath?: string | null;
  cwd?: string | null;
  contextRefs?: unknown[];
  runIds?: string[];
  comments?: TaskLedgerComment[];
  events?: TaskLedgerEvent[];
  artifacts?: TaskLedgerArtifact[];
  blockers?: TaskLedgerBlocker[];
  result?: string;
  latestSummary?: string;
  latestRunId?: string | null;
  latestRunStatus?: string | null;
  currentRunId?: string | null;
  activeWorkerCount?: number;
  currentWorker?: {
    runId?: string | null;
    nodeId?: string | null;
    agentId?: string | null;
    title?: string | null;
    sessionPath?: string | null;
    startedAt?: string | null;
    claimExpiresAt?: string | null;
    lastHeartbeatAt?: string | null;
  } | null;
  lastHeartbeatAt?: string | null;
  consecutiveFailures?: number;
  lastFailureError?: string | null;
  diagnostics?: TaskDiagnostic[];
  warningSeverity?: string | null;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
}

export interface TaskBoard {
  id: string;
  title: string;
  coordinatorAgentId?: string | null;
  selectedAgentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskGraphNode {
  id: string;
  title: string;
  task: string;
  agentId: string;
  model?: string | null;
  cwd?: string | null;
  dependsOn: string[];
  status: TaskNodeStatus;
  sessionPath?: string | null;
  summary?: string;
  output?: string;
  resultStatus?: 'done' | 'blocked' | 'failed' | null;
  resultReason?: string;
  resultError?: string;
  resultMetadata?: string;
  completedByTool?: boolean;
  claimLock?: string | null;
  claimExpiresAt?: string | null;
  lastHeartbeatAt?: string | null;
  heartbeatCount?: number;
  artifacts?: unknown[];
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TaskGraphEdge {
  from: string;
  to: string;
  type?: string;
}

export interface TaskGraphEvent {
  id: string;
  type: string;
  message: string;
  nodeId?: string | null;
  at: string;
}

export interface TaskRun {
  id: string;
  taskId?: string | null;
  title: string;
  goal?: string;
  status: TaskRunStatus;
  summary?: string;
  rootSessionPath?: string | null;
  cwd?: string | null;
  createdByAgentId?: string | null;
  createdAt: string;
  updatedAt: string;
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
  events: TaskGraphEvent[];
}

export interface TaskGraphSlice {
  taskRunsById: Record<string, TaskRun>;
  taskRunOrder: string[];
  activeTaskRunId: string | null;
  taskLedgerTasksById: Record<string, TaskLedgerTask>;
  taskLedgerOrder: string[];
  activeTaskLedgerId: string | null;
  taskBoardsById: Record<string, TaskBoard>;
  taskBoardOrder: string[];
  activeTaskBoardId: string;
  taskCreatorOpen: boolean;
  taskBoardCreatorOpen: boolean;
  taskRunsLoading: boolean;
  taskRunsError: string | null;
  setTaskRuns: (runs: TaskRun[]) => void;
  setTaskLedgerTasks: (tasks: TaskLedgerTask[]) => void;
  applyTaskLedgerUpdate: (task: TaskLedgerTask) => void;
  applyTaskGraphUpdate: (run: TaskRun) => void;
  setActiveTaskRunId: (runId: string | null) => void;
  setActiveTaskLedgerId: (taskId: string | null) => void;
  setActiveTaskBoardId: (boardId: string) => void;
  addTaskBoard: (board: TaskBoard) => void;
  updateTaskBoard: (boardId: string, patch: Partial<Omit<TaskBoard, 'id' | 'createdAt'>>) => void;
  setTaskCreatorOpen: (open: boolean) => void;
  setTaskBoardCreatorOpen: (open: boolean) => void;
  setTaskRunsLoading: (loading: boolean) => void;
  setTaskRunsError: (error: string | null) => void;
}

const DEFAULT_BOARD_ID = 'default-board';
const now = () => new Date().toISOString();

function createDefaultBoard(): TaskBoard {
  const at = now();
  return {
    id: DEFAULT_BOARD_ID,
    title: '默认项目',
    coordinatorAgentId: null,
    selectedAgentIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

function sortRunIds(runsById: Record<string, TaskRun>): string[] {
  return Object.values(runsById)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map(run => run.id);
}

function sortTaskLedgerIds(tasksById: Record<string, TaskLedgerTask>): string[] {
  return Object.values(tasksById)
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
    .map(task => task.id);
}

function sortTaskBoardIds(boardsById: Record<string, TaskBoard>): string[] {
  return Object.values(boardsById)
    .sort((a, b) => {
      if (a.id === DEFAULT_BOARD_ID) return -1;
      if (b.id === DEFAULT_BOARD_ID) return 1;
      return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
    })
    .map(board => board.id);
}

export const createTaskGraphSlice = (
  set: (partial: Partial<TaskGraphSlice> | ((s: TaskGraphSlice) => Partial<TaskGraphSlice>)) => void
): TaskGraphSlice => {
  const defaultBoard = createDefaultBoard();
  return {
    taskRunsById: {},
    taskRunOrder: [],
    activeTaskRunId: null,
    taskLedgerTasksById: {},
    taskLedgerOrder: [],
    activeTaskLedgerId: null,
    taskBoardsById: { [DEFAULT_BOARD_ID]: defaultBoard },
    taskBoardOrder: [DEFAULT_BOARD_ID],
    activeTaskBoardId: DEFAULT_BOARD_ID,
    taskCreatorOpen: false,
    taskBoardCreatorOpen: false,
    taskRunsLoading: false,
    taskRunsError: null,
    setTaskRuns: (runs) => set((s) => {
      const taskRunsById: Record<string, TaskRun> = {};
      for (const run of runs) taskRunsById[run.id] = run;
      const taskRunOrder = sortRunIds(taskRunsById);
      const activeTaskRunId = s.activeTaskRunId && taskRunsById[s.activeTaskRunId]
        ? s.activeTaskRunId
        : null;
      return { taskRunsById, taskRunOrder, activeTaskRunId, taskRunsLoading: false, taskRunsError: null };
    }),
    setTaskLedgerTasks: (tasks) => set((s) => {
      const taskLedgerTasksById: Record<string, TaskLedgerTask> = {};
      for (const task of tasks) taskLedgerTasksById[task.id] = task;
      const taskLedgerOrder = sortTaskLedgerIds(taskLedgerTasksById);
      const activeTaskLedgerId = s.activeTaskLedgerId && taskLedgerTasksById[s.activeTaskLedgerId]
        ? s.activeTaskLedgerId
        : null;
      return { taskLedgerTasksById, taskLedgerOrder, activeTaskLedgerId, taskRunsLoading: false, taskRunsError: null };
    }),
    applyTaskLedgerUpdate: (task) => set((s) => {
      const taskLedgerTasksById = { ...s.taskLedgerTasksById, [task.id]: task };
      return {
        taskLedgerTasksById,
        taskLedgerOrder: sortTaskLedgerIds(taskLedgerTasksById),
        activeTaskLedgerId: s.activeTaskLedgerId || task.id,
        activeTaskRunId: null,
        taskRunsError: null,
      };
    }),
    applyTaskGraphUpdate: (run) => set((s) => {
      const taskRunsById = { ...s.taskRunsById, [run.id]: run };
      return {
        taskRunsById,
        taskRunOrder: sortRunIds(taskRunsById),
        activeTaskRunId: run.id,
        taskRunsError: null,
      };
    }),
    setActiveTaskRunId: (runId) => set({ activeTaskRunId: runId, activeTaskLedgerId: null }),
    setActiveTaskLedgerId: (taskId) => set({ activeTaskLedgerId: taskId, activeTaskRunId: null }),
    setActiveTaskBoardId: (boardId) => set({ activeTaskBoardId: boardId, activeTaskLedgerId: null, activeTaskRunId: null }),
    addTaskBoard: (board) => set((s) => {
      const taskBoardsById = { ...s.taskBoardsById, [board.id]: board };
      return {
        taskBoardsById,
        taskBoardOrder: sortTaskBoardIds(taskBoardsById),
        activeTaskBoardId: board.id,
        activeTaskLedgerId: null,
        activeTaskRunId: null,
      };
    }),
    updateTaskBoard: (boardId, patch) => set((s) => {
      const existing = s.taskBoardsById[boardId];
      if (!existing) return {};
      const taskBoardsById = {
        ...s.taskBoardsById,
        [boardId]: { ...existing, ...patch, updatedAt: now() },
      };
      return { taskBoardsById, taskBoardOrder: sortTaskBoardIds(taskBoardsById) };
    }),
    setTaskCreatorOpen: (open) => set({ taskCreatorOpen: open }),
    setTaskBoardCreatorOpen: (open) => set({ taskBoardCreatorOpen: open }),
    setTaskRunsLoading: (loading) => set({ taskRunsLoading: loading }),
    setTaskRunsError: (error) => set({ taskRunsError: error, taskRunsLoading: false }),
  };
};
