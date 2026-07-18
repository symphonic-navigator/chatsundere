// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useEditAndBranch } from '../../src/data/message-edit.js';
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
    lastMessageAt: 4,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: ['lib1'],
    editingMessageId: 'u2',
  });
  await db.messages.bulkAdd([
    {
      id: 'u1',
      chatId: 'c1',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'first' }],
      createdAt: 1,
      updatedAt: 1,
      bookmarked: false,
      streamingState: 'complete',
    },
    {
      id: 'p1m',
      chatId: 'c1',
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'r1' }],
      createdAt: 2,
      updatedAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    },
    {
      id: 'u2',
      chatId: 'c1',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'second' }],
      createdAt: 3,
      updatedAt: 3,
      bookmarked: false,
      streamingState: 'complete',
    },
    {
      id: 'p2m',
      chatId: 'c1',
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'r2' }],
      createdAt: 4,
      updatedAt: 4,
      bookmarked: false,
      streamingState: 'complete',
    },
  ]);
});
afterEach(async () => {
  await _resetClientDataDbForTests();
  vi.restoreAllMocks();
});

describe('useEditAndBranch', () => {
  it('copies prior messages (exclusive of the edited one) and re-sends into the new chat', async () => {
    const send = vi.fn().mockResolvedValue('ignored');
    vi.spyOn(sendMessage, 'useSendMessage').mockReturnValue({ mutateAsync: send } as never);

    const { result } = renderHook(() => useEditAndBranch(), { wrapper });
    const newChatId = await result.current.mutateAsync({
      sourceChatId: 'c1',
      personaId: 'p1',
      editingMessageId: 'u2',
      text: 'second edited',
      stagedRemovals: [],
      reasoning: { kind: 'off' },
    });

    const db = getClientDataDb();
    // New chat exists, auto-titled (null), copies libraryIds.
    const branched = await db.chats.get(newChatId);
    expect(branched?.title).toBeNull();
    expect(branched?.libraryIds).toEqual(['lib1']);
    // Copied messages are u1 + p1m only (everything before u2). u2/p2m NOT copied.
    const copied = await db.messages.where('chatId').equals(newChatId).sortBy('createdAt');
    expect(copied.map((m) => m.contentBlocks)).toEqual([
      [{ type: 'text', text: 'first' }],
      [{ type: 'text', text: 'r1' }],
    ]);
    // The edited message is re-issued as a normal send into the new chat.
    expect(send).toHaveBeenCalledWith({
      chatId: newChatId,
      personaId: 'p1',
      text: 'second edited',
      reasoning: { kind: 'off' },
    });
    // Source edit marker cleared.
    expect((await db.chats.get('c1'))?.editingMessageId).toBeNull();
    // Source chat is untouched (still 4 messages).
    expect(await db.messages.where('chatId').equals('c1').count()).toBe(4);
  });

  it('invalidates caches even when the re-send throws (onSettled, not onSuccess)', async () => {
    const send = vi.fn().mockRejectedValue(new Error('network down'));
    vi.spyOn(sendMessage, 'useSendMessage').mockReturnValue({ mutateAsync: send } as never);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useEditAndBranch(), { wrapper });
    await expect(
      result.current.mutateAsync({
        sourceChatId: 'c1',
        personaId: 'p1',
        editingMessageId: 'u2',
        text: 'second edited',
        stagedRemovals: [],
        reasoning: { kind: 'off' },
      }),
    ).rejects.toThrow('network down');

    // The branch copy (a local DB write) must still have happened before the throw...
    const db = getClientDataDb();
    const branchedChats = await db.chats.where('personaId').equals('p1').toArray();
    expect(branchedChats.some((c) => c.id !== 'c1')).toBe(true);
    // ...and the caches must still be invalidated despite the mutation rejecting.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['chats'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['attachments', 'pending'] });
  });
});
