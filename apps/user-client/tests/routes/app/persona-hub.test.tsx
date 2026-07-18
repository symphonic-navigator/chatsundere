// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PersonaHub } from '../../../src/routes/app/persona/hub.js';

// ── Shared stable data ───────────────────────────────────────────────────────

const COMPLETE_PERSONA = {
  id: 'p-complete',
  name: 'Sage',
  tagline: 'A wise guide',
  colour: '#c9a84c',
  font: 'serif' as const,
  instructions: 'Be a wise sage.',
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

const INCOMPLETE_PERSONA = {
  ...COMPLETE_PERSONA,
  id: 'p-incomplete',
  name: 'Ember',
  instructions: '', // empty → isPersonaIncomplete returns true
  canonicalId: null,
  providerId: '',
  modelId: '',
};

const RECENT_CHAT = {
  id: 'c-1',
  personaId: 'p-complete',
  title: null,
  resolvedMindspaceId: 'ms-default',
  createdAt: 1000,
  lastMessageAt: 2000,
  bookmarkedMessageCount: 0,
  draftInput: '',
  libraryIds: [] as string[],
};

// ── Mocks ────────────────────────────────────────────────────────────────────

// Model-picker overlay and import control are heavyweight — stub them so the
// hub renders without error.
vi.mock('../../../src/components/ModelSlotPicker.js', () => ({
  ModelSlotPicker: () => <div data-testid="model-slot-picker" />,
}));
vi.mock('../../../src/components/persona-editor/ChatsuneImportControl.js', () => ({
  ChatsuneImportControl: () => <div data-testid="chatsune-import-control" />,
}));

// AvatarField uses PersonaAvatar which needs a DB connection; stub it to a
// simple monogram fallback so the identity section renders without errors.
vi.mock('../../../src/components/persona-editor/AvatarField.js', () => ({
  AvatarField: ({ name }: { name: string }) => (
    <div data-testid="avatar-field">{name.slice(0, 2).toUpperCase()}</div>
  ),
}));

// The mindspace store is a Zustand singleton; side-effects from the update
// call are irrelevant for hub-level tests.
vi.mock('../../../src/state/mindspace.store.js', () => ({
  useMindspaceStore: (_sel: (s: { update: () => void }) => unknown) =>
    _sel({ update: () => undefined }),
}));

// Stub providers and settings so ModelSlotPicker prop drilling doesn't fail.
vi.mock('../../../src/data/providers.js', () => ({
  useProviders: () => ({ data: [] }),
}));
vi.mock('../../../src/data/settings.js', () => ({
  useSettings: () => ({
    data: { corsProxy: null, defaultMindspaceId: 'ms-1', userTexture: 'cloudy' },
  }),
}));
vi.mock('../../../src/data/mindspaces.js', () => ({
  useMindspaces: () => ({ data: [] }),
}));

// ── Per-test data stubs (persona + chats) are set up BELOW with vi.mock ─────

// We need persona + chats to be configurable per test suite.  The vi.mock
// calls at module level are hoisted, so we use a mutable object and reference
// it from within each mock factory.
const state = {
  persona: null as typeof COMPLETE_PERSONA | typeof INCOMPLETE_PERSONA | null | undefined,
  chats: [] as (typeof RECENT_CHAT)[],
};

vi.mock('../../../src/routes/app/persona/use-persona-editing.js', () => ({
  usePersonaEditing: (_id: string | null) => ({
    persona: state.persona,
    patch: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../../src/data/chats.js', () => ({
  useChats: () => ({ data: state.chats }),
}));

vi.mock('../../../src/data/persona-avatars.js', () => ({
  useSetPersonaAvatar: () => ({ mutateAsync: vi.fn() }),
  useRemovePersonaAvatar: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

vi.mock('../../../src/lib/avatar-normalise.js', () => ({
  normaliseAvatar: vi.fn(),
}));

vi.mock('../../../src/lib/usable-providers.js', () => ({
  usableTemplateIds: () => [] as string[],
}));

// ── Render helper ────────────────────────────────────────────────────────────

function renderHub(personaId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/app/persona/${personaId}`]}>
        <Routes>
          <Route path="/app/persona/:id" element={<PersonaHub />} />
          <Route path="/app/chat/:chatId" element={<div data-testid="chat-sentinel">chat</div>} />
          <Route path="/app/history" element={<div data-testid="history-sentinel">history</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PersonaHub — complete persona with a recent chat', () => {
  it('renders all 8 NavTiles', async () => {
    state.persona = COMPLETE_PERSONA;
    state.chats = [RECENT_CHAT];
    renderHub('p-complete');

    await waitFor(() => expect(screen.getByTestId('persona-hub')).toBeInTheDocument());

    const expectedLabels = [
      'Instructions',
      'Roleplay',
      'Model behaviour',
      'Integrations',
      'Knowledge',
      'Memory',
      'Font & Voice',
      'Mindspace',
    ];
    for (const label of expectedLabels) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('Continue button carries the gold marker (data-priority="true")', async () => {
    state.persona = COMPLETE_PERSONA;
    state.chats = [RECENT_CHAT];
    renderHub('p-complete');

    await waitFor(() => expect(screen.getByTestId('persona-hub')).toBeInTheDocument());

    const continueBtn = screen.getByRole('button', { name: /continue/i });
    expect(continueBtn.getAttribute('data-priority')).toBe('true');

    // New Chat must NOT be gold when there is already a recent chat.
    const newChatBtn = screen.getByRole('button', { name: /new chat/i });
    expect(newChatBtn.getAttribute('data-priority')).toBeNull();
  });

  it('no Delete control is present on the hub', async () => {
    state.persona = COMPLETE_PERSONA;
    state.chats = [RECENT_CHAT];
    renderHub('p-complete');

    await waitFor(() => expect(screen.getByTestId('persona-hub')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    expect(screen.queryByText(/delete persona/i)).toBeNull();
  });
});

describe('PersonaHub — complete persona with no recent chat', () => {
  it('New Chat carries the gold marker and Continue does not', async () => {
    state.persona = COMPLETE_PERSONA;
    state.chats = [];
    renderHub('p-complete');

    await waitFor(() => expect(screen.getByTestId('persona-hub')).toBeInTheDocument());

    const newChatBtn = screen.getByRole('button', { name: /new chat/i });
    expect(newChatBtn.getAttribute('data-priority')).toBe('true');

    const continueBtn = screen.getByRole('button', { name: /continue/i });
    expect(continueBtn.getAttribute('data-priority')).toBeNull();
  });
});

describe('PersonaHub — unknown persona', () => {
  it('renders the not-found notice with a back link to My Circle', async () => {
    state.persona = null;
    state.chats = [];
    renderHub('p-missing');

    await waitFor(() => expect(screen.getByTestId('persona-hub')).toBeInTheDocument());

    expect(screen.getByText(/persona not found/i)).toBeInTheDocument();
    const backLink = screen.getByRole('link', { name: /back to my circle/i });
    expect(backLink.getAttribute('href')).toBe('/app/circle');
  });
});

describe('PersonaHub — incomplete persona (empty instructions, no model)', () => {
  it('no action button carries the gold marker', async () => {
    state.persona = INCOMPLETE_PERSONA;
    state.chats = [];
    renderHub('p-incomplete');

    await waitFor(() => expect(screen.getByTestId('persona-hub')).toBeInTheDocument());

    const actionLabels = ['Continue', 'New Chat', 'New Incognito', 'History'];
    for (const name of actionLabels) {
      const btn = screen.getByRole('button', { name });
      expect(btn.getAttribute('data-priority')).toBeNull();
    }
  });

  it('renders the calm incomplete-persona sentence', async () => {
    state.persona = INCOMPLETE_PERSONA;
    state.chats = [];
    renderHub('p-incomplete');

    await waitFor(() => expect(screen.getByTestId('persona-hub')).toBeInTheDocument());

    expect(screen.getByText(/add an instruction and pick a model/i)).toBeInTheDocument();
  });

  it('Instructions tile shows "Needs setup" as its meta', async () => {
    state.persona = INCOMPLETE_PERSONA;
    state.chats = [];
    renderHub('p-incomplete');

    await waitFor(() => expect(screen.getByTestId('persona-hub')).toBeInTheDocument());

    // instructionsMeta returns 'Needs setup' when instructions are empty.
    expect(screen.getByText('Needs setup')).toBeInTheDocument();
  });
});

describe('PersonaHub — third-party chat import entry point', () => {
  it('offers the third-party chat import entry point', async () => {
    state.persona = COMPLETE_PERSONA;
    state.chats = [];
    renderHub('p-complete');

    await waitFor(() => expect(screen.getByTestId('persona-hub')).toBeInTheDocument());

    expect(
      await screen.findByText('Just the conversations — text and reasoning.'),
    ).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Import chats from ChatGPT or Grok…' });
    fireEvent.click(btn);
    expect(await screen.findByRole('dialog', { name: 'Import chats' })).toBeInTheDocument();
  });
});
