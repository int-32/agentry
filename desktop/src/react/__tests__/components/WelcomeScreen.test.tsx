/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../stores';

const { hanaFetchMock } = vi.hoisted(() => ({
  hanaFetchMock: vi.fn(),
}));

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: (...args: unknown[]) => hanaFetchMock(...args),
}));

const translations: Record<string, string | string[] | Record<string, { avatar: string }>> = {
  'input.workspace': '工作空间：',
  'input.currentWorkspace': '本次工作空间',
  'input.selectOtherFolder': '选择其他文件夹',
  'input.extraFolders': '额外文件夹',
  'input.addExternalFolder': '添加工作空间以外的文件夹',
  'welcome.messages': ['想到什么就说什么吧~'],
  'yuan.welcome.hanako': ['想到什么就说什么吧~'],
  'welcome.memoryOn': '记忆',
  'welcome.memoryOff': '此次聊天不参考记忆',
  'welcome.memoryDisabled': '记忆已关闭',
  'yuan.types': { hanako: { avatar: 'Hanako.png' } },
};

describe('WelcomeScreen workspace picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hanaFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/agents/') && url.endsWith('/config')) {
        return { json: async () => ({ desk: {}, models: {} }) };
      }
      if (url === '/api/desk') {
        return { json: async () => ({ files: [] }) };
      }
      return { json: async () => ({ ok: true, models: [] }) };
    });
    const t = vi.fn((key: string) => translations[key] ?? key);
    vi.stubGlobal('t', t);
    window.t = t as typeof window.t;
    window.platform = { selectFolder: vi.fn() } as unknown as typeof window.platform;
    useStore.setState({
      welcomeVisible: true,
      agents: [],
      agentName: 'Agentry',
      agentAvatarUrl: null,
      agentYuan: 'hanako',
      currentAgentId: null,
      selectedAgentId: null,
      memoryEnabled: true,
      selectedFolder: '/workspace/Desktop',
      homeFolder: '/workspace/Desktop/project-hana',
      cwdHistory: ['/workspace/Desktop/project-hana'],
      workspaceFolders: ['/workspace/Reference'],
      models: [],
      toasts: [],
      locale: 'zh',
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('groups primary workspace selection before extra folders', async () => {
    const { WelcomeScreen } = await import('../../components/WelcomeScreen');

    render(<WelcomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /工作空间：Desktop/ }));

    const currentLabel = screen.getByText('本次工作空间');
    const selectOther = screen.getByText('选择其他文件夹');
    const extraLabel = screen.getByText('额外文件夹');
    const addExternal = screen.getByText('添加工作空间以外的文件夹');

    expect(currentLabel.compareDocumentPosition(selectOther) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(selectOther.compareDocumentPosition(extraLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(extraLabel.compareDocumentPosition(addExternal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('disables the memory toggle when the selected agent has memory disabled in settings', async () => {
    useStore.setState({
      agents: [
        { id: 'hana', name: 'Agentry', yuan: 'hanako', isPrimary: true, memoryMasterEnabled: false },
      ],
      currentAgentId: 'hana',
      memoryEnabled: true,
    } as never);
    const { WelcomeScreen } = await import('../../components/WelcomeScreen');

    render(<WelcomeScreen />);
    const button = screen.getByRole('button', { name: '记忆已关闭' });
    fireEvent.click(button);

    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(useStore.getState().memoryEnabled).toBe(true);
  });

  it('loads the selected agent default workspace into the welcome page and right workspace', async () => {
    hanaFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/agents/artist/config') {
        return {
          json: async () => ({
            desk: { home_folder: '/workspace/ArtistHome' },
            models: { chat: { id: 'artist-chat', provider: 'deepseek' } },
          }),
        };
      }
      if (url === '/api/desk') {
        return { json: async () => ({ files: [] }) };
      }
      return { json: async () => ({ ok: true, models: [] }) };
    });
    useStore.setState({
      agents: [
        { id: 'hana', name: 'Agentry', yuan: 'hanako', isPrimary: true, memoryMasterEnabled: true },
        { id: 'artist', name: 'Artist', yuan: 'ming', isPrimary: false, memoryMasterEnabled: true },
      ],
      currentAgentId: 'hana',
      selectedAgentId: null,
      selectedFolder: '/workspace/agentry',
      homeFolder: '/workspace/agentry',
      deskBasePath: '/workspace/agentry',
      workspaceFolders: ['/workspace/Reference'],
    } as never);
    const { WelcomeScreen } = await import('../../components/WelcomeScreen');

    render(<WelcomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Artist/ }));
    await waitFor(() => {
      expect(useStore.getState().selectedFolder).toBe('/workspace/ArtistHome');
    });

    expect(useStore.getState().homeFolder).toBe('/workspace/ArtistHome');
    expect(useStore.getState().deskBasePath).toBe('/workspace/ArtistHome');
    expect(useStore.getState().workspaceFolders).toEqual([]);
    expect(hanaFetchMock).toHaveBeenCalledWith('/api/agents/artist/config');
    expect(hanaFetchMock).toHaveBeenCalledWith('/api/models/set', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ modelId: 'artist-chat', provider: 'deepseek' }),
    }));
  });

  it('shows a warning and reverts local state when the selected agent model is rejected by the server', async () => {
    hanaFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/agents/artist/config') {
        return {
          json: async () => ({
            desk: { home_folder: '/workspace/ArtistHome' },
            models: { chat: { id: 'missing-chat', provider: 'deepseek' } },
          }),
        };
      }
      if (url === '/api/desk') {
        return { json: async () => ({ files: [] }) };
      }
      if (url === '/api/models/set') {
        throw new Error('hanaFetch /api/models/set: 404 Not Found');
      }
      return { json: async () => ({ ok: true, models: [] }) };
    });
    useStore.setState({
      agents: [
        { id: 'hana', name: 'Agentry', yuan: 'hanako', isPrimary: true, memoryMasterEnabled: true },
        { id: 'artist', name: 'Artist', yuan: 'ming', isPrimary: false, memoryMasterEnabled: true },
      ],
      models: [{ id: 'available-chat', name: 'Available Chat', provider: 'deepseek' }],
      currentModel: { id: 'available-chat', provider: 'deepseek' },
      currentAgentId: 'hana',
      selectedAgentId: null,
      selectedFolder: '/workspace/agentry',
      homeFolder: '/workspace/agentry',
      deskBasePath: '/workspace/agentry',
      workspaceFolders: ['/workspace/Reference'],
    } as never);
    const { WelcomeScreen } = await import('../../components/WelcomeScreen');

    render(<WelcomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Artist/ }));
    await waitFor(() => {
      expect(useStore.getState().selectedFolder).toBe('/workspace/ArtistHome');
    });

    expect(hanaFetchMock).toHaveBeenCalledWith('/api/agents/artist/config');
    expect(hanaFetchMock).toHaveBeenCalledWith('/api/models/set', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ modelId: 'missing-chat', provider: 'deepseek' }),
    }));
    expect(useStore.getState().currentModel).toEqual({ id: 'available-chat', provider: 'deepseek' });
    expect(useStore.getState().toasts.some(t => t.dedupeKey === 'agent-model-unavailable:artist:deepseek/missing-chat')).toBe(true);
  });

  it('does not reload the full model list when switching from a CLI model to an agent provider model', async () => {
    const urls: string[] = [];
    hanaFetchMock.mockImplementation(async (url: string) => {
      urls.push(url);
      if (url === '/api/agents/artist/config') {
        return {
          json: async () => ({
            desk: { home_folder: '/workspace/ArtistHome' },
            models: { chat: { id: 'artist-chat', provider: 'deepseek' } },
          }),
        };
      }
      if (url === '/api/models') {
        throw new Error('unexpected full model reload');
      }
      if (url === '/api/desk') {
        return { json: async () => ({ files: [] }) };
      }
      return { json: async () => ({ ok: true }) };
    });
    useStore.setState({
      agents: [
        { id: 'hana', name: 'Agentry', yuan: 'hanako', isPrimary: true, memoryMasterEnabled: true },
        { id: 'artist', name: 'Artist', yuan: 'ming', isPrimary: false, memoryMasterEnabled: true },
      ],
      models: [{ id: 'agy-gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'cli-antigravity', isCurrent: true }],
      currentModel: { id: 'agy-gemini-3.5-flash', provider: 'cli-antigravity' },
      currentAgentId: 'hana',
      selectedAgentId: null,
      selectedFolder: '/workspace/agentry',
      homeFolder: '/workspace/agentry',
      deskBasePath: '/workspace/agentry',
      workspaceFolders: ['/workspace/Reference'],
    } as never);
    const { WelcomeScreen } = await import('../../components/WelcomeScreen');

    render(<WelcomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Artist/ }));
    await waitFor(() => {
      expect(hanaFetchMock).toHaveBeenCalledWith('/api/models/set', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ modelId: 'artist-chat', provider: 'deepseek' }),
      }));
    });

    expect(urls).not.toContain('/api/models');
    expect(useStore.getState().currentModel).toEqual({ id: 'artist-chat', provider: 'deepseek' });
  });

  it('clears the inherited workspace when the selected agent has no configured home folder', async () => {
    hanaFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/agents/master/config') {
        return {
          json: async () => ({
            desk: { home_folder: '' },
            models: { chat: { id: 'master-chat', provider: 'openai' } },
          }),
        };
      }
      return { json: async () => ({ ok: true, models: [] }) };
    });
    useStore.setState({
      agents: [
        { id: 'hana', name: 'Agentry', yuan: 'hanako', isPrimary: true, memoryMasterEnabled: true },
        { id: 'master', name: 'Master', yuan: 'kong', isPrimary: false, memoryMasterEnabled: true },
      ],
      currentAgentId: 'hana',
      selectedAgentId: null,
      selectedFolder: '/workspace/agentry',
      homeFolder: '/workspace/agentry',
      deskBasePath: '/workspace/agentry',
      workspaceFolders: ['/workspace/Reference'],
    } as never);
    const { WelcomeScreen } = await import('../../components/WelcomeScreen');

    render(<WelcomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Master/ }));
    await waitFor(() => {
      expect(useStore.getState().selectedFolder).toBeNull();
    });

    expect(useStore.getState().homeFolder).toBeNull();
    expect(useStore.getState().deskBasePath).toBe('');
    expect(useStore.getState().workspaceFolders).toEqual([]);
  });
});
