// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { Circle } from '../../src/routes/app/circle.js';

// Minimal persona fields shared by all seeds in this file.
const BASE_PERSONA = {
  tagline: '',
  colour: '#c9a84c',
  font: 'serif' as const,
  instructions: 'be present',
  canonicalId: null,
  providerId: 'prov-enabled',
  modelId: 'm',
  mindspaceId: null,
  aboutMeOverride: null,
  textureOverride: null,
  temperature: 0.85,
  adultPersona: false,
  chatsundereTonality: true,
  contextWindow: null,
  libraryIds: [] as string[],
  askExpertDefault: false,
  mcpOverrides: {} as Record<string, never>,
  roleplay: false,
  narration: 'first' as const,
  greetingEnabled: false,
  greetingInstructions: '',
  voice: null,
  narratorVoice: null,
};

function renderCircle(initialEntry = '/app/circle') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/app/circle" element={<Circle />} />
          <Route path="/app/persona/new" element={<div data-testid="persona-new" />} />
          <Route path="/app/persona/:id" element={<div data-testid="persona-hub" />} />
          <Route path="/app/chat/:id" element={<div data-testid="chat" />} />
          <Route path="/app/chat/new" element={<div data-testid="chat-new" />} />
          <Route
            path="/app/settings/providers"
            element={<div data-testid="providers-settings" />}
          />
          <Route path="/app" element={<div data-testid="entrance" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Seeds an enabled provider so enabledProviderIds contains 'prov-enabled'. */
async function seedProvider() {
  const db = getClientDataDb();
  const now = Date.now();
  await db.providers.add({
    id: 'prov-enabled',
    templateId: 't',
    displayName: 'TestProvider',
    baseUrl: '',
    apiKey: { version: 1, nonce: new Uint8Array(12), ciphertext: new Uint8Array(16) },
    routing: { kind: 'direct' },
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
}

describe('Circle route', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders the no-leak empty state when no personas exist', async () => {
    renderCircle();
    await waitFor(() => {
      expect(screen.getByText(/no personas yet/i)).toBeInTheDocument();
    });
    // Empty-state must not hint at hidden personas.
    expect(screen.queryByText(/hidden/i)).toBeNull();
  });

  it('navigates to /app/persona/new on the "New persona" button', async () => {
    renderCircle();
    fireEvent.click(await screen.findByRole('button', { name: /new persona/i }));
    await waitFor(() => expect(screen.getByTestId('persona-new')).toBeInTheDocument());
  });

  it('shows "Continue" and navigates to the existing chat', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await seedProvider();
    const personaId = uuidv7();
    const chatId = uuidv7();
    await db.personas.add({
      id: personaId,
      name: 'Aurum',
      ...BASE_PERSONA,
      createdAt: now,
      updatedAt: now,
    });
    const mindspaces = await db.mindspaces.toArray();
    await db.chats.add({
      id: chatId,
      personaId,
      title: 'first chat',
      resolvedMindspaceId: mindspaces[0]?.id ?? '',
      createdAt: now,
      lastMessageAt: now,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });

    renderCircle();
    const btn = await screen.findByRole('button', { name: 'Continue' });
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId('chat')).toBeInTheDocument());
  });

  it('shows "New Chat" when no prior chat exists and navigates to new-chat', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await seedProvider();
    await db.personas.add({
      id: uuidv7(),
      name: 'Sage',
      ...BASE_PERSONA,
      createdAt: now,
      updatedAt: now,
    });

    renderCircle();
    const btn = await screen.findByRole('button', { name: 'New Chat' });
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId('chat-new')).toBeInTheDocument());
  });

  it('disables the chat button and shows "Provider missing" when the provider is absent', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    // No provider seeded — providerId will not appear in enabledProviderIds.
    await db.personas.add({
      id: uuidv7(),
      name: 'Orphan',
      ...BASE_PERSONA,
      providerId: 'non-existent',
      createdAt: now,
      updatedAt: now,
    });

    renderCircle();
    await screen.findByText('Orphan');

    // Chat button is disabled.
    const chatBtn = screen.getByRole('button', { name: 'New Chat' });
    expect(chatBtn).toBeDisabled();

    // Provider-missing cue is visible and navigates to providers settings.
    const cue = screen.getByText(/provider missing/i);
    expect(cue).toBeInTheDocument();
    fireEvent.click(cue);
    await waitFor(() => expect(screen.getByTestId('providers-settings')).toBeInTheDocument());
  });

  it('overflow menu contains divided groups, a disabled "New incognito chat", and a destructive "Delete…"', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await db.personas.add({
      id: uuidv7(),
      name: 'Vera',
      ...BASE_PERSONA,
      createdAt: now,
      updatedAt: now,
    });

    const { container } = renderCircle();
    await screen.findByText('Vera');

    // Open the overflow menu.
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));

    // "New incognito chat" is present and aria-disabled.
    const incognito = await screen.findByRole('menuitem', { name: /new incognito chat/i });
    expect(incognito).toHaveAttribute('aria-disabled', 'true');

    // "Delete…" is present.
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument();

    // Both groups are present: verify items from each side of the divider.
    expect(screen.getByRole('menuitem', { name: /new chat/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /go to persona/i })).toBeInTheDocument();
  });

  it('confirming delete removes the persona row and shows the empty state', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await db.personas.add({
      id: uuidv7(),
      name: 'Blink',
      ...BASE_PERSONA,
      createdAt: now,
      updatedAt: now,
    });

    renderCircle();
    await screen.findByText('Blink');

    // Open overflow and click Delete….
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete/i }));

    // ConfirmDialog appears with the persona name in the title.
    await screen.findByText(/delete blink\?/i);

    // Confirm deletion.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    // Row disappears and the empty state replaces it.
    await waitFor(() => expect(screen.queryByText('Blink')).toBeNull());
    expect(screen.getByText(/no personas yet/i)).toBeInTheDocument();
  });

  it('tapping the row body navigates to the persona hub', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await db.personas.add({
      id: uuidv7(),
      name: 'Rowan',
      ...BASE_PERSONA,
      createdAt: now,
      updatedAt: now,
    });

    renderCircle();
    await screen.findByText('Rowan');

    // The cs-row-main button is the row body (data-circle-row marks the outer div).
    const rowBody = document.querySelector('[data-circle-row] .cs-row-main') as HTMLButtonElement;
    fireEvent.click(rowBody);

    await waitFor(() => expect(screen.getByTestId('persona-hub')).toBeInTheDocument());
  });
});
