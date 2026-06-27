// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PersonaModelBehaviour } from '../../../src/routes/app/persona/model-behaviour.js';

// ── Shared stable persona fixture ─────────────────────────────────────────────

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

// ── Mutable mock state (configurable per test) ────────────────────────────────

const state: {
  persona: typeof BASE_PERSONA | null | undefined;
  patch: ReturnType<typeof vi.fn>;
  expertModel: string | null;
} = {
  persona: BASE_PERSONA,
  patch: vi.fn().mockResolvedValue(undefined),
  expertModel: null,
};

vi.mock('../../../src/routes/app/persona/use-persona-editing.js', () => ({
  usePersonaEditing: (_id: string | null) => ({
    persona: state.persona,
    patch: state.patch,
  }),
}));

vi.mock('../../../src/data/settings.js', () => ({
  useSettings: () => ({
    data: { expertModel: state.expertModel },
  }),
}));

// No provider rows by default — means no offering is resolvable.
vi.mock('../../../src/data/providers.js', () => ({
  useProviders: () => ({ data: [] }),
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
      <MemoryRouter initialEntries={[`/app/persona/${personaId}/model`]}>
        <Routes>
          <Route path="/app/persona/:id/model" element={<PersonaModelBehaviour />} />
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

describe('PersonaModelBehaviour — not-found guard', () => {
  it('renders the not-found notice when persona is null', async () => {
    state.persona = null;
    renderPage('p-missing');

    await waitFor(() => expect(screen.getByTestId('persona-model-behaviour')).toBeInTheDocument());
    expect(screen.getByText(/persona not found/i)).toBeInTheDocument();
  });
});

describe('PersonaModelBehaviour — loading guard', () => {
  it('renders an empty shell when persona is undefined', async () => {
    state.persona = undefined;
    renderPage('p-loading');

    await waitFor(() => expect(screen.getByTestId('persona-model-behaviour')).toBeInTheDocument());
    // No temperature slider visible while loading.
    expect(screen.queryByLabelText(/temperature/i)).toBeNull();
  });
});

describe('PersonaModelBehaviour — Temperature slider', () => {
  it('renders a slider with the persona temperature value', async () => {
    state.persona = { ...BASE_PERSONA, temperature: 1.2 };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-model-behaviour')).toBeInTheDocument());

    const slider = screen.getByRole('slider', { name: /temperature/i });
    expect(slider).toHaveValue('1.2');
  });

  it('calls patch with the new temperature when the slider changes', async () => {
    state.persona = { ...BASE_PERSONA, temperature: 0.85 };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-model-behaviour')).toBeInTheDocument());

    const slider = screen.getByRole('slider', { name: /temperature/i });
    fireEvent.change(slider, { target: { value: '1.5' } });

    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ temperature: 1.5 }));
  });
});

describe('PersonaModelBehaviour — Context window', () => {
  it('shows the "pick a model" note when no offering is resolvable', async () => {
    state.persona = { ...BASE_PERSONA };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-model-behaviour')).toBeInTheDocument());

    expect(
      screen.getByText(/pick a model on the hub to tune its context window/i),
    ).toBeInTheDocument();
    // No context-window slider rendered.
    expect(screen.queryByLabelText(/context window/i)).toBeNull();
  });
});

describe('PersonaModelBehaviour — Ask an expert by default toggle', () => {
  it('is disabled with reason when no expert model is configured', async () => {
    state.persona = { ...BASE_PERSONA, askExpertDefault: false };
    state.expertModel = null;
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-model-behaviour')).toBeInTheDocument());

    const toggle = screen.getByRole('button', { name: /ask an expert by default/i });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('title', 'Choose a global expert model in Settings first.');
  });

  it('is enabled when an expert model is configured', async () => {
    state.persona = { ...BASE_PERSONA, askExpertDefault: false };
    state.expertModel = 'some-expert-model';
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-model-behaviour')).toBeInTheDocument());

    const toggle = screen.getByRole('button', { name: /ask an expert by default/i });
    expect(toggle).not.toBeDisabled();
    expect(toggle).not.toHaveAttribute('title');
  });

  it('calls patch with { askExpertDefault: true } when toggled on', async () => {
    state.persona = { ...BASE_PERSONA, askExpertDefault: false };
    state.expertModel = 'some-expert-model';
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-model-behaviour')).toBeInTheDocument());

    const toggle = screen.getByRole('button', { name: /ask an expert by default/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);

    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ askExpertDefault: true }));
  });

  it('calls patch with { askExpertDefault: false } when toggled off', async () => {
    state.persona = { ...BASE_PERSONA, askExpertDefault: true };
    state.expertModel = 'some-expert-model';
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-model-behaviour')).toBeInTheDocument());

    const toggle = screen.getByRole('button', { name: /ask an expert by default/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);

    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ askExpertDefault: false }));
  });
});
