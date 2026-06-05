// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
// Configured providers, mutable per test. Default: one enabled provider whose
// templateId is 'chutes' — this makes the chutes offerings available in the
// two-level picker. `setup()` reads the live array so a test may swap it before
// rendering (e.g. to a provider that covers fewer canonicals).
const CHUTES_PROVIDER = { id: 'pr-chutes', templateId: 'chutes', enabled: true };
let providerRows: Array<{ id: string; templateId: string; enabled: boolean }> = [CHUTES_PROVIDER];

// The catalogue (`@chatsundere/llm-unified`) is intentionally NOT mocked — its
// functions are pure (no I/O), so the picker runs against the real canonicals
// and offerings.

// Persona returned by `usePersona`. null = create-mode. Tests that need a
// preselected canonical (e.g. the stale-model row, or an expanded deployment
// list) populate this before rendering in edit-mode.
// biome-ignore lint/suspicious/noExplicitAny: minimal test mock shape
let mockPersona: any = null;

vi.mock('../../src/data/personas.js', () => ({
  usePersona: () => ({ data: mockPersona }),
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
  useProviders: () => ({ data: providerRows }),
}));

import { PersonaEditor } from '../../src/routes/app/persona-editor.js';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/persona/new']}>
        <Routes>
          <Route path="/app/persona/:id" element={<PersonaEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Edit-mode render — the route carries a concrete id, so the editor seeds its
// draft from `mockPersona` (via the mocked `usePersona`), giving the picker a
// `selectedCanonicalId` to react to.
function setupEdit() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/persona/p1']}>
        <Routes>
          <Route path="/app/persona/:id" element={<PersonaEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A fully-shaped persona row whose model is `canonicalId`. */
function personaWithModel(canonicalId: string) {
  return {
    id: 'p1',
    name: 'Existing',
    tagline: '',
    colour: '#c9a84c',
    font: 'serif' as const,
    instructions: 'Be kind',
    canonicalId,
    providerId: '',
    modelId: '',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('PersonaEditor — two-level canonical-first model picker', () => {
  beforeEach(() => {
    providerRows = [CHUTES_PROVIDER];
    mockPersona = null;
  });

  it('does not render a custom model input', () => {
    setup();
    // Open the Model accordion so its contents are rendered.
    fireEvent.click(screen.getByText(/^model$/i));
    expect(screen.queryByPlaceholderText(/custom model id/i)).toBeNull();
  });

  it('renders the GLM 5.1 canonical model exactly once', () => {
    setup();
    // Open the Model accordion so its contents are rendered.
    fireEvent.click(screen.getByText(/^model$/i));
    expect(screen.getAllByText('GLM 5.1')).toHaveLength(1);
  });

  it('reveals offerings with the configured TEE deployment selectable when a canonical is chosen', () => {
    setup();
    fireEvent.click(screen.getByText(/^model$/i));
    fireEvent.click(screen.getByText('GLM 5.1'));
    // Stage 2 appears, and the configured chutes (TEE) deployment is selectable.
    // Match the deployment button (name begins "Chutes …"), not the meta button
    // ("GLM 5.1 · via Chutes").
    expect(screen.getByText('Deployment')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Chutes/i })).toBeEnabled();
  });

  it('hides unconfigured-provider deployments entirely (no disabled CTA rows)', () => {
    // New contract: the deployment sub-list is configured-only. GLM 5.1 is also
    // offered by nano-gpt, but with only chutes configured that row is gone —
    // no disabled button and no "add … to use this deployment" CTA.
    setup();
    fireEvent.click(screen.getByText(/^model$/i));
    fireEvent.click(screen.getByText('GLM 5.1'));
    expect(screen.queryByText(/add .+ to use this deployment/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /nano-gpt/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^Chutes/i })).toBeEnabled();
  });
});

describe('PersonaEditor — configured-only model list', () => {
  beforeEach(() => {
    // Guard against any prior render lingering in the shared document.
    cleanup();
    providerRows = [CHUTES_PROVIDER];
  });

  it('lists only canonicals with a configured offering and hides the rest behind a footer', () => {
    // Mistral only offers the Mistral Large 3 canonical, so configuring it
    // surfaces exactly that model and hides the other six.
    providerRows = [{ id: 'pr-mistral', templateId: 'mistral', enabled: true }];
    setup();
    fireEvent.click(screen.getByText(/^model$/i));

    expect(screen.getByText('Mistral Large 3')).toBeInTheDocument();
    expect(screen.queryByText('GLM 5.1')).not.toBeInTheDocument();
    // The footer is a button; match it by role to avoid its nested text nodes.
    expect(screen.getByRole('button', { name: /more model/i })).toBeInTheDocument();
  });

  it('counts only configured providers for a canonical', () => {
    // Mistral Large 3 is offered by several providers, but only mistral is
    // configured, so its row counts a single provider. Scope the assertion to
    // that canonical's own row, since the other Mistral models also read
    // "1 provider".
    providerRows = [{ id: 'pr-mistral', templateId: 'mistral', enabled: true }];
    setup();
    fireEvent.click(screen.getByText(/^model$/i));

    const row = screen.getByText('Mistral Large 3').closest('button');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('1 provider')).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText('2 providers')).toBeNull();
  });
});

describe('PersonaEditor — model-picker extras', () => {
  beforeEach(() => {
    cleanup();
    providerRows = [CHUTES_PROVIDER];
    mockPersona = null;
  });

  it("shows a persona's now-unavailable model as a Currently unavailable row", () => {
    // The persona points at Mistral Large 3, but no Mistral provider is
    // configured (only Chutes), so the model is absent from `available`. The
    // registry still resolves it, and its sole offering names a provider for the
    // constructive next step.
    mockPersona = personaWithModel('mistral-large-3');
    providerRows = [CHUTES_PROVIDER];
    setupEdit();
    fireEvent.click(screen.getByText(/^model$/i));

    expect(screen.getByText(/currently unavailable/i)).toBeInTheDocument();
    // The next step names the provider the user could add to regain the model.
    expect(screen.getByText(/add Mistral/i)).toBeInTheDocument();
  });

  it('shows an EU jurisdiction badge for an EU offering', () => {
    // Mistral Large 3 via the configured Mistral provider is EU-jurisdiction.
    mockPersona = personaWithModel('mistral-large-3');
    providerRows = [{ id: 'pr-mistral', templateId: 'mistral', enabled: true }];
    setupEdit();
    fireEvent.click(screen.getByText(/^model$/i));

    // The selected canonical's deployment list is expanded; its EU offering
    // surfaces a jurisdiction badge in the Mistral deployment row.
    const deployment = screen.getByRole('button', { name: /^Mistral AI/ });
    expect(within(deployment).getByText('EU')).toBeInTheDocument();
  });

  it('shows Tools and Vision hints for a reachable offering', () => {
    // Mistral Large 3 supports tool calls and vision; both hints render on its
    // reachable (configured) deployment row.
    mockPersona = personaWithModel('mistral-large-3');
    providerRows = [{ id: 'pr-mistral', templateId: 'mistral', enabled: true }];
    setupEdit();
    fireEvent.click(screen.getByText(/^model$/i));

    const deployment = screen.getByRole('button', { name: /^Mistral AI/ });
    expect(within(deployment).getByText('Tools')).toBeInTheDocument();
    expect(within(deployment).getByText('Vision')).toBeInTheDocument();
  });
});
