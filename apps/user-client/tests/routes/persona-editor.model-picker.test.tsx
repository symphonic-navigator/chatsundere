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
// One enabled configured provider whose templateId is 'chutes' — this makes
// the chutes offerings available in the two-level picker.
const STABLE_PROVIDERS = { data: [{ id: 'pr-chutes', templateId: 'chutes', enabled: true }] };

// The catalogue (`@chatsundere/llm-unified`) is intentionally NOT mocked — its
// functions are pure (no I/O), so the picker runs against the real canonicals
// and offerings.

vi.mock('../../src/data/personas.js', () => ({
  usePersona: () => ({ data: null }),
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

describe('PersonaEditor — two-level canonical-first model picker', () => {
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

  it('shows unconfigured-provider deployments disabled with a CTA', () => {
    setup();
    fireEvent.click(screen.getByText(/^model$/i));
    fireEvent.click(screen.getByText('GLM 5.1'));
    // GLM 5.1 is also offered by providers the user has not configured.
    expect(screen.getAllByText(/add .+ to use this deployment/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /nano-gpt/i })).toBeDisabled();
  });
});
