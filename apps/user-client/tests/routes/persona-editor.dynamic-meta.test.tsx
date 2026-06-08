// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Stable reference objects prevent the infinite re-render loop: mock factories
// that return new object literals on every invocation cause the component's
// useMemo for seedDraft to see a changed dependency, which fires the useEffect
// and calls setDraft, which triggers another render — ad infinitum.
const STABLE_PERSONA = {
  data: {
    id: 'p-1',
    name: 'Liz',
    tagline: 't',
    colour: '#c9a84c',
    font: 'serif' as const,
    instructions: 'i',
    canonicalId: 'glm-5.1',
    providerId: 'pr-1',
    modelId: 'llama-3.1-70b',
    mindspaceId: 'a',
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: true,
    createdAt: 0,
    updatedAt: 0,
  },
};
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
  getCanonical: (id: string) =>
    id === 'glm-5.1' ? { id: 'glm-5.1', displayName: 'GLM 5.1' } : undefined,
  listCanonicals: () => [],
  listOfferings: () => [],
  getOffering: () => undefined,
  availableCanonicals: () => ({ available: [], hiddenCount: 0 }),
  effectiveFreedom: () => 'free',
}));

vi.mock('../../src/data/personas.js', () => ({
  usePersona: () => STABLE_PERSONA,
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

describe('PersonaEditor — dynamic accordion meta', () => {
  it('Behavior meta shows an NSFW badge when adultPersona is true', () => {
    setup('/app/persona/p-1');
    const header = screen.getByText(/^behavior$/i).closest('[data-accordion-card]');
    expect(header?.querySelector('[data-nsfw-badge]')).not.toBeNull();
  });

  it('Mindspace-Override meta shows displayName · texture when set', () => {
    setup('/app/persona/p-1');
    const header = screen.getByText(/^mindspace — override$/i).closest('[data-accordion-card]');
    expect(header?.textContent).toMatch(/Aurum.*cloudy/i);
  });
});
