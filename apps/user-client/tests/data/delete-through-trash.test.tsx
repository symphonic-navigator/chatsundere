// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useDeleteChat } from '../../src/data/chats.js';
import { useStreamManagerStore } from '../../src/state/stream-manager.store.js';
import { toastStore, useToastStore } from '../../src/state/toast.store.js';

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

async function seedChat(chatId: string): Promise<void> {
  const db = await openClientDataDb();
  await db.chats.add({
    id: chatId,
    personaId: 'p1',
    title: null,
    resolvedMindspaceId: 'm1',
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  });
}

describe('useDeleteChat routes through the trashcan', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
    useStreamManagerStore.setState({ streams: new Map() });
    toastStore.clear();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
    toastStore.clear();
  });

  it('soft-deletes the chat and surfaces an Undo / Delete-permanently toast', async () => {
    const chatId = uuidv7();
    await seedChat(chatId);
    const db = getClientDataDb();

    const qc = new QueryClient();
    const { result } = renderHook(() => useDeleteChat(), { wrapper: wrapper(qc) });
    await act(async () => await result.current.mutateAsync(chatId));

    // Went through softDelete: a trash snapshot exists (NOT a hard delete).
    expect(await db.chats.get(chatId)).toBeUndefined();
    expect(await db.trash.get(`chats:${chatId}`)).toBeDefined();

    // The delete-time toast is surfaced with the exact copy + both actions.
    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBe(1);
    const toast = toasts[0];
    expect(toast?.message).toBe('Moved to Recently deleted · recoverable for 30 days');
    expect(toast?.action?.label).toBe('Undo');
    expect(toast?.secondaryAction?.label).toBe('Delete permanently');
  });

  it('Undo restores the chat at its original id and clears the snapshot', async () => {
    const chatId = uuidv7();
    await seedChat(chatId);
    const db = getClientDataDb();

    const qc = new QueryClient();
    const { result } = renderHook(() => useDeleteChat(), { wrapper: wrapper(qc) });
    await act(async () => await result.current.mutateAsync(chatId));

    const undo = useToastStore.getState().toasts[0]?.action;
    expect(undo).toBeDefined();
    await act(async () => {
      undo?.onClick();
      // Let the fire-and-forget restore task settle.
      await new Promise((r) => setTimeout(r, 0));
    });

    expect((await db.chats.get(chatId))?.personaId).toBe('p1');
    expect(await db.trash.get(`chats:${chatId}`)).toBeUndefined();
  });

  it('Delete permanently purges the snapshot and leaves the chat deleted', async () => {
    const chatId = uuidv7();
    await seedChat(chatId);
    const db = getClientDataDb();

    const qc = new QueryClient();
    const { result } = renderHook(() => useDeleteChat(), { wrapper: wrapper(qc) });
    await act(async () => await result.current.mutateAsync(chatId));

    const purge = useToastStore.getState().toasts[0]?.secondaryAction;
    expect(purge).toBeDefined();
    await act(async () => {
      purge?.onClick();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(await db.chats.get(chatId)).toBeUndefined();
    expect(await db.trash.get(`chats:${chatId}`)).toBeUndefined();
    expect(await db.trash.count()).toBe(0);
  });
});
