// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useEditAndReplace } from '../../src/data/message-edit.js';
import * as sendMessage from '../../src/data/send-message.js';
import { queryClient } from '../../src/lib/queryClient.js';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(async () => {
  await openClientDataDb();
  const db = getClientDataDb();
  await db.messages.clear();
  await db.chats.clear();
  await db.chats.add({
    id: 'c1',
    personaId: 'p1',
    title: 'T',
    resolvedMindspaceId: 'm1',
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 3,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
    editingMessageId: 'u1',
  });
  await db.messages.bulkAdd([
    {
      id: 'u1',
      chatId: 'c1',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'orig' }],
      createdAt: 1,
      updatedAt: 1,
      bookmarked: false,
      streamingState: 'complete',
    },
    {
      id: 'p1m',
      chatId: 'c1',
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'reply' }],
      createdAt: 2,
      updatedAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    },
  ]);
});
afterEach(async () => {
  await _resetClientDataDbForTests();
  vi.restoreAllMocks();
});

describe('useEditAndReplace', () => {
  it('writes edited text, clears editingMessageId, and triggers regenerate', async () => {
    const regenerate = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(sendMessage, 'useRegenerate').mockReturnValue({ mutateAsync: regenerate } as never);

    const { result } = renderHook(() => useEditAndReplace(), { wrapper });
    await result.current.mutateAsync({
      chatId: 'c1',
      messageId: 'u1',
      text: 'edited',
      stagedRemovals: [],
      reasoning: { kind: 'off' },
    });

    const db = getClientDataDb();
    const u1 = await db.messages.get('u1');
    expect(u1?.contentBlocks).toEqual([{ type: 'text', text: 'edited' }]);
    expect(u1?.updatedAt).toBeGreaterThan(1);
    expect((await db.chats.get('c1'))?.editingMessageId).toBeNull();
    // The following persona reply (p1m) is pinned as the explicit regenerate
    // target so an incomplete/failed trailing reply is still reset (spec §6.1).
    await waitFor(() =>
      expect(regenerate).toHaveBeenCalledWith({
        chatId: 'c1',
        reasoning: { kind: 'off' },
        targetMessageId: 'p1m',
      }),
    );
  });
});
