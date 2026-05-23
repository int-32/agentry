/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../settings/store';
import { MemorySection } from '../../settings/tabs/agent/AgentMemory';

const hanaFetchMock = vi.fn();
const showToastMock = vi.fn();

vi.mock('../../settings/api', () => ({
  hanaFetch: (...args: unknown[]) => hanaFetchMock(...args),
  hanaUrl: (path: string) => path,
}));

const translations: Record<string, string> = {
  'settings.memory.sectionTitle': '记忆',
  'settings.pins.title': '置顶记忆',
  'settings.pins.hint': '你主动告诉助手一定要记住的东西，也可以手动编辑与添加',
  'settings.pins.empty': '还没有置顶记忆',
  'settings.pins.delete': '删除',
  'settings.pins.selectItem': '选择置顶记忆：{text}',
  'settings.pins.selectAll': '全选',
  'settings.pins.clearSelection': '取消选择',
  'settings.pins.deleteSelected': '删除所选（{count}）',
  'settings.pins.addPlaceholder': '添加一条置顶记忆...',
  'settings.memory.compiled': '当下记忆',
  'settings.memory.compiledHint': '助手记住的关于你的，重要的与近期的事',
  'settings.memory.compiledView': '查看当下记忆',
  'settings.memory.allMemories': '所有记忆',
  'settings.memory.actions.view': '查看记忆',
  'settings.memory.actions.clear': '清除记忆',
  'settings.memory.actions.more': '更多',
  'settings.memory.actions.export': '导出记忆',
  'settings.memory.actions.import': '导入记忆',
  'settings.memory.activeOnly': '请先将此助手设为主助手',
  'settings.autoSaved': '已自动保存',
  'settings.saveFailed': '保存失败',
};

function translate(key: string, params?: Record<string, unknown>) {
  let text = translations[key] || key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(`{${name}}`, String(value));
    }
  }
  return text;
}

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

function MemoryHarness() {
  const currentPins = useSettingsStore(s => s.currentPins);
  const settingsAgentId = useSettingsStore(s => s.settingsAgentId);
  return (
    <div data-agent={settingsAgentId || 'agent-a'}>
      <MemorySection
        hasUtilityModel
        memoryEnabled
        isViewingOther={false}
        currentPins={currentPins}
      />
    </div>
  );
}

async function flushPinSave() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 350));
  });
}

describe('Agent pinned memories', () => {
  beforeEach(() => {
    vi.stubGlobal('t', translate);
    window.t = translate as typeof window.t;
    hanaFetchMock.mockReset();
    hanaFetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    showToastMock.mockReset();
    useSettingsStore.setState({
      currentAgentId: 'agent-a',
      settingsAgentId: null,
      currentPins: ['alpha', 'beta', 'gamma'],
      showToast: showToastMock,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (window as unknown as { t?: unknown }).t;
  });

  it('deletes one pinned memory and saves the exact next list for the original agent', async () => {
    render(<MemoryHarness />);

    fireEvent.click(screen.getAllByTitle('删除')[0]);
    act(() => {
      useSettingsStore.setState({ settingsAgentId: 'agent-b', currentPins: ['other-agent-pin'] });
    });
    await flushPinSave();

    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalledTimes(1));
    expect(hanaFetchMock).toHaveBeenCalledWith('/api/agents/agent-a/pinned', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ pins: ['beta', 'gamma'] }),
    }));
  });

  it('removes checked pinned memories in one batch save', async () => {
    render(<MemoryHarness />);

    fireEvent.click(screen.getByLabelText('选择置顶记忆：alpha'));
    fireEvent.click(screen.getByLabelText('选择置顶记忆：gamma'));
    fireEvent.click(screen.getByRole('button', { name: '删除所选（2）' }));

    expect(useSettingsStore.getState().currentPins).toEqual(['beta']);
    await flushPinSave();

    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalledTimes(1));
    expect(hanaFetchMock).toHaveBeenCalledWith('/api/agents/agent-a/pinned', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ pins: ['beta'] }),
    }));
  });
});
