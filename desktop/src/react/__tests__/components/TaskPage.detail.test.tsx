// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TaskPage } from '../../components/tasks/TaskPage';
import { useStore } from '../../stores';
import type { TaskLedgerTask, TaskRun } from '../../stores/task-graph-slice';

const hanaFetchMock = vi.fn();

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: (...args: unknown[]) => hanaFetchMock(...args),
}));

const createdAt = '2026-05-22T08:00:00.000Z';

const task: TaskLedgerTask = {
  id: 'task-1',
  title: '测试任务',
  body: '读取 package 信息并输出摘要',
  status: 'blocked',
  source: { type: 'manual' },
  assignee: { type: 'agent', id: 'coder' },
  cwd: '/tmp/workspace/agentry',
  contextRefs: [{ type: 'task_board', boardId: 'default-board' }],
  runIds: ['run-1'],
  comments: [{
    id: 'comment-1',
    author: 'coder',
    body: '中间结论：需要保留结构化 handoff。',
    channel: 'task_worker',
    at: '2026-05-22T08:02:00.000Z',
  }],
  events: [{
    id: 'event-1',
    type: 'task.status',
    message: '任务状态：running → blocked',
    at: '2026-05-22T08:03:00.000Z',
  }],
  artifacts: [{ runId: 'run-1', nodeId: 'main', artifact: '/tmp/package-summary.md' }],
  blockers: [{ runId: 'run-1', nodeId: 'main', agentId: 'coder', reason: '缺少 API token，无法继续验证。', at: '2026-05-22T08:03:00.000Z' }],
  result: '缺少 API token，无法继续验证。',
  latestSummary: '缺少 API token，无法继续验证。',
  latestRunId: 'run-1',
  latestRunStatus: 'blocked',
  activeWorkerCount: 0,
  createdAt,
  updatedAt: '2026-05-22T08:03:00.000Z',
};

const run: TaskRun = {
  id: 'run-1',
  taskId: 'task-1',
  title: '测试任务',
  status: 'blocked',
  createdByAgentId: 'coder',
  createdAt,
  updatedAt: '2026-05-22T08:03:00.000Z',
  nodes: [{
    id: 'main',
    title: '执行：测试任务',
    task: '读取 package 信息并输出摘要',
    agentId: 'coder',
    dependsOn: [],
    status: 'blocked',
    summary: '缺少 API token，无法继续验证。',
    resultReason: '缺少 API token，无法继续验证。',
    resultMetadata: '{"missing":"API_TOKEN"}',
    output: '等待用户补充 token',
    artifacts: ['/tmp/package-summary.md'],
    createdAt,
    updatedAt: '2026-05-22T08:03:00.000Z',
  }],
  edges: [],
  events: [{
    id: 'run-event-1',
    type: 'heartbeat',
    message: '已读取任务输入，正在跑验证。',
    nodeId: 'main',
    at: '2026-05-22T08:01:00.000Z',
  }],
};

describe('TaskPage task detail', () => {
  beforeEach(() => {
    hanaFetchMock.mockResolvedValue({ json: async () => ({ task }) });
    const board = {
      id: 'default-board',
      title: '默认项目',
      coordinatorAgentId: 'coder',
      selectedAgentIds: ['coder'],
      createdAt,
      updatedAt: createdAt,
    };
    useStore.setState({
      connected: false,
      currentAgentId: 'coder',
      agentName: 'Coder',
      agents: [{ id: 'coder', name: 'Coder', yuan: '', isPrimary: true }],
      taskRunsById: { [run.id]: run },
      taskRunOrder: [run.id],
      activeTaskRunId: null,
      taskLedgerTasksById: { [task.id]: task },
      taskLedgerOrder: [task.id],
      activeTaskLedgerId: null,
      taskBoardsById: { [board.id]: board },
      taskBoardOrder: [board.id],
      activeTaskBoardId: board.id,
      taskCreatorOpen: false,
      taskBoardCreatorOpen: false,
      taskRunsLoading: false,
      taskRunsError: null,
    } as never);
  });

  afterEach(() => {
    cleanup();
    hanaFetchMock.mockReset();
  });

  it('shows artifacts, blockers, and activity in the drawer', async () => {
    render(<TaskPage />);

    expect(screen.queryByRole('button', { name: '任务流程' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /测试任务/ }));

    await waitFor(() => expect(screen.getByText('执行结果')).toBeInTheDocument());
    expect(screen.getByText('执行过程')).toBeInTheDocument();
    expect(screen.getByText('执行记录')).toBeInTheDocument();
    expect(screen.getByText('/tmp/package-summary.md')).toBeInTheDocument();
    expect(screen.getAllByText('缺少 API token，无法继续验证。').length).toBeGreaterThan(0);
    expect(screen.getByText('活动')).toBeInTheDocument();
    expect(screen.getAllByText('已读取任务输入，正在跑验证。').length).toBeGreaterThan(0);
    expect(screen.getAllByText('中间结论：需要保留结构化 handoff。').length).toBeGreaterThan(0);
  });
});
