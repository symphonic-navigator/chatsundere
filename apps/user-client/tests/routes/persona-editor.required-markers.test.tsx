// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Stable reference objects prevent the infinite re-render loop that arises when
// mock factories return new object literals on each invocation: the component's
// useMemo for seedDraft sees a changed dependency and the useEffect resets the
// draft, which triggers another render, ad infinitum.
const STABLE_SETTINGS = {
  data: { defaultMindspaceId: 'a', userTexture: 'cloudy' as const },
};
const STABLE_MINDSPACE = {
  id: 'a',
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
};
const STABLE_MINDSPACES = { data: [STABLE_MINDSPACE] };
const STABLE_PROVIDERS = { data: [] as never[] };

vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: () => ({ id: 'p', displayName: 'P', baseUrl: 'x', offerings: [] }),
  getCanonical: () => undefined,
  listCanonicals: () => [],
  listOfferings: () => [],
}));

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

describe('PersonaEditor — required-field markers', () => {
  it('renders Identity outside any accordion', () => {
    setup();
    const name = screen.getByLabelText('Name');
    expect(name.closest('[data-accordion-card]')).toBeNull();
  });

  it('shows the inline ✕ marker next to Name while it is empty', () => {
    setup();
    const marker = screen.getByLabelText(/name is required/i);
    expect(marker).toBeInTheDocument();
  });

  it('removes the inline marker once Name has content', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Liz' } });
    expect(screen.queryByLabelText(/name is required/i)).toBeNull();
  });

  it('shows the header ✕ marker on the Custom Instructions accordion when empty', () => {
    setup();
    const ci = screen.getByText(/custom instructions/i).closest('[data-accordion-card]');
    expect(ci?.querySelector('[aria-label="Custom Instructions is required"]')).not.toBeNull();
  });

  it('places Model in the Identity section, outside any accordion', () => {
    setup();
    const model = screen.getByText('Model');
    expect(model.closest('[data-accordion-card]')).toBeNull();
  });

  it('shows the inline ✕ marker next to Model while no model is selected', () => {
    setup();
    expect(screen.getByLabelText(/model is required/i)).toBeInTheDocument();
  });

  it('orders accordion sections as Custom Instructions → Behavior → Font and Voice → Mindspace → About-Me-Override → Knowledge', () => {
    setup();
    const headers = Array.from(
      document.querySelectorAll('[data-accordion-card] [data-accordion-label]'),
    ).map((n) => n.textContent?.trim() ?? '');
    expect(headers).toEqual([
      'Custom Instructions',
      'Behavior',
      'Font and Voice',
      'Mindspace — Override',
      'About Me — Override',
      'Knowledge',
    ]);
  });
});
