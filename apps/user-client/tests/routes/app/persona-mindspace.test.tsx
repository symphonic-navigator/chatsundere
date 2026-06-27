// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PersonaMindspace } from '../../../src/routes/app/persona/mindspace.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MINDSPACES = [
  {
    id: 'ms-aurum',
    displayName: 'Aurum',
    palette: { accent: '#c9a84c', bg: '#0a0a0a', surfaceRaised: '#1a1a1a' },
    texture: 'cloudy' as const,
  },
  {
    id: 'ms-crimson',
    displayName: 'Crimson',
    palette: { accent: '#e05252', bg: '#0d0808', surfaceRaised: '#1d1010' },
    texture: 'aurora' as const,
  },
];

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
  mindspaceId: null as string | null,
  aboutMeOverride: null as string | null,
  textureOverride: null as 'cloudy' | 'aurora' | 'grain' | null,
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

// ── Mutable mock state ────────────────────────────────────────────────────────

const state: {
  persona: typeof BASE_PERSONA | null | undefined;
  patch: ReturnType<typeof vi.fn>;
} = {
  persona: BASE_PERSONA,
  patch: vi.fn().mockResolvedValue(undefined),
};

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../src/routes/app/persona/use-persona-editing.js', () => ({
  usePersonaEditing: (_id: string | null) => ({
    persona: state.persona,
    patch: state.patch,
  }),
}));

vi.mock('../../../src/data/mindspaces.js', () => ({
  useMindspaces: () => ({ data: MINDSPACES }),
}));

vi.mock('../../../src/data/settings.js', () => ({
  useSettings: () => ({
    data: {
      defaultMindspaceId: 'ms-aurum',
      userTexture: 'cloudy' as const,
      globalAboutMe: 'I am the user.',
    },
  }),
}));

vi.mock('../../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

vi.mock('../../../src/state/mindspace.store.js', () => ({
  useMindspaceStore: (selector: (s: { update: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ update: vi.fn() }),
}));

/**
 * Stub MindspacePicker — exposes colour-swatch buttons and a "user-default"
 * button so tests can trigger onMindspaceChange without rendering the real
 * canvas-heavy component.
 */
vi.mock('../../../src/components/MindspacePicker.js', () => ({
  MindspacePicker: ({
    mindspaces,
    onMindspaceChange,
    onTextureChange,
  }: {
    mindspaces: typeof MINDSPACES;
    onMindspaceChange: (id: string | null) => void;
    onTextureChange: (t: string) => void;
  }) => (
    <div data-testid="mindspace-picker-stub">
      {mindspaces.map((m) => (
        <button key={m.id} type="button" onClick={() => onMindspaceChange(m.id)}>
          {`select-${m.id}`}
        </button>
      ))}
      <button type="button" onClick={() => onMindspaceChange(null)}>
        user-default
      </button>
      <button type="button" onClick={() => onTextureChange('aurora')}>
        texture-aurora
      </button>
    </div>
  ),
}));

// ── Render helper ─────────────────────────────────────────────────────────────

function renderPage(personaId: string) {
  state.patch = vi.fn().mockResolvedValue(undefined);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/app/persona/${personaId}/mindspace`]}>
        <Routes>
          <Route path="/app/persona/:id/mindspace" element={<PersonaMindspace />} />
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

describe('PersonaMindspace — not-found guard', () => {
  it('renders the not-found notice when persona is null', async () => {
    state.persona = null;
    renderPage('p-missing');

    await waitFor(() => expect(screen.getByTestId('persona-mindspace')).toBeInTheDocument());
    expect(screen.getByText(/persona not found/i)).toBeInTheDocument();
  });
});

describe('PersonaMindspace — loading guard', () => {
  it('renders an empty shell when persona is undefined', async () => {
    state.persona = undefined;
    renderPage('p-loading');

    await waitFor(() => expect(screen.getByTestId('persona-mindspace')).toBeInTheDocument());
    expect(screen.queryByTestId('mindspace-picker-stub')).toBeNull();
  });
});

describe('PersonaMindspace — mindspace selection', () => {
  it('calls patch with the chosen mindspace id and its accent colour', async () => {
    state.persona = { ...BASE_PERSONA, mindspaceId: null };
    const user = userEvent.setup();
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-mindspace')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'select-ms-crimson' }));

    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith({
        mindspaceId: 'ms-crimson',
        colour: '#e05252',
      }),
    );
  });

  it('calls patch with mindspaceId null and the persona colour when user-default is chosen', async () => {
    state.persona = { ...BASE_PERSONA, mindspaceId: 'ms-crimson', colour: '#c9a84c' };
    const user = userEvent.setup();
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-mindspace')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'user-default' }));

    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith({
        mindspaceId: null,
        colour: '#c9a84c',
      }),
    );
  });
});

describe('PersonaMindspace — texture selection', () => {
  it('calls patch with the chosen texture', async () => {
    state.persona = { ...BASE_PERSONA };
    const user = userEvent.setup();
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-mindspace')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'texture-aurora' }));

    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ textureOverride: 'aurora' }));
  });
});
