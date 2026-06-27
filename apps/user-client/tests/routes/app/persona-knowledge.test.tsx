// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PersonaKnowledge } from '../../../src/routes/app/persona/knowledge.js';

// ── Shared stable fixtures ─────────────────────────────────────────────────────

const BASE_PERSONA = {
  id: 'p-1',
  name: 'Sage',
  tagline: 'A wise guide',
  colour: '#c9a84c',
  font: 'serif' as const,
  instructions: 'Be wise.',
  canonicalId: 'glm-5.1',
  providerId: 'pv1',
  modelId: 'glm-4-flash',
  mindspaceId: null,
  aboutMeOverride: null,
  textureOverride: null,
  temperature: 0.85,
  adultPersona: false,
  chatsundereTonality: true,
  contextWindow: null,
  libraryIds: [] as string[],
  askExpertDefault: false,
  mcpOverrides: {} as Record<string, 'on' | 'off'>,
  roleplay: false,
  narration: 'first' as const,
  greetingEnabled: false,
  greetingInstructions: '',
  voice: null,
  narratorVoice: null,
  useMemory: true,
  memoryInstructions: '',
  createdAt: 0,
  updatedAt: 0,
};

const LIBRARIES = [
  {
    id: 'lib-1',
    name: 'Philosophy',
    description: 'Classic texts',
    nsfw: false,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'lib-2',
    name: 'Adult Fiction',
    description: 'NSFW stories',
    nsfw: true,
    createdAt: 0,
    updatedAt: 0,
  },
];

// ── Mutable mock state (configurable per test) ────────────────────────────────

const state: {
  persona: typeof BASE_PERSONA | null | undefined;
  patch: ReturnType<typeof vi.fn>;
  libraries: typeof LIBRARIES | undefined;
} = {
  persona: BASE_PERSONA,
  patch: vi.fn().mockResolvedValue(undefined),
  libraries: LIBRARIES,
};

vi.mock('../../../src/routes/app/persona/use-persona-editing.js', () => ({
  usePersonaEditing: (_id: string | null) => ({
    persona: state.persona,
    patch: state.patch,
  }),
}));

vi.mock('../../../src/data/knowledge.js', () => ({
  useFilteredLibraries: () => ({ data: state.libraries }),
}));

vi.mock('../../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

// ── Render helper ─────────────────────────────────────────────────────────────

function renderPage(personaId: string) {
  state.patch = vi.fn().mockResolvedValue(undefined);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/app/persona/${personaId}/knowledge`]}>
        <Routes>
          <Route path="/app/persona/:id/knowledge" element={<PersonaKnowledge />} />
          <Route
            path="/app/persona/:id"
            element={<div data-testid="persona-hub-sentinel">hub</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PersonaKnowledge — not-found guard', () => {
  it('renders the not-found notice when persona is null', async () => {
    state.persona = null;
    renderPage('p-missing');

    await waitFor(() => expect(screen.getByTestId('persona-knowledge')).toBeInTheDocument());
    expect(screen.getByText(/persona not found/i)).toBeInTheDocument();
  });
});

describe('PersonaKnowledge — loading guard', () => {
  it('renders an empty shell when persona is undefined', async () => {
    state.persona = undefined;
    renderPage('p-loading');

    await waitFor(() => expect(screen.getByTestId('persona-knowledge')).toBeInTheDocument());
    // No library content visible while loading.
    expect(screen.queryByText(/philosophy/i)).toBeNull();
  });
});

describe('PersonaKnowledge — KnowledgeSection rendered', () => {
  it('renders SFW libraries for a non-adult persona', async () => {
    state.persona = { ...BASE_PERSONA, adultPersona: false };
    state.libraries = LIBRARIES;
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-knowledge')).toBeInTheDocument());

    // SFW library appears.
    expect(screen.getByText('Philosophy')).toBeInTheDocument();

    // NSFW library must not appear when adultPersona is false.
    expect(screen.queryByText('Adult Fiction')).toBeNull();
  });

  it('renders NSFW libraries for an adult persona', async () => {
    state.persona = { ...BASE_PERSONA, adultPersona: true };
    state.libraries = LIBRARIES;
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-knowledge')).toBeInTheDocument());

    expect(screen.getByText('Philosophy')).toBeInTheDocument();
    expect(screen.getByText('Adult Fiction')).toBeInTheDocument();
  });

  it('shows the empty-state message when no libraries are available', async () => {
    state.persona = BASE_PERSONA;
    state.libraries = [];
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-knowledge')).toBeInTheDocument());
    expect(screen.getByText(/no knowledge libraries yet/i)).toBeInTheDocument();
  });
});

describe('PersonaKnowledge — library selection', () => {
  it('calls patch with the toggled libraryIds when a library button is clicked', async () => {
    state.persona = { ...BASE_PERSONA, libraryIds: [], adultPersona: false };
    state.libraries = LIBRARIES;
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-knowledge')).toBeInTheDocument());

    // Click the "Philosophy" library toggle to select it.
    const philosophyButton = screen.getByRole('button', { name: /philosophy/i });
    fireEvent.click(philosophyButton);

    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ libraryIds: ['lib-1'] }));
  });

  it('removes a library from libraryIds when it is toggled off', async () => {
    state.persona = { ...BASE_PERSONA, libraryIds: ['lib-1'], adultPersona: false };
    state.libraries = LIBRARIES;
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-knowledge')).toBeInTheDocument());

    // Click the already-active "Philosophy" button to deselect.
    const philosophyButton = screen.getByRole('button', { name: /philosophy/i });
    fireEvent.click(philosophyButton);

    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ libraryIds: [] }));
  });
});
