import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockState = Record<string, unknown>;

const mockState: MockState = {};

const mockHanaFetch = vi.fn();
const mockApplyAgentIdentity = vi.fn(async () => {});
const mockLoadAgents = vi.fn(async () => {});
const mockLoadSessions = vi.fn(async () => {});
const mockSwitchSession = vi.fn(async () => {});
const mockLoadModels = vi.fn(async () => {});
const mockActivateWorkspaceDesk = vi.fn(async () => {});
const mockLoadChannels = vi.fn(async () => {});
const mockApplyEditorTypography = vi.fn();
const mockInvalidateAgentConfigCache = vi.fn();

vi.mock('../../stores', () => ({
  useStore: {
    getState: () => mockState,
    setState: (patch: MockState | ((s: MockState) => MockState)) => {
      const next = typeof patch === 'function' ? patch(mockState) : patch;
      Object.assign(mockState, next);
    },
  },
}));

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: mockHanaFetch,
}));

vi.mock('../../stores/agent-actions', () => ({
  applyAgentIdentity: mockApplyAgentIdentity,
  loadAgents: mockLoadAgents,
}));

vi.mock('../../stores/session-actions', () => ({
  loadSessions: mockLoadSessions,
  switchSession: mockSwitchSession,
}));

vi.mock('../../utils/ui-helpers', () => ({
  loadModels: mockLoadModels,
}));

vi.mock('../../stores/desk-actions', () => ({
  activateWorkspaceDesk: mockActivateWorkspaceDesk,
}));

vi.mock('../../stores/channel-actions', () => ({
  loadChannels: mockLoadChannels,
}));

vi.mock('../../editor/typography', () => ({
  applyEditorTypography: mockApplyEditorTypography,
}));

vi.mock('../../utils/agent-config-cache', () => ({
  invalidateAgentConfigCache: mockInvalidateAgentConfigCache,
}));

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('handleAppEvent', () => {
  beforeEach(() => {
    Object.keys(mockState).forEach(k => delete mockState[k]);
    mockHanaFetch.mockReset();
    mockApplyAgentIdentity.mockReset();
    mockLoadAgents.mockReset();
    mockLoadSessions.mockReset();
    mockSwitchSession.mockReset();
    mockLoadModels.mockReset();
    mockActivateWorkspaceDesk.mockReset();
    mockLoadChannels.mockReset();
    mockApplyEditorTypography.mockReset();
    mockInvalidateAgentConfigCache.mockReset();
    vi.resetModules();

    (globalThis as Record<string, unknown>).window = {
      setTheme: vi.fn(),
      setSerifFont: vi.fn(),
      setPaperTexture: vi.fn(),
      platform: { settingsChanged: vi.fn() },
      dispatchEvent: vi.fn(),
    };
    (globalThis as Record<string, unknown>).i18n = {
      locale: 'zh-CN',
      defaultName: 'Agentry',
      load: vi.fn(async (locale: string) => {
        (globalThis as any).i18n.locale = locale;
      }),
    };
    (globalThis as Record<string, unknown>).WebSocket = { OPEN: 1 };
  });

  it('agent-switched applies agent identity, reloads dependent data, and resets agent-scoped UI state', async () => {
    mockHanaFetch
      .mockResolvedValueOnce(jsonResponse({ jobs: [{ id: 'job-1' }] }));
    Object.assign(mockState, {
      currentChannel: { id: 'old' },
      channelMessages: [{ id: 'm1' }],
      thinkingLevel: 'high',
      activities: [{ id: 'a1' }],
    });

    const { handleAppEvent } = await import('../../services/app-event-actions');
    handleAppEvent('agent-switched', {
      agentName: 'Agentry',
      agentId: 'agent-a',
      sessionPath: '/sessions/agent-a.jsonl',
      cwd: '/agent-cwd',
      homeFolder: '/agent-home',
      workspaceFolders: ['/reference'],
      cwdHistory: ['/agent-cwd', '/recent'],
      memoryMasterEnabled: false,
    });
    await flushPromises();

    expect(mockApplyAgentIdentity).toHaveBeenCalledWith({
      agentName: 'Agentry',
      agentId: 'agent-a',
    });
    expect(mockLoadSessions).toHaveBeenCalledTimes(1);
    expect(mockSwitchSession).toHaveBeenCalledWith('/sessions/agent-a.jsonl');
    expect(mockLoadChannels).toHaveBeenCalledTimes(1);
    expect(mockLoadModels).toHaveBeenCalledTimes(1);
    expect(mockState.currentChannel).toBeNull();
    expect(mockState.channelMessages).toEqual([]);
    expect(mockState.channelMembers).toEqual([]);
    expect(mockState.channelTotalUnread).toBe(0);
    expect(mockState.channelHeaderName).toBe('');
    expect(mockState.channelHeaderMembersText).toBe('');
    expect(mockState.channelInfoName).toBe('');
    expect(mockState.channelIsDM).toBe(false);
    expect(mockState.thinkingLevel).toBe('auto');
    expect(mockState.activities).toEqual([]);
    expect(mockState.homeFolder).toBe('/agent-home');
    expect(mockState.workspaceFolders).toEqual(['/reference']);
    expect(mockState.cwdHistory).toEqual(['/agent-cwd', '/recent']);
    expect(mockState.memoryMasterEnabled).toBe(false);
  });

  it('models-changed reloads models', async () => {
    const { handleAppEvent } = await import('../../services/app-event-actions');

    handleAppEvent('models-changed', { agentId: 'agent-a' });

    expect(mockInvalidateAgentConfigCache).toHaveBeenCalledWith('agent-a');
    expect(mockLoadModels).toHaveBeenCalledTimes(1);
  });

  it('agent-config-changed invalidates the welcome agent config cache and refreshes agents', async () => {
    const { handleAppEvent } = await import('../../services/app-event-actions');

    handleAppEvent('agent-config-changed', { agentId: 'agent-a' });

    expect(mockInvalidateAgentConfigCache).toHaveBeenCalledWith('agent-a');
    expect(mockLoadAgents).toHaveBeenCalledTimes(1);
  });

  it('agent-config-changed refreshes desk cache state for current agent workspace changes', async () => {
    Object.assign(mockState, {
      currentAgentId: 'agent-a',
      homeFolder: '/old-home',
      selectedFolder: '/old-home',
      workspaceFolders: ['/old-home/project'],
      cwdHistory: ['/old-home'],
      deskBasePath: '/old-home',
      pendingNewSession: true,
      currentSessionPath: null,
    });

    const { handleAppEvent } = await import('../../services/app-event-actions');
    handleAppEvent('agent-config-changed', {
      agentId: 'agent-a',
      desk: { home_folder: '/new-home' },
      cwd_history: ['/new-home', '/recent'],
    });

    expect(mockState.homeFolder).toBe('/new-home');
    expect(mockState.selectedFolder).toBe('/new-home');
    expect(mockState.workspaceFolders).toEqual([]);
    expect(mockState.cwdHistory).toEqual(['/old-home']);
    expect(mockActivateWorkspaceDesk).toHaveBeenCalledWith('/new-home');
  });

  it('agent-config-changed ignores workspace refresh for non-current agent config changes', async () => {
    Object.assign(mockState, {
      currentAgentId: 'agent-a',
      homeFolder: '/current-home',
      selectedFolder: '/current-home',
      deskBasePath: '/current-home',
      pendingNewSession: true,
      currentSessionPath: null,
    });

    const { handleAppEvent } = await import('../../services/app-event-actions');

    handleAppEvent('agent-config-changed', {
      agentId: 'agent-b',
      desk: { home_folder: '/other-home' },
    });

    expect(mockState.homeFolder).toBe('/current-home');
    expect(mockState.selectedFolder).toBe('/current-home');
    expect(mockActivateWorkspaceDesk).not.toHaveBeenCalled();
  });

  it('models-changed requests context usage through the injected callback', async () => {
    Object.assign(mockState, { currentSessionPath: '/session/a.jsonl' });
    const requestContextUsage = vi.fn();
    const { configureAppEventActions, handleAppEvent } = await import('../../services/app-event-actions');

    configureAppEventActions({ requestContextUsage });
    handleAppEvent('models-changed');

    expect(mockLoadModels).toHaveBeenCalledTimes(1);
    expect(requestContextUsage).toHaveBeenCalledWith('/session/a.jsonl');
  });

  it('agent-updated for a non-current agent refreshes the agent list without applying identity', async () => {
    Object.assign(mockState, { currentAgentId: 'agent-a', agentName: 'Agentry' });
    const { handleAppEvent } = await import('../../services/app-event-actions');

    handleAppEvent('agent-updated', {
      agentId: 'agent-b',
      agentName: 'Other Agent',
      yuan: 'other-yuan',
    });

    expect(mockApplyAgentIdentity).not.toHaveBeenCalled();
    expect(mockLoadAgents).toHaveBeenCalledTimes(1);
  });

  it('agent-updated for the current agent keeps refreshing identity and avatar state', async () => {
    Object.assign(mockState, { currentAgentId: 'agent-a', agentName: 'Agentry' });
    const { handleAppEvent } = await import('../../services/app-event-actions');

    handleAppEvent('agent-updated', {
      agentId: 'agent-a',
      agentName: 'Agentry Prime',
      yuan: 'muse',
    });

    expect(mockApplyAgentIdentity).toHaveBeenCalledWith({
      agentName: 'Agentry Prime',
      agentId: 'agent-a',
      yuan: 'muse',
      ui: { settings: false },
    });
    expect(mockLoadAgents).not.toHaveBeenCalled();
  });

  it('memory-master-changed updates the current agent gate and cached agent row', async () => {
    Object.assign(mockState, {
      currentAgentId: 'agent-a',
      memoryMasterEnabled: true,
      agents: [
        { id: 'agent-a', name: 'Agentry', memoryMasterEnabled: true },
        { id: 'agent-b', name: 'Other', memoryMasterEnabled: true },
      ],
    });
    const { handleAppEvent } = await import('../../services/app-event-actions');

    handleAppEvent('memory-master-changed', { agentId: 'agent-a', enabled: false });

    expect(mockState.memoryMasterEnabled).toBe(false);
    expect((mockState.agents as any[]).find(a => a.id === 'agent-a')?.memoryMasterEnabled).toBe(false);
    expect((mockState.agents as any[]).find(a => a.id === 'agent-b')?.memoryMasterEnabled).toBe(true);
  });

  it('agent-switched reads the next agent memory gate from config', async () => {
    mockHanaFetch
      .mockResolvedValueOnce(jsonResponse({ jobs: [] }));
    Object.assign(mockState, { currentAgentId: 'agent-a', memoryMasterEnabled: true });
    const { handleAppEvent } = await import('../../services/app-event-actions');

    handleAppEvent('agent-switched', {
      agentName: 'Other',
      agentId: 'agent-b',
      sessionPath: '/sessions/agent-b.jsonl',
      cwd: '/agent-home',
      homeFolder: '/agent-home',
      cwdHistory: ['/recent'],
      memoryMasterEnabled: false,
    });
    await vi.waitFor(() => {
      expect(mockState.memoryMasterEnabled).toBe(false);
    });

    expect(mockHanaFetch).not.toHaveBeenCalledWith('/api/config');
  });

  it('theme-changed applies the selected theme', async () => {
    const { handleAppEvent } = await import('../../services/app-event-actions');

    handleAppEvent('theme-changed', { theme: 'moon' });

    expect((globalThis as any).window.setTheme).toHaveBeenCalledWith('moon');
  });

  it('editor-typography-changed applies editor typography settings', async () => {
    const { handleAppEvent } = await import('../../services/app-event-actions');

    handleAppEvent('editor-typography-changed', {
      editor: { markdown: { bodyFontSize: 17 } },
    });

    expect(mockApplyEditorTypography).toHaveBeenCalledWith({
      markdown: { bodyFontSize: 17 },
    });
  });

  it('computer-use permission events refresh local settings UI without re-emitting through platform settings', async () => {
    const { handleAppEvent } = await import('../../services/app-event-actions');

    handleAppEvent('computer-use-permissions-requested', { providerId: 'macos:cua' });

    expect((globalThis as any).window.dispatchEvent).toHaveBeenCalledTimes(1);
    const event = (globalThis as any).window.dispatchEvent.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('hana-settings');
    expect(event.detail).toEqual({
      type: 'computer-use-permissions-requested',
      data: { providerId: 'macos:cua' },
    });
    expect((globalThis as any).window.platform.settingsChanged).not.toHaveBeenCalled();
  });

  it('agent-workspace-changed updates only the current agent workspace and activates the desk', async () => {
    Object.assign(mockState, {
      currentAgentId: 'agent-a',
      homeFolder: '/old-home',
      selectedFolder: '/old-home',
      workspaceFolders: ['/old-home/project'],
      cwdHistory: ['/old-home'],
      deskBasePath: '/old-home',
      pendingNewSession: true,
      currentSessionPath: null,
    });

    const { handleAppEvent } = await import('../../services/app-event-actions');
    handleAppEvent('agent-workspace-changed', {
      agentId: 'agent-a',
      homeFolder: '/new-home',
      cwdHistory: ['/new-home', '/recent'],
    });

    expect(mockState.homeFolder).toBe('/new-home');
    expect(mockState.selectedFolder).toBe('/new-home');
    expect(mockState.workspaceFolders).toEqual([]);
    expect(mockState.cwdHistory).toEqual(['/old-home']);
    expect(mockActivateWorkspaceDesk).toHaveBeenCalledWith('/new-home');

    mockActivateWorkspaceDesk.mockClear();
    handleAppEvent('agent-workspace-changed', {
      agentId: 'agent-b',
      homeFolder: '/other-home',
      cwdHistory: ['/other-home'],
    });

    expect(mockState.homeFolder).toBe('/new-home');
    expect(mockState.selectedFolder).toBe('/new-home');
    expect(mockState.cwdHistory).toEqual(['/old-home']);
    expect(mockActivateWorkspaceDesk).not.toHaveBeenCalled();
  });
});
