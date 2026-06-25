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
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SettingsYouPage } from '../../src/routes/app/settings/you.js';

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
