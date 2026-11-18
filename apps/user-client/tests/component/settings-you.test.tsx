// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

// ─── Stable test data ─────────────────────────────────────────────────────────

const updateMock = vi.fn(async () => {});

const STABLE_SETTINGS = {
  id: 1 as const,
  displayName: '',
  globalInstructions: '',
  globalAboutMe: '',
  defaultMindspaceId: 'ms1',
  userTexture: 'cloudy' as const,
  adultMode: 'nsfw' as const,
  animationsEnabled: true,
  corsProxy: null,
  createdAt: 0,
  updatedAt: 0,
};

const STABLE_MS = [
  {
    id: 'ms1',
    displayName: 'Aurum',
    palette: {
      bg: '#000',
      surfaceBase: '#111',
      surfaceRaised: '#222',
      surfaceInput: '#333',
      accent: '#c9a84c',
      accentSubtle: '#a0a',
      accentBorder: '#909',
      accentBorderActive: '#b0b',
      accentGlow: '#c0c',
      text: { primary: '#fff', secondary: '#ccc', muted: '#999', ghost: '#666' },
    },
    texture: 'cloudy' as const,
    builtIn: true,
    createdAt: 0,
  },
];

// ─── Module mocks (hoisted before static imports by Vitest) ───────────────────

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: STABLE_SETTINGS }),
  useUpdateSettings: () => ({ mutateAsync: updateMock }),
}));

vi.mock('../../src/data/mindspaces.js', () => ({
  useMindspaces: () => ({ data: STABLE_MS }),
}));

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

// ─── Imports (resolved after mocks are registered) ────────────────────────────

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsYouPage } from '../../src/routes/app/settings/you.js';
import { stubReducedMotionQuery } from '../helpers/media-query-stub.js';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SettingsYouPage', () => {
  it('renders About Me, Global Instructions and a Mindspace trigger', async () => {
    wrap(<SettingsYouPage />);
    expect(await screen.findByLabelText('About me')).toBeInTheDocument();
    expect(screen.getByLabelText('Global instructions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mindspace/i })).toBeInTheDocument();
  });
});

describe('Reduce animations switch', () => {
  const HELPER =
    'Stills the drifting background, the breathing orbs and other motion on this device. Screen effects play gently.';
  const SYSTEM_NOTE =
    'Your device asks for reduced motion, so this stays on. Change it in your system settings.';

  afterEach(() => {
    vi.unstubAllGlobals();
    updateMock.mockClear();
    STABLE_SETTINGS.animationsEnabled = true;
  });

  it('sits under Mindspace with its helper as visible text', () => {
    stubReducedMotionQuery(false);
    wrap(<SettingsYouPage />);
    const toggle = screen.getByRole('button', { name: 'Reduce animations' });
    const mindspace = screen.getByRole('button', { name: /Mindspace/i });
    expect(
      mindspace.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText(HELPER)).toBeVisible();
    expect(toggle).not.toHaveAttribute('title');
  });

  it('with the system off, shows !animationsEnabled and writes the field', () => {
    stubReducedMotionQuery(false);
    wrap(<SettingsYouPage />);
    const toggle = screen.getByRole('button', { name: 'Reduce animations' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toBeEnabled();
    expect(screen.queryByText(SYSTEM_NOTE)).toBeNull();
    fireEvent.click(toggle);
    expect(updateMock).toHaveBeenCalledWith({ animationsEnabled: false });
  });

  it('with the switch already on, turning it off writes animationsEnabled: true', () => {
    stubReducedMotionQuery(false);
    STABLE_SETTINGS.animationsEnabled = false;
    wrap(<SettingsYouPage />);
    const toggle = screen.getByRole('button', { name: 'Reduce animations' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(updateMock).toHaveBeenCalledWith({ animationsEnabled: true });
  });

  it('with the system on, shows on, disabled, with the visible note', () => {
    stubReducedMotionQuery(true);
    wrap(<SettingsYouPage />);
    const toggle = screen.getByRole('button', { name: 'Reduce animations' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toBeDisabled();
    expect(toggle).not.toHaveAttribute('title');
    expect(screen.getByText(SYSTEM_NOTE)).toBeVisible();
    fireEvent.click(toggle);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('follows the system setting live and keeps the user choice', () => {
    const system = stubReducedMotionQuery(false);
    STABLE_SETTINGS.animationsEnabled = false;
    wrap(<SettingsYouPage />);
    const toggle = screen.getByRole('button', { name: 'Reduce animations' });
    expect(toggle).toBeEnabled();
    act(() => system.set(true));
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(SYSTEM_NOTE)).toBeVisible();
    act(() => system.set(false));
    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(SYSTEM_NOTE)).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
