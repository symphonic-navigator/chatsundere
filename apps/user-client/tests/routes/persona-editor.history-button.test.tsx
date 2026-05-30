// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Stable mock data
// ---------------------------------------------------------------------------

const PERSONA_ID = 'p-history-test';

const STABLE_SETTINGS = {
  data: { defaultMindspaceId: 'ms1', userTexture: 'cloudy' as const },
};
const STABLE_MINDSPACES = {
  data: [
    {
      id: 'ms1',
      displayName: 'Aurum',
      palette: {
        bg: '#000',
        surfaceBase: 'rgba(0,0,0,0.1)',
        surfaceRaised: 'rgba(0,0,0,0.2)',
        surfaceInput: 'rgba(0,0,0,0.3)',
        accent: '#c9a84c',
        accentSubtle: 'rgba(0,0,0,0)',
        accentBorder: 'rgba(0,0,0,0)',
        accentBorderActive: 'rgba(0,0,0,0)',
        accentGlow: 'rgba(0,0,0,0)',
        text: { primary: '#fff', secondary: '#eee', muted: '#aaa', ghost: '#666' },
      },
      texture: 'cloudy' as const,
      builtIn: true,
      createdAt: 0,
    },
  ],
};
const STABLE_PROVIDERS = {
  data: [{ id: 'pv1', templateId: 'nano-gpt', enabled: true } as never],
};
const PERSONA_DATA = {
  data: {
    id: PERSONA_ID,
    name: 'Vela',
    tagline: 'star',
    colour: '#c9a84c',
    font: 'serif' as const,
    instructions: 'be vela',
    canonicalId: 'glm-5.1',
    providerId: 'pv1',
    modelId: 'm1',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    createdAt: 0,
    updatedAt: 0,
  },
};

const CHAT_FOR_PERSONA = {
  id: 'chat-1',
  personaId: PERSONA_ID,
  title: null,
  resolvedMindspaceId: 'ms1',
  createdAt: 0,
  lastMessageAt: 0,
  bookmarkedMessageCount: 0,
  draftInput: '',
};

vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: () => ({
    id: 'pv1',
    displayName: 'P',
    baseUrl: 'x',
    offerings: [],
  }),
  getCanonical: () => ({ id: 'glm-5.1', displayName: 'GLM 5.1' }),
  listCanonicals: () => [],
  listOfferings: () => [],
}));

vi.mock('../../src/data/personas.js', () => ({
  usePersona: () => PERSONA_DATA,
  useCreatePersona: () => ({ mutateAsync: vi.fn() }),
  useUpdatePersona: () => ({ mutateAsync: vi.fn() }),
  useDeletePersona: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => STABLE_SETTINGS,
}));

vi.mock('../../src/data/mindspaces.js', () => ({
  useMindspaces: () => STABLE_MINDSPACES,
}));

vi.mock('../../src/data/providers.js', () => ({
  useProviders: () => STABLE_PROVIDERS,
}));

// useChats mock — toggled per-test via a module-level variable.
let mockChatsData: (typeof CHAT_FOR_PERSONA)[] = [];

vi.mock('../../src/data/chats.js', () => ({
  useChats: () => ({ data: mockChatsData }),
}));

import { PersonaEditor } from '../../src/routes/app/persona-editor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stub route that renders the `personaId` query param so we can assert it. */
function HistoryStub() {
  const [params] = useSearchParams();
  return <div data-testid="history-sentinel">history:{params.get('personaId')}</div>;
}

function setup(initialPath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/app/persona/:id" element={<PersonaEditor />} />
          <Route path="/app/persona/new" element={<PersonaEditor />} />
          <Route path="/app/history" element={<HistoryStub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PersonaEditor — 2×2 quick-actions grid + History button', () => {
  it('renders four quick-action buttons in a 2×2 grid: Continue, New Chat, Incognito, History', async () => {
    mockChatsData = [CHAT_FOR_PERSONA];
    setup(`/app/persona/${PERSONA_ID}`);
    await waitFor(() => expect(screen.queryByText('History')).not.toBeNull());

    const grid = document.querySelector('[data-quick-actions]') as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.className).toContain('grid-cols-2');
    expect(grid.querySelectorAll('button').length).toBe(4);
  });

  it('History button is disabled when the persona has no chats', async () => {
    mockChatsData = [];
    setup(`/app/persona/${PERSONA_ID}`);
    await waitFor(() => expect(screen.queryByText('History')).not.toBeNull());

    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'History',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/no chats with this persona yet/i);
  });

  it('History button navigates to /app/history?personaId=<id> when enabled', async () => {
    mockChatsData = [CHAT_FOR_PERSONA];
    setup(`/app/persona/${PERSONA_ID}`);
    await waitFor(() => expect(screen.queryByText('History')).not.toBeNull());

    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'History',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByTestId('history-sentinel')).toBeInTheDocument();
    });
    expect(screen.getByTestId('history-sentinel').textContent).toBe(`history:${PERSONA_ID}`);
  });

  it('History button is hidden in create mode', async () => {
    mockChatsData = [];
    setup('/app/persona/new');
    // In create mode the quick-actions grid is not rendered at all.
    await waitFor(() => expect(screen.queryByText(/new persona/i)).not.toBeNull());
    expect(document.body.textContent).not.toContain('History');
  });
});
