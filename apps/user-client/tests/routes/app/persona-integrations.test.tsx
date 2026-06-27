// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PersonaIntegrations } from '../../../src/routes/app/persona/integrations.js';

// ── Shared stable fixtures ─────────────────────────────────────────────────────

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

const MCP_SERVERS = [
  { id: 'srv-1', name: 'Web Search', onByDefault: true, enabled: true },
  { id: 'srv-2', name: 'Code Runner', onByDefault: false, enabled: true },
  { id: 'srv-3', name: 'Disabled Server', onByDefault: true, enabled: false },
];

// ── Mutable mock state (configurable per test) ────────────────────────────────

const state: {
  persona: typeof BASE_PERSONA | null | undefined;
  patch: ReturnType<typeof vi.fn>;
  mcpServers: typeof MCP_SERVERS | undefined;
} = {
  persona: BASE_PERSONA,
  patch: vi.fn().mockResolvedValue(undefined),
  mcpServers: MCP_SERVERS,
};

vi.mock('../../../src/routes/app/persona/use-persona-editing.js', () => ({
  usePersonaEditing: (_id: string | null) => ({
    persona: state.persona,
    patch: state.patch,
  }),
}));

vi.mock('../../../src/data/mcp-servers.js', () => ({
  useMcpServers: () => ({ data: state.mcpServers }),
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
      <MemoryRouter initialEntries={[`/app/persona/${personaId}/integrations`]}>
        <Routes>
          <Route path="/app/persona/:id/integrations" element={<PersonaIntegrations />} />
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

describe('PersonaIntegrations — not-found guard', () => {
  it('renders the not-found notice when persona is null', async () => {
    state.persona = null;
    renderPage('p-missing');

    await waitFor(() => expect(screen.getByTestId('persona-integrations')).toBeInTheDocument());
    expect(screen.getByText(/persona not found/i)).toBeInTheDocument();
  });
});

describe('PersonaIntegrations — loading guard', () => {
  it('renders an empty shell when persona is undefined', async () => {
    state.persona = undefined;
    renderPage('p-loading');

    await waitFor(() => expect(screen.getByTestId('persona-integrations')).toBeInTheDocument());
    // No MCP content while loading.
    expect(screen.queryByText(/web search/i)).toBeNull();
  });
});

describe('PersonaIntegrations — McpOverrideSection rendered', () => {
  it('renders enabled MCP servers and not disabled ones', async () => {
    state.persona = BASE_PERSONA;
    state.mcpServers = MCP_SERVERS;
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-integrations')).toBeInTheDocument());

    // Enabled servers appear.
    expect(screen.getByText('Web Search')).toBeInTheDocument();
    expect(screen.getByText('Code Runner')).toBeInTheDocument();

    // Disabled server must not appear.
    expect(screen.queryByText('Disabled Server')).toBeNull();
  });

  it('shows the empty-state message when no MCP servers are configured', async () => {
    state.persona = BASE_PERSONA;
    state.mcpServers = [];
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-integrations')).toBeInTheDocument());
    expect(screen.getByText(/no mcp servers configured/i)).toBeInTheDocument();
  });
});

describe('PersonaIntegrations — override interaction', () => {
  it('calls patch with updated mcpOverrides when an override button is clicked', async () => {
    state.persona = { ...BASE_PERSONA, mcpOverrides: {} };
    state.mcpServers = MCP_SERVERS;
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-integrations')).toBeInTheDocument());

    // Click the "Off" button for "Web Search".
    const offButton = screen.getByRole('button', { name: /web search off/i });
    fireEvent.click(offButton);

    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith({ mcpOverrides: { 'srv-1': 'off' } }),
    );
  });

  it('removes the override key when "Default" is selected', async () => {
    state.persona = { ...BASE_PERSONA, mcpOverrides: { 'srv-1': 'off' } };
    state.mcpServers = MCP_SERVERS;
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-integrations')).toBeInTheDocument());

    // Click "Default (on)" for "Web Search" to clear the override.
    const defaultButton = screen.getByRole('button', { name: /web search default/i });
    fireEvent.click(defaultButton);

    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ mcpOverrides: {} }));
  });
});
