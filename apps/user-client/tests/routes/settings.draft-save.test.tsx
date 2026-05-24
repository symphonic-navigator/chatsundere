// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateMock = vi.fn(async () => {});

const STABLE_SETTINGS = {
  id: 1,
  displayName: '',
  globalUnlockerPrompt: 'old prompt',
  globalAboutMe: 'old about',
  defaultMindspaceId: 'a',
  userTexture: 'cloudy' as const,
  adultMode: 'nsfw' as const,
  animationsEnabled: true,
  corsProxy: null,
  createdAt: 0,
  updatedAt: 0,
};

const STABLE_MS = [
  {
    id: 'a',
    displayName: 'Aurum',
    palette: {
      bg: '#000',
      surfaceBase: 'x',
      surfaceRaised: 'x',
      surfaceInput: 'x',
      accent: '#c9a84c',
      accentSubtle: 'x',
      accentBorder: 'x',
      accentBorderActive: 'x',
      accentGlow: 'x',
      text: { primary: '#fff', secondary: 'x', muted: 'x', ghost: 'x' },
    },
    texture: 'cloudy' as const,
    builtIn: true,
    createdAt: 0,
  },
];

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: STABLE_SETTINGS }),
  useUpdateSettings: () => ({ mutateAsync: updateMock, mutate: updateMock }),
}));

vi.mock('../../src/data/mindspaces.js', () => ({
  useMindspaces: () => ({ data: STABLE_MS }),
}));

vi.mock('../../src/data/providers.js', () => ({
  useProviders: () => ({ data: [] }),
}));

vi.mock('../../src/state/mindspace.store.js', () => ({
  useMindspaceStore: vi.fn((selector?: unknown) => {
    if (typeof selector === 'function') {
      return (selector as (s: { update: () => void }) => unknown)({ update: () => {} });
    }
    return { update: () => {} };
  }),
}));

import { Settings } from '../../src/routes/app/settings.js';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Settings — draft + Save flow', () => {
  beforeEach(() => updateMock.mockClear());

  it('does not call updateSettings on each keystroke', async () => {
    setup();
    fireEvent.click(screen.getByText(/^about me$/i));
    const ta = await screen.findByLabelText(/about me/i);
    fireEvent.change(ta, { target: { value: 'new content' } });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('calls updateSettings once when Save is clicked', async () => {
    setup();
    fireEvent.click(screen.getByText(/^about me$/i));
    const ta = await screen.findByLabelText(/about me/i);
    fireEvent.change(ta, { target: { value: 'new content' } });
    const saveBtns = screen.getAllByRole('button', { name: /save settings/i });
    const lastSaveBtn = saveBtns[saveBtns.length - 1];
    if (!lastSaveBtn) throw new Error('Save Settings button not found');
    fireEvent.click(lastSaveBtn);
    await Promise.resolve();
    expect(updateMock).toHaveBeenCalled();
    const firstCall = updateMock.mock.calls[0] as unknown[] | undefined;
    const payload = (firstCall ? firstCall[0] : undefined) as
      | { globalAboutMe?: string }
      | undefined;
    expect(payload?.globalAboutMe).toBe('new content');
  });
});
