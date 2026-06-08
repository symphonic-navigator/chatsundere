// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { ChatPage } from '../../src/routes/app/chat/chat-page';
import { useCurrentChatStore } from '../../src/state/current-chat.store';

function makeWrapper(qc: QueryClient, initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/app/chat/new" element={children} />
          <Route path="/app/chat/:chatId" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Wrapper that also includes the /app/history route so navigation to it can be detected. */
function makeWrapperWithHistory(qc: QueryClient, initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/app/chat/new" element={children} />
          <Route path="/app/chat/:chatId" element={children} />
          <Route path="/app/history" element={<div data-testid="history-page">History</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Seeds a persona with a resolved mindspace. Mirrors the helper in data-chats.test.tsx. */
async function seedPersonaWithMindspace() {
  const db = await openClientDataDb();
  const ms = await db.mindspaces.toArray();
  if (ms.length === 0) throw new Error('seeding mindspaces failed');
  const first = ms[0];
  if (!first) throw new Error('no mindspaces');
  const personaId = uuidv7();
  await db.personas.add({
    id: personaId,
    name: 'Aurum',
    tagline: '',
    colour: '#c9a84c',
    font: 'serif',
    instructions: 'Test persona.',
    canonicalId: null,
    providerId: 'pr',
    modelId: 'deepseek/deepseek-v4-flash',
    mindspaceId: first.id,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
    createdAt: 1,
    updatedAt: 1,
  });
  return { db, personaId, mindspaceId: first.id };
}

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  useCurrentChatStore.getState().reset();
});

afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  vi.restoreAllMocks();
});

describe('ChatPage', () => {
  it('lazy mode renders PersonaGreeting + auto-opens Interaction Mode with pinned cockpit', async () => {
    const db = await openClientDataDb();
    const personaId = uuidv7();
    await db.personas.add({
      id: personaId,
      name: 'Aurum',
      tagline: '',
      colour: '#c9a84c',
      font: 'serif',
      instructions: '',
      canonicalId: null,
      providerId: 'pr',
      modelId: 'deepseek/deepseek-v4-flash',
      mindspaceId: null,
      aboutMeOverride: null,
      textureOverride: null,
      temperature: 0.85,
      adultPersona: false,
      chatsundereTonality: true,
      contextWindow: null,
      libraryIds: [],
      askExpertDefault: false,
      mcpOverrides: {},
      createdAt: 1,
      updatedAt: 1,
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<ChatPage />, {
      wrapper: makeWrapper(qc, `/app/chat/new?personaId=${personaId}`),
    });
    await waitFor(() => expect(container.querySelector('.persona-greeting')).not.toBeNull());
    expect(container.querySelector('.persona-greeting')?.textContent).toContain('Aurum');
    expect(useCurrentChatStore.getState().isInteractionMode).toBe(true);
    expect(useCurrentChatStore.getState().isPinned).toBe(true);
  });

  it('navigates to /app/history when a previously-mounted chat is deleted', async () => {
    const { db, personaId } = await seedPersonaWithMindspace();
    const chatId = uuidv7();
    const ms = await db.mindspaces.toArray();
    const firstMs = ms[0];
    if (!firstMs) throw new Error('No mindspace seeded');
    await db.chats.add({
      id: chatId,
      personaId,
      title: 'Stale',
      resolvedMindspaceId: firstMs.id,
      createdAt: 0,
      lastMessageAt: 0,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { getByTestId, queryByTestId } = render(<ChatPage />, {
      wrapper: makeWrapperWithHistory(qc, `/app/chat/${chatId}`),
    });

    // Initially the history page should not be visible — the chat exists.
    // Wait briefly for the query to settle, then verify we haven't navigated yet.
    await waitFor(() => expect(queryByTestId('history-page')).toBeNull());

    // Delete the chat row and invalidate so the query re-fetches and resolves to null.
    await act(async () => {
      await db.chats.delete(chatId);
      await qc.invalidateQueries({ queryKey: ['chats', chatId] });
    });

    // The stale-chat guard should fire and navigate to /app/history.
    await waitFor(() => expect(getByTestId('history-page')).not.toBeNull());
  });

  it('renames a chat through the topbar inline-edit', async () => {
    const { db, personaId } = await seedPersonaWithMindspace();
    const chatId = uuidv7();
    const ms = await db.mindspaces.toArray();
    const firstMs = ms[0];
    if (!firstMs) throw new Error('No mindspace seeded');

    // Seed a provider so modelQuery can resolve deepseek/deepseek-v4-flash.
    await db.providers.add({
      id: 'pr',
      templateId: 'novita',
      displayName: 'Test Provider',
      baseUrl: 'https://api.example.com',
      apiKey: { version: 1, ciphertext: new Uint8Array(0), nonce: new Uint8Array(0) },
      routing: { kind: 'direct' },
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    });

    await db.chats.add({
      id: chatId,
      personaId,
      title: null,
      resolvedMindspaceId: firstMs.id,
      createdAt: 0,
      lastMessageAt: 0,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    // Open the cockpit so InteractionMode renders.
    useCurrentChatStore.getState().setInteractionMode(true);
    // Pin so the mode stays open and doesn't close on outside-tap.
    if (!useCurrentChatStore.getState().isPinned) useCurrentChatStore.getState().togglePin();

    const { getByLabelText, container } = render(<ChatPage />, {
      wrapper: makeWrapper(qc, `/app/chat/${chatId}`),
    });

    // Wait for the topbar rename button to appear (requires model to resolve).
    await waitFor(() => expect(getByLabelText('Rename chat')).not.toBeNull());

    // Click the title button to enter edit mode.
    await act(async () => {
      fireEvent.click(getByLabelText('Rename chat'));
    });

    // The rename button is replaced by an input — select it directly by class.
    const input = container.querySelector<HTMLInputElement>('.topbar-title-input');
    if (!input) throw new Error('topbar-title-input not found after clicking Rename chat');

    // Type a new title and press Enter.
    await act(async () => {
      fireEvent.change(input, { target: { value: 'My New Title' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });

    // Wait for the mutation to persist to IndexedDB.
    await waitFor(async () => {
      const row = await db.chats.get(chatId);
      expect(row?.title).toBe('My New Title');
    });
  });

  it('chat-mode loads messages and renders them', async () => {
    const db = await openClientDataDb();
    const personaId = uuidv7();
    await db.personas.add({
      id: personaId,
      name: 'Aurum',
      tagline: '',
      colour: '#c9a84c',
      font: 'serif',
      instructions: '',
      canonicalId: null,
      providerId: 'pr',
      modelId: 'deepseek/deepseek-v4-flash',
      mindspaceId: null,
      aboutMeOverride: null,
      textureOverride: null,
      temperature: 0.85,
      adultPersona: false,
      chatsundereTonality: true,
      contextWindow: null,
      libraryIds: [],
      askExpertDefault: false,
      mcpOverrides: {},
      createdAt: 1,
      updatedAt: 1,
    });
    const chatId = uuidv7();
    const ms = await db.mindspaces.toArray();
    const firstMs = ms[0];
    if (!firstMs) throw new Error('No mindspace seeded — openClientDataDb should always seed one');
    await db.chats.add({
      id: chatId,
      personaId,
      title: null,
      resolvedMindspaceId: firstMs.id,
      createdAt: 1,
      lastMessageAt: 2,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    await db.messages.add({
      id: uuidv7(),
      chatId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'hello' }],
      createdAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<ChatPage />, {
      wrapper: makeWrapper(qc, `/app/chat/${chatId}`),
    });
    await waitFor(() => {
      expect(container.querySelector('.msg.from-user')).not.toBeNull();
    });
    expect(container.querySelector('.msg-text')?.textContent).toContain('hello');
  });
});

describe('ChatPage cleanup', () => {
  it('clears useCurrentChatStore.chatId on unmount', async () => {
    const { db, personaId, mindspaceId } = await seedPersonaWithMindspace();
    const chatId = uuidv7();
    await db.chats.add({
      id: chatId,
      personaId,
      title: 'Seeded',
      resolvedMindspaceId: mindspaceId,
      createdAt: 0,
      lastMessageAt: 0,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = makeWrapper(qc, `/app/chat/${chatId}`);
    const { unmount } = render(<ChatPage />, { wrapper });

    await waitFor(() => {
      expect(useCurrentChatStore.getState().chatId).toBe(chatId);
    });

    unmount();
    expect(useCurrentChatStore.getState().chatId).toBeNull();
  });
});
