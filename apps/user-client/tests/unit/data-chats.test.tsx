// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { uuidv7 } from 'uuidv7';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import {
  setChatLibraries,
  useChat,
  useCreateChat,
  useDeleteChat,
  useToggleBookmark,
  useUpdateChat,
} from '../../src/data/chats.js';
import { useStreamManagerStore } from '../../src/state/stream-manager.store.js';

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

async function seedPersonaWithMindspace() {
  const db = await openClientDataDb();
  const ms = await db.mindspaces.toArray();
  if (ms.length === 0) throw new Error('seeding mindspaces failed');
  const first = ms[0];
  if (!first) throw new Error('no mindspaces');
  const personaId = uuidv7();
  await db.personas.add({
    id: personaId,
    name: 'X',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: '',
    canonicalId: null,
    providerId: 'pr',
    modelId: 'm',
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
    roleplay: false,
    narration: 'first',
    greetingEnabled: false,
    greetingInstructions: '',
    createdAt: 1,
    updatedAt: 1,
  });
  return { db, personaId, mindspaceId: first.id };
}

describe('chat hooks', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
  });
  afterEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
  });

  it('useCreateChat snapshots resolvedMindspace from persona', async () => {
    const { db, personaId, mindspaceId } = await seedPersonaWithMindspace();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCreateChat(), { wrapper: wrapper(qc) });
    let chatId = '';
    await act(async () => {
      chatId = await result.current.mutateAsync({ personaId });
    });
    const row = await db.chats.get(chatId);
    expect(row?.resolvedMindspaceId).toBe(mindspaceId);
    expect(row?.draftInput).toBe('');
    expect(row?.title).toBeNull();
  });

  it('useChat returns null when chatId is null (enabled gate)', async () => {
    await openClientDataDb();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useChat(null), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeUndefined();
  });

  it('useChat returns chat + messages + pills for a chatId', async () => {
    const { db, personaId } = await seedPersonaWithMindspace();
    const chatId = uuidv7();
    await db.chats.add({
      id: chatId,
      personaId,
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    const messageId = uuidv7();
    await db.messages.add({
      id: messageId,
      chatId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'hi' }],
      createdAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useChat(chatId), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.data?.chat?.id).toBe(chatId));
    expect(result.current.data?.messages.length).toBe(1);
    expect(result.current.data?.pills).toEqual([]);
  });

  it('useUpdateChat writes a partial patch', async () => {
    const { personaId } = await seedPersonaWithMindspace();
    const db = await openClientDataDb();
    const chatId = uuidv7();
    await db.chats.add({
      id: chatId,
      personaId,
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useUpdateChat(), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({ id: chatId, patch: { draftInput: 'hello there' } });
    });
    const row = await db.chats.get(chatId);
    expect(row?.draftInput).toBe('hello there');
  });

  it('useToggleBookmark flips message + updates chat count', async () => {
    const { personaId } = await seedPersonaWithMindspace();
    const db = await openClientDataDb();
    const chatId = uuidv7();
    await db.chats.add({
      id: chatId,
      personaId,
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    const messageId = uuidv7();
    await db.messages.add({
      id: messageId,
      chatId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'hi' }],
      createdAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useToggleBookmark(), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync(messageId);
    });
    const m1 = await db.messages.get(messageId);
    const c1 = await db.chats.get(chatId);
    expect(m1?.bookmarked).toBe(true);
    expect(c1?.bookmarkedMessageCount).toBe(1);
    // toggle again
    await act(async () => {
      await result.current.mutateAsync(messageId);
    });
    const m2 = await db.messages.get(messageId);
    const c2 = await db.chats.get(chatId);
    expect(m2?.bookmarked).toBe(false);
    expect(c2?.bookmarkedMessageCount).toBe(0);
  });

  it('setChatLibraries writes libraryIds and invalidates the chat query', async () => {
    await _resetClientDataDbForTests({ keepData: false });
    const db = await openClientDataDb();
    await db.chats.add({
      id: 'c1',
      personaId: 'p1',
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    await setChatLibraries('c1', ['a', 'b']);
    expect((await db.chats.get('c1'))?.libraryIds).toEqual(['a', 'b']);
  });
});

describe('useDeleteChat', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
    // Reset the stream-manager between tests.
    useStreamManagerStore.setState({ streams: new Map() });
  });

  it('deletes the chat row, its messages, and their pills in one tx', async () => {
    const db = await openClientDataDb();
    const { personaId } = await seedPersonaWithMindspace();
    const qc = new QueryClient();
    const { result: createH } = renderHook(() => useCreateChat(), { wrapper: wrapper(qc) });
    const chatId = await act(async () => await createH.current.mutateAsync({ personaId }));

    const msgId = uuidv7();
    await db.messages.add({
      id: msgId,
      chatId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'hi' }],
      createdAt: 0,
      bookmarked: false,
      streamingState: 'complete',
    });
    await db.pills.add({
      id: uuidv7(),
      messageId: msgId,
      kind: 'tool-call',
      positionHint: 'inline',
      status: 'completed',
      payload: {},
      createdAt: 0,
    });

    const { result } = renderHook(() => useDeleteChat(), { wrapper: wrapper(qc) });
    await act(async () => await result.current.mutateAsync(chatId));

    expect(await db.chats.get(chatId)).toBeUndefined();
    expect(await db.messages.where('chatId').equals(chatId).count()).toBe(0);
    expect(await db.pills.where('messageId').equals(msgId).count()).toBe(0);
  });

  it('aborts a live stream for the chat before deleting', async () => {
    const { personaId } = await seedPersonaWithMindspace();
    const qc = new QueryClient();
    const { result: createH } = renderHook(() => useCreateChat(), { wrapper: wrapper(qc) });
    const chatId = await act(async () => await createH.current.mutateAsync({ personaId }));

    const abort = vi.fn();
    useStreamManagerStore.setState({
      streams: new Map([
        [
          chatId,
          {
            chatId,
            personaId,
            draftMessageId: uuidv7(),
            controller: { abort } as unknown as AbortController,
            status: 'streaming',
            contentBuffer: [],
            pillBuffer: [],
            startedAt: 0,
            reusedDraft: false,
          },
        ],
      ]),
    });

    const { result } = renderHook(() => useDeleteChat(), { wrapper: wrapper(qc) });
    await act(async () => await result.current.mutateAsync(chatId));

    expect(abort).toHaveBeenCalledTimes(1);
    expect(useStreamManagerStore.getState().streams.has(chatId)).toBe(false);
  });

  it('is a no-op for stream-abort when no live stream', async () => {
    const { personaId } = await seedPersonaWithMindspace();
    const qc = new QueryClient();
    const { result: createH } = renderHook(() => useCreateChat(), { wrapper: wrapper(qc) });
    const chatId = await act(async () => await createH.current.mutateAsync({ personaId }));
    const { result } = renderHook(() => useDeleteChat(), { wrapper: wrapper(qc) });
    // No live stream — should not throw.
    await act(async () => await result.current.mutateAsync(chatId));
    expect((await openClientDataDb()).chats.get(chatId)).resolves.toBeUndefined();
  });
});
