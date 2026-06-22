// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────
// All data hooks are mocked so no real TanStack-Query infrastructure is needed.
// Each hook is wrapped in vi.fn() so individual describe blocks can override
// return values via vi.mocked(hook).mockReturnValue(...).

vi.mock('../../../src/data/chats.js', () => ({
  useChats: vi.fn(() => ({
    data: [{ id: 'c1', personaId: 'p1', title: 'HTML calculator artefact test' }],
  })),
}));

vi.mock('../../../src/data/personas.js', () => ({
  useFilteredPersonas: vi.fn(() => ({
    data: [{ id: 'p1', name: 'Fable', colour: '#a78bfa' }],
  })),
}));

vi.mock('../../../src/data/providers.js', () => ({
  useProviders: vi.fn(() => ({ data: [{ id: 'pr1', templateId: 'openai', enabled: true }] })),
}));

vi.mock('../../../src/data/mindspaces.js', () => ({
  useMindspaces: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../../src/data/settings.js', () => ({
  useSettings: vi.fn(() => ({
    data: {
      defaultMindspaceId: null,
      userTexture: 'none',
    },
  })),
  useDisplayName: vi.fn(() => 'Chris'),
}));

vi.mock('../../../src/data/knowledge.js', () => ({
  useFilteredLibraries: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../../src/data/artefacts.js', () => ({
  useAllArtefactCount: vi.fn(() => ({ data: 0 })),
}));

import { useChats } from '../../../src/data/chats.js';
import { useFilteredPersonas } from '../../../src/data/personas.js';
import { useProviders } from '../../../src/data/providers.js';
import { EntranceHall } from '../../../src/routes/app/entrance-hall.js';

const renderHall = () =>
  render(
    <MemoryRouter>
      <EntranceHall />
    </MemoryRouter>,
  );

// Default happy-path data reused across baseline tests.
const defaultChatsResult = {
  data: [{ id: 'c1', personaId: 'p1', title: 'HTML calculator artefact test' }],
} as unknown as ReturnType<typeof useChats>;
const defaultPersonasResult = {
  data: [{ id: 'p1', name: 'Fable', colour: '#a78bfa' }],
} as unknown as ReturnType<typeof useFilteredPersonas>;
const defaultProvidersResult = {
  data: [{ id: 'pr1', templateId: 'openai', enabled: true }],
} as unknown as ReturnType<typeof useProviders>;
const emptyProvidersResult = { data: [] } as unknown as ReturnType<typeof useProviders>;
const emptyPersonasResult = { data: [] } as unknown as ReturnType<typeof useFilteredPersonas>;
const emptyChatsResult = { data: [] } as unknown as ReturnType<typeof useChats>;

describe('EntranceHall', () => {
  beforeEach(() => {
    // Restore defaults before each test so override blocks don't leak.
    vi.mocked(useChats).mockReturnValue(defaultChatsResult);
    vi.mocked(useFilteredPersonas).mockReturnValue(defaultPersonasResult);
    vi.mocked(useProviders).mockReturnValue(defaultProvidersResult);
  });

  it('shows the gold Continue card when a recent chat exists', () => {
    renderHall();
    const crown = screen.getByText(/CONTINUE/i).closest('.cs-navtile');
    expect(crown).toHaveAttribute('data-gold', 'true');
    expect(crown).toHaveAttribute('data-wide', 'true');
    expect(screen.getByText('HTML calculator artefact test')).toBeInTheDocument();
  });

  it('renders the eight rooms with My Projects disabled', () => {
    renderHall();
    const projects = screen.getByRole('button', { name: /My Projects/ });
    expect(projects).toHaveAttribute('aria-disabled', 'true');
    expect(projects).toHaveAttribute('title', 'Coming after the alpha');
  });

  it('keeps the fixed ascension order: Circle/History, Treasury/Projects, Knowledge/Integrations, Settings/Account', () => {
    renderHall();
    const labels = screen.getAllByText(/^My /).map((n) => n.textContent);
    expect(labels).toEqual([
      'My Circle',
      'My History',
      'My Treasury',
      'My Projects',
      'My Knowledge',
      'My Integrations',
      'My Settings',
      'My Account',
    ]);
  });
});

describe('EntranceHall Crown — Setup-Hints logic', () => {
  beforeEach(() => {
    // Restore full happy-path defaults; each test overrides what it needs.
    vi.mocked(useChats).mockReturnValue(defaultChatsResult);
    vi.mocked(useFilteredPersonas).mockReturnValue(defaultPersonasResult);
    vi.mocked(useProviders).mockReturnValue(defaultProvidersResult);
  });

  it('(a) no enabled provider — shows "Connect a provider" step; Continue not shown', () => {
    vi.mocked(useProviders).mockReturnValue(emptyProvidersResult);
    renderHall();
    const card = screen.getByText(/Connect a provider/).closest('.cs-navtile');
    expect(card).toHaveAttribute('data-gold', 'true');
    expect(screen.queryByText(/CONTINUE/i)).toBeNull();
  });

  it('(b) no persona — shows "Create your first companion" step', () => {
    vi.mocked(useFilteredPersonas).mockReturnValue(emptyPersonasResult);
    renderHall();
    expect(screen.getByText(/Create your first companion/)).toBeInTheDocument();
    expect(screen.queryByText(/CONTINUE/i)).toBeNull();
  });

  it('(c) both satisfied + a recent chat — Continue shown; no setup steps', () => {
    renderHall();
    expect(screen.getByText(/CONTINUE/i)).toBeInTheDocument();
    expect(screen.queryByText(/Connect a provider/)).toBeNull();
    expect(screen.queryByText(/Create your first companion/)).toBeNull();
  });

  it('(d) both satisfied + no chat — neither Continue nor setup steps shown', () => {
    vi.mocked(useChats).mockReturnValue(emptyChatsResult);
    renderHall();
    expect(screen.queryByText(/CONTINUE/i)).toBeNull();
    expect(screen.queryByText(/Connect a provider/)).toBeNull();
    expect(screen.queryByText(/Create your first companion/)).toBeNull();
  });
});
