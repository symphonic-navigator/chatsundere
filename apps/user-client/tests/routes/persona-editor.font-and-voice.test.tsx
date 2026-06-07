// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

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
  useSettings: () => ({ data: { defaultMindspaceId: 'a', userTexture: 'cloudy' } }),
}));

vi.mock('../../src/data/mindspaces.js', () => ({
  useMindspaces: () => ({
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
        texture: 'cloudy',
        builtIn: true,
        createdAt: 0,
      },
    ],
  }),
}));

vi.mock('../../src/data/providers.js', () => ({
  useProviders: () => ({ data: [] }),
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

describe('PersonaEditor — Font and Voice section', () => {
  it('renders a Font and Voice accordion between Behavior and Mindspace-Override', () => {
    setup();
    const headers = Array.from(
      document.querySelectorAll('[data-accordion-card] [data-accordion-label]'),
    ).map((n) => n.textContent?.trim() ?? '');
    expect(headers).toEqual([
      'Custom Instructions',
      'Model',
      'Behavior',
      'Font and Voice',
      'Mindspace — Override',
      'About Me — Override',
      'Knowledge',
    ]);
  });

  it('Mindspace-Override accordion no longer shows a Font row', () => {
    setup();
    fireEvent.click(screen.getByText(/mindspace — override/i));
    const ms = screen.getByText(/mindspace — override/i).closest('[data-accordion-card]');
    expect(ms?.querySelector('[data-mindspace-preview]')).not.toBeNull();
    const fontRowInMs = Array.from(ms?.querySelectorAll('span') ?? []).filter(
      (s) => s.textContent === 'Font',
    );
    expect(fontRowInMs.length).toBe(0);
  });
});
