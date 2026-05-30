// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

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
const STABLE_PROVIDERS = {
  data: [{ id: 'pv1', templateId: 'nano-gpt', enabled: true } as never],
};
const PERSONA_DATA = {
  data: {
    id: 'p1',
    name: 'Aurum',
    tagline: 't',
    colour: '#c9a84c',
    font: 'serif' as const,
    instructions: 'be aurum',
    canonicalId: 'glm-5.1',
    providerId: 'pv1',
    modelId: 'm1',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    createdAt: 0,
    updatedAt: 0,
  },
};

const mutateAsync = vi.fn();

vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: () => ({
    id: 'p',
    displayName: 'P',
    baseUrl: 'x',
    offerings: [],
  }),
  getCanonical: () => ({ id: 'glm-5.1', displayName: 'GLM 5.1' }),
  listCanonicals: () => [],
  listOfferings: () => [],
}));

vi.mock('../../src/data/personas.js', () => ({
  usePersona: () => PERSONA_DATA,
  useCreatePersona: () => ({ mutateAsync: vi.fn() }),
  useUpdatePersona: () => ({ mutateAsync }),
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

function setup(initialPath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/app/persona/:id" element={<PersonaEditor />} />
          <Route path="/app/circle" element={<div data-testid="circle-sentinel">circle</div>} />
          <Route path="/app/chat/:chatId" element={<div data-testid="chat-sentinel">chat</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PersonaEditor — return-URL honour', () => {
  it('back arrow defaults to /app/circle when no ?return= query is set', () => {
    setup('/app/persona/p1');
    fireEvent.click(screen.getByLabelText(/back/i));
    expect(screen.getByTestId('circle-sentinel')).toBeInTheDocument();
  });

  it('back arrow honours ?return= when set', () => {
    setup('/app/persona/p1?return=/app/chat/c1');
    fireEvent.click(screen.getByLabelText(/back/i));
    expect(screen.getByTestId('chat-sentinel')).toBeInTheDocument();
  });

  it('Save & Back navigates to the return URL', async () => {
    mutateAsync.mockResolvedValueOnce(undefined);
    setup('/app/persona/p1?return=/app/chat/c1');
    fireEvent.change(screen.getByLabelText('Tagline'), { target: { value: 'changed' } });
    const saveBtn = screen.getByRole('button', { name: /save & back/i });
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(screen.getByTestId('chat-sentinel')).toBeInTheDocument();
    });
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });
});
