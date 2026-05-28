/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const hanaFetchMock = vi.fn();

vi.mock('../../api', () => ({
  hanaFetch: (...args: unknown[]) => hanaFetchMock(...args),
}));

vi.mock('../../helpers', () => ({
  t: (key: string) => {
    if (key === 'settings.computerUse.experimentalWarning') {
      return 'Computer use 功能属于测试阶段，而且对模型性能要求较高，请在知晓所有风险后开启，目前已验证某些软件下不按预期工作，建议只是尝鲜。';
    }
    return key;
  },
}));

vi.mock('../../widgets/Toggle', () => ({
  Toggle: ({ on }: { on: boolean }) => (
    <button type="button" data-testid={`computer-toggle-${on ? 'on' : 'off'}`}>
      toggle
    </button>
  ),
}));

import { ComputerUseTab } from '../ComputerUseTab';
import { useSettingsStore } from '../../store';

afterEach(() => {
  cleanup();
  hanaFetchMock.mockReset();
  useSettingsStore.setState({ toastMessage: '', toastType: '', toastVisible: false });
});

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

describe('ComputerUseTab', () => {
  it('renders the experimental risk warning near the top of the Computer Use page', async () => {
    hanaFetchMock.mockResolvedValue(jsonResponse({
      selectedProviderId: 'macos:cua',
      settings: { enabled: false, provider_by_platform: { darwin: 'macos:cua' }, app_approvals: [] },
      status: {
        platform: 'darwin',
        providers: [{ providerId: 'macos:cua', status: { available: true, permissions: [] } }],
        activeLease: null,
      },
    }));

    render(<ComputerUseTab />);

    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalledWith('/api/preferences/computer-use'));
    const warning = screen.getByTestId('computer-use-experimental-warning');

    expect(warning.textContent || '').toContain('Computer use 功能属于测试阶段');
    expect(warning.textContent || '').toContain('建议只是尝鲜');
  });

  it('shows a toast when requesting permissions fails', async () => {
    hanaFetchMock
      .mockResolvedValueOnce(jsonResponse({
        selectedProviderId: 'macos:cua',
        settings: { enabled: false, provider_by_platform: { darwin: 'macos:cua' }, app_approvals: [] },
        status: {
          platform: 'darwin',
          providers: [{ providerId: 'macos:cua', status: { available: false, reason: 'binary-not-found', permissions: [] } }],
          activeLease: null,
        },
      }))
      .mockRejectedValueOnce(new Error('hanaFetch /api/preferences/computer-use/request-permissions: 400 Bad Request'));

    render(<ComputerUseTab />);

    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalledWith('/api/preferences/computer-use'));
    fireEvent.click(screen.getByText('settings.computerUse.checkPermissions'));

    await waitFor(() => {
      expect(useSettingsStore.getState().toastType).toBe('error');
      expect(useSettingsStore.getState().toastMessage).toContain('400 Bad Request');
    });
  });

  it('shows granted permissions as already authorized and changes the action to recheck', async () => {
    hanaFetchMock.mockResolvedValue(jsonResponse({
      selectedProviderId: 'macos:cua',
      settings: { enabled: true, provider_by_platform: { darwin: 'macos:cua' }, app_approvals: [] },
      status: {
        platform: 'darwin',
        providers: [{
          providerId: 'macos:cua',
          status: {
            available: true,
            permissions: [
              { name: 'Accessibility', granted: true },
              { name: 'Screen Recording', granted: true },
            ],
          },
        }],
        activeLease: null,
      },
    }));

    render(<ComputerUseTab />);

    await waitFor(() => expect(screen.getByText('settings.computerUse.recheckPermissions')).toBeTruthy());
    expect(screen.getByText(/settings\.computerUse\.permissionsGranted: Accessibility · Screen Recording/)).toBeTruthy();
  });

  it('shows missing permissions and keeps the button focused on authorization', async () => {
    hanaFetchMock.mockResolvedValue(jsonResponse({
      selectedProviderId: 'macos:cua',
      settings: { enabled: true, provider_by_platform: { darwin: 'macos:cua' }, app_approvals: [] },
      status: {
        platform: 'darwin',
        providers: [{
          providerId: 'macos:cua',
          status: {
            available: true,
            permissions: [
              { name: 'Accessibility', granted: true },
              { name: 'Screen Recording', granted: false },
            ],
          },
        }],
        activeLease: null,
      },
    }));

    render(<ComputerUseTab />);

    await waitFor(() => expect(screen.getByText('settings.computerUse.openPermissions')).toBeTruthy());
    expect(screen.getByText(/settings\.computerUse\.permissionsMissing: Screen Recording/)).toBeTruthy();
  });

  it('changes the provider for the current platform', async () => {
    hanaFetchMock
      .mockResolvedValueOnce(jsonResponse({
        selectedProviderId: 'macos:cua',
        settings: { enabled: true, provider_by_platform: { darwin: 'macos:cua', win32: 'windows:uia' }, app_approvals: [] },
        status: {
          platform: 'darwin',
          providers: [
            { providerId: 'macos:cua', status: { available: true, permissions: [] } },
            { providerId: 'mock', status: { available: true, permissions: [] } },
          ],
          activeLease: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        settings: { enabled: true, provider_by_platform: { darwin: 'mock', win32: 'windows:uia' }, app_approvals: [] },
      }));

    render(<ComputerUseTab />);

    await waitFor(() => expect(document.querySelector('select')?.getAttribute('value') ?? (document.querySelector('select') as HTMLSelectElement | null)?.value).toBe('macos:cua'));
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'mock' } });

    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalledTimes(2));
    expect(hanaFetchMock.mock.calls[1][0]).toBe('/api/preferences/computer-use');
    expect(hanaFetchMock.mock.calls[1][1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ settings: { provider_by_platform: { darwin: 'mock', win32: 'windows:uia' } } }),
    });
  });

  it('does not show the Windows foreground input toggle on macOS', async () => {
    hanaFetchMock.mockResolvedValue(jsonResponse({
      selectedProviderId: 'macos:cua',
      settings: {
        enabled: true,
        provider_by_platform: { darwin: 'macos:cua', win32: 'windows:uia' },
        allow_windows_input_injection: true,
        app_approvals: [],
      },
      status: {
        platform: 'darwin',
        providers: [{ providerId: 'macos:cua', status: { available: true, permissions: [] } }],
        activeLease: null,
      },
    }));

    render(<ComputerUseTab />);

    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalledWith('/api/preferences/computer-use'));
    expect(screen.queryByText('settings.computerUse.windowsInputInjection')).toBeNull();
  });

  it('updates permissions from the POST response without issuing a second status fetch', async () => {
    hanaFetchMock
      .mockResolvedValueOnce(jsonResponse({
        selectedProviderId: 'macos:cua',
        settings: { enabled: true, provider_by_platform: { darwin: 'macos:cua' }, app_approvals: [] },
        status: {
          platform: 'darwin',
          providers: [{ providerId: 'macos:cua', status: { available: true, permissions: [] } }],
          activeLease: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        result: {
          providerId: 'macos:cua',
          permissions: [
            { name: 'Accessibility', granted: true },
            { name: 'Screen Recording', granted: true },
          ],
        },
      }));

    render(<ComputerUseTab />);

    await waitFor(() => expect(screen.getByText('settings.computerUse.checkPermissions')).toBeTruthy());
    fireEvent.click(screen.getByText('settings.computerUse.checkPermissions'));

    await waitFor(() => expect(screen.getByText(/settings\.computerUse\.permissionsGranted: Accessibility · Screen Recording/)).toBeTruthy());
    expect(hanaFetchMock).toHaveBeenCalledTimes(2);
    expect(hanaFetchMock.mock.calls[1][0]).toBe('/api/preferences/computer-use/request-permissions');
  });
});
