// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { uuidv7 } from 'uuidv7';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { ChatPage } from '../../src/routes/app/chat/chat-page';
import { useCurrentChatStore } from '../../src/state/current-chat.store';
import { useStreamManagerStore } from '../../src/state/stream-manager.store';

function makeWrapper(qc: QueryClient, initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/app/chat/:chatId" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  useStreamManagerStore.setState({ streams: new Map() });
  useCurrentChatStore.getState().reset();
});

afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  vi.restoreAllMocks();
});

/** Seed a minimal persona + chat + messages, return chatId. */
async function seedChat(opts: { lastStreamingState: 'incomplete' | 'complete' }): Promise<string> {
  const db = await openClientDataDb();
  const personaId = uuidv7();
  await db.personas.add({
    id: personaId,
    name: 'X',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: 'inst',
    canonicalId: null,
    providerId: 'pr',
    modelId: 'deepseek/deepseek-v4-flash',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    chatsundereTonality: true,
    createdAt: 1,
    updatedAt: 1,
  });
  const ms = await db.mindspaces.toArray();
  const chatId = uuidv7();
  await db.chats.add({
    id: chatId,
    personaId,
    title: null,
    resolvedMindspaceId: ms[0]?.id ?? '',
    createdAt: 1,
    lastMessageAt: 3,
    bookmarkedMessageCount: 0,
    draftInput: '',
  });
  await db.messages.add({
    id: uuidv7(),
    chatId,
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'hi' }],
    createdAt: 2,
    bookmarked: false,
    streamingState: 'complete',
  });
  await db.messages.add({
    id: uuidv7(),
    chatId,
    role: 'persona',
    contentBlocks: opts.lastStreamingState === 'complete' ? [{ type: 'text', text: 'fine' }] : [],
    createdAt: 3,
    bookmarked: false,
    streamingState: opts.lastStreamingState,
  });
  return chatId;
}

describe('Recovery footer integration', () => {
  it('renders footer when last persona-msg is incomplete', async () => {
    const chatId = await seedChat({ lastStreamingState: 'incomplete' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<ChatPage />, {
      wrapper: makeWrapper(qc, `/app/chat/${chatId}`),
    });
    await waitFor(() => expect(container.querySelector('.stream-interrupted')).not.toBeNull());
  });

  it('does NOT render footer when last persona-msg is complete', async () => {
    const chatId = await seedChat({ lastStreamingState: 'complete' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<ChatPage />, {
      wrapper: makeWrapper(qc, `/app/chat/${chatId}`),
    });
    await waitFor(() => expect(container.querySelector('.chat-page')).not.toBeNull());
    expect(container.querySelector('.stream-interrupted')).toBeNull();
  });
});
