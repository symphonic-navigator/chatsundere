// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Stable reference objects prevent the infinite re-render loop: mock factories
// that return new object literals on every invocation cause the component's
// useMemo for seedDraft to see a changed dependency, which fires the useEffect
// and calls setDraft, which triggers another render — ad infinitum.
const STABLE_SETTINGS = { data: { defaultMindspaceId: 'a', userTexture: 'cloudy' as const } };
const STABLE_MINDSPACES = {
  data: [
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
  ],
};
const STABLE_PROVIDERS = { data: [{ id: 'pr-1', templateId: 'nano-gpt', enabled: true }] };
const STABLE_PROVIDER_DEF = {
  id: 'nano-gpt',
  displayName: 'nano-gpt.com',
  baseUrl: 'x',
  offerings: [],
};

vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: () => STABLE_PROVIDER_DEF,
  getCanonical: () => undefined,
  listCanonicals: () => [],
  listOfferings: () => [],
  availableCanonicals: () => ({ available: [], hiddenCount: 0 }),
  effectiveFreedom: () => 'free',
}));

vi.mock('../../src/data/personas.js', () => ({
  usePersona: () => ({ data: undefined }),
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

vi.mock('../../src/data/chats.js', () => ({
  useChats: () => ({ data: [] }),
}));

import { PersonaEditor } from '../../src/routes/app/persona-editor.js';

function setup(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/persona/:id" element={<PersonaEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PersonaEditor — Chatsundere tonality toggle', () => {
  it('defaults Chatsundere tonality to on for a new persona', async () => {
    setup('/app/persona/new');
    // The Behavior accordion is collapsed by default — open it first.
    const behaviourHeader = await screen.findByText(/^behavior$/i);
    fireEvent.click(behaviourHeader);
    const toggle = await screen.findByRole('button', { name: /chatsundere tonality/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});
