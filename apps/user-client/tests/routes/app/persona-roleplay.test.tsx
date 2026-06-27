// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PersonaRoleplay } from '../../../src/routes/app/persona/roleplay.js';

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
  narration: 'first' as 'first' | 'third',
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

vi.mock('../../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

// ── Render helper ─────────────────────────────────────────────────────────────

function renderPage(personaId: string) {
  state.patch = vi.fn().mockResolvedValue(undefined);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/app/persona/${personaId}/roleplay`]}>
        <Routes>
          <Route path="/app/persona/:id/roleplay" element={<PersonaRoleplay />} />
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

describe('PersonaRoleplay — not-found guard', () => {
  it('renders the not-found notice when persona is null', async () => {
    state.persona = null;
    renderPage('p-missing');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());
    expect(screen.getByText(/persona not found/i)).toBeInTheDocument();
  });
});

describe('PersonaRoleplay — loading guard', () => {
  it('renders an empty shell when persona is undefined', async () => {
    state.persona = undefined;
    renderPage('p-loading');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());
    // No content visible while loading — the description text is absent.
    expect(screen.queryByText(/the persona becomes a roleplay character/i)).toBeNull();
  });
});

describe('PersonaRoleplay — Roleplay toggle', () => {
  it('calls patch with { roleplay: true } when roleplay is off and the toggle is clicked', async () => {
    state.persona = { ...BASE_PERSONA, roleplay: false };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());

    const toggle = screen.getByRole('button', { name: /^roleplay$/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);

    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ roleplay: true }));
  });

  it('calls patch with { roleplay: false } when roleplay is on and the toggle is clicked', async () => {
    state.persona = { ...BASE_PERSONA, roleplay: true };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());

    const toggle = screen.getByRole('button', { name: /^roleplay$/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggle);

    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ roleplay: false }));
  });
});

describe('PersonaRoleplay — Narration control (disabled when roleplay off)', () => {
  it('disables narration buttons with reason when roleplay is off', async () => {
    state.persona = { ...BASE_PERSONA, roleplay: false };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());

    const firstBtn = screen.getByRole('tab', { name: /first person/i });
    const thirdBtn = screen.getByRole('tab', { name: /third person/i });

    expect(firstBtn).toBeDisabled();
    expect(thirdBtn).toBeDisabled();
    expect(firstBtn).toHaveAttribute(
      'title',
      'Enable Roleplay to choose the narration perspective',
    );
    expect(thirdBtn).toHaveAttribute(
      'title',
      'Enable Roleplay to choose the narration perspective',
    );
  });

  it('enables narration buttons when roleplay is on', async () => {
    state.persona = { ...BASE_PERSONA, roleplay: true };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());

    const firstBtn = screen.getByRole('tab', { name: /first person/i });
    const thirdBtn = screen.getByRole('tab', { name: /third person/i });

    expect(firstBtn).not.toBeDisabled();
    expect(thirdBtn).not.toBeDisabled();
  });

  it('calls patch with { narration: "third" } when the Third person tab is clicked', async () => {
    state.persona = { ...BASE_PERSONA, roleplay: true, narration: 'first' };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());

    const thirdBtn = screen.getByRole('tab', { name: /third person/i });
    fireEvent.click(thirdBtn);

    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ narration: 'third' }));
  });

  it('calls patch with { narration: "first" } when the First person tab is clicked', async () => {
    state.persona = { ...BASE_PERSONA, roleplay: true, narration: 'third' };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());

    const firstBtn = screen.getByRole('tab', { name: /first person/i });
    fireEvent.click(firstBtn);

    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ narration: 'first' }));
  });
});

describe('PersonaRoleplay — Greeting toggle (disabled when roleplay off)', () => {
  it('disables the greeting toggle with reason when roleplay is off', async () => {
    state.persona = { ...BASE_PERSONA, roleplay: false, greetingEnabled: false };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());

    const toggle = screen.getByRole('button', { name: /^greeting$/i });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('title', 'Enable Roleplay to set a greeting');
  });

  it('enables the greeting toggle when roleplay is on', async () => {
    state.persona = { ...BASE_PERSONA, roleplay: true, greetingEnabled: false };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());

    const toggle = screen.getByRole('button', { name: /^greeting$/i });
    expect(toggle).not.toBeDisabled();
  });

  it('calls patch with { greetingEnabled: true } when greeting is toggled on', async () => {
    state.persona = { ...BASE_PERSONA, roleplay: true, greetingEnabled: false };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());

    const toggle = screen.getByRole('button', { name: /^greeting$/i });
    fireEvent.click(toggle);

    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ greetingEnabled: true }));
  });
});

describe('PersonaRoleplay — Greeting rules textarea', () => {
  it('disables the greeting textarea when roleplay is off', async () => {
    state.persona = { ...BASE_PERSONA, roleplay: false, greetingEnabled: false };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());

    const textarea = screen.getByRole('textbox', { name: /greeting rules/i });
    expect(textarea).toBeDisabled();
  });

  it('disables the greeting textarea when roleplay is on but greeting is off', async () => {
    state.persona = { ...BASE_PERSONA, roleplay: true, greetingEnabled: false };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());

    const textarea = screen.getByRole('textbox', { name: /greeting rules/i });
    expect(textarea).toBeDisabled();
  });

  it('enables the greeting textarea when roleplay and greeting are both on', async () => {
    state.persona = {
      ...BASE_PERSONA,
      roleplay: true,
      greetingEnabled: true,
      greetingInstructions: 'Say hello.',
    };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());

    const textarea = screen.getByRole('textbox', { name: /greeting rules/i });
    expect(textarea).not.toBeDisabled();
  });

  it('shows the amber cue when greeting is enabled but rules are empty', async () => {
    state.persona = {
      ...BASE_PERSONA,
      roleplay: true,
      greetingEnabled: true,
      greetingInstructions: '',
    };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());

    expect(
      screen.getByText(/write the greeting rules, or turn the greeting off/i),
    ).toBeInTheDocument();
  });

  it('does not show the amber cue when greeting rules are non-empty', async () => {
    state.persona = {
      ...BASE_PERSONA,
      roleplay: true,
      greetingEnabled: true,
      greetingInstructions: 'Say hello warmly.',
    };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());

    expect(screen.queryByText(/write the greeting rules/i)).toBeNull();
  });

  it('does not show the amber cue when greeting is off', async () => {
    state.persona = {
      ...BASE_PERSONA,
      roleplay: true,
      greetingEnabled: false,
      greetingInstructions: '',
    };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());

    expect(screen.queryByText(/write the greeting rules/i)).toBeNull();
  });

  it('calls patch with updated greetingInstructions on blur', async () => {
    state.persona = {
      ...BASE_PERSONA,
      roleplay: true,
      greetingEnabled: true,
      greetingInstructions: 'Initial rules.',
    };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-roleplay')).toBeInTheDocument());

    const textarea = screen.getByRole('textbox', { name: /greeting rules/i });
    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: 'Greet warmly as a pirate.' } });
    fireEvent.blur(textarea);

    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith({
        greetingInstructions: 'Greet warmly as a pirate.',
      }),
    );
  });
});
