/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const hanaFetchMock = vi.fn();

vi.mock('../../../api', () => ({
  hanaFetch: (...args: unknown[]) => hanaFetchMock(...args),
}));

vi.mock('../../../helpers', () => ({
  t: (key: string) => key,
}));

import { ComputerUseStatusSection } from '../ComputerUseStatusSection';

afterEach(() => {
  cleanup();
  hanaFetchMock.mockReset();
});

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

describe('ComputerUseStatusSection', () => {
  it('does not treat an empty permissions list as granted', async () => {
    hanaFetchMock.mockResolvedValue(jsonResponse({
      selectedProviderId: 'macos:cua',
      settings: { app_approvals: [] },
      status: {
        platform: 'darwin',
        providers: [{ providerId: 'macos:cua', status: { available: true, permissions: [] } }],
      },
    }));

    render(<ComputerUseStatusSection visible />);

    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalledWith('/api/preferences/computer-use'));
    expect(screen.getByText('settings.computerUse.permissionsUnknown')).toBeTruthy();
  });

  it('shows missing permissions with the same wording as the global Computer Use page', async () => {
    hanaFetchMock.mockResolvedValue(jsonResponse({
      selectedProviderId: 'macos:cua',
      settings: { app_approvals: [] },
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
      },
    }));

    render(<ComputerUseStatusSection visible />);

    await waitFor(() => expect(screen.getByText(/settings\.computerUse\.permissionsMissing: Screen Recording/)).toBeTruthy());
  });
});
