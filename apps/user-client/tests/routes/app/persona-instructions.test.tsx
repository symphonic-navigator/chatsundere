// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PersonaInstructions } from '../../../src/routes/app/persona/instructions.js';

// ── Shared stable persona fixtures ───────────────────────────────────────────

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
} = {
  persona: BASE_PERSONA,
  patch: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../../src/routes/app/persona/use-persona-editing.js', () => ({
  usePersonaEditing: (_id: string | null) => ({
    persona: state.persona,
    patch: state.patch,
  }),
}));

vi.mock('../../../src/data/settings.js', () => ({
  useSettings: () => ({
    data: { globalAboutMe: 'I am the user.' },
  }),
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
      <MemoryRouter initialEntries={[`/app/persona/${personaId}/instructions`]}>
        <Routes>
          <Route path="/app/persona/:id/instructions" element={<PersonaInstructions />} />
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

describe('PersonaInstructions — not-found guard', () => {
  it('renders the not-found notice when persona is null', async () => {
    state.persona = null;
    renderPage('p-missing');

    await waitFor(() => expect(screen.getByTestId('persona-instructions')).toBeInTheDocument());
    expect(screen.getByText(/persona not found/i)).toBeInTheDocument();
  });
});

describe('PersonaInstructions — loading guard', () => {
  it('renders an empty shell when persona is undefined', async () => {
    state.persona = undefined;
    renderPage('p-loading');

    await waitFor(() => expect(screen.getByTestId('persona-instructions')).toBeInTheDocument());
    // No content visible while loading.
    expect(screen.queryByText(/chatsundere tonality/i)).toBeNull();
  });
});

describe('PersonaInstructions — Adult Persona toggle', () => {
  it('calls patch with { adultPersona: true } when persona.adultPersona is false and the toggle is clicked', async () => {
    state.persona = { ...BASE_PERSONA, adultPersona: false };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-instructions')).toBeInTheDocument());

    const toggle = screen.getByRole('button', { name: /adult persona/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);

    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ adultPersona: true }));
  });

  it('calls patch with { adultPersona: false } when persona.adultPersona is true and the toggle is clicked', async () => {
    state.persona = { ...BASE_PERSONA, adultPersona: true };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-instructions')).toBeInTheDocument());

    const toggle = screen.getByRole('button', { name: /adult persona/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggle);

    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ adultPersona: false }));
  });
});

describe('PersonaInstructions — Custom Instructions field', () => {
  it('calls patch with new instructions text when the field is blurred after typing', async () => {
    state.persona = { ...BASE_PERSONA, instructions: 'Be wise.' };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-instructions')).toBeInTheDocument());

    const textarea = screen.getByRole('textbox', { name: /custom instructions/i });

    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: 'Be a sage who meditates.' } });
    fireEvent.blur(textarea);

    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith({ instructions: 'Be a sage who meditates.' }),
    );
  });

  it('shows the "Needs setup" cue when instructions are empty', async () => {
    state.persona = { ...BASE_PERSONA, instructions: '' };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-instructions')).toBeInTheDocument());

    expect(screen.getByText(/needs setup/i)).toBeInTheDocument();
  });

  it('hides the "Needs setup" cue when instructions are non-empty', async () => {
    state.persona = { ...BASE_PERSONA, instructions: 'Be wise.' };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-instructions')).toBeInTheDocument());

    expect(screen.queryByText(/needs setup/i)).toBeNull();
  });
});
