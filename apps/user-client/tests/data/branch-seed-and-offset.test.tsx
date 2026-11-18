// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type MessageRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useBranchChat } from '../../src/data/chats.js';
import { useEditAndBranch } from '../../src/data/message-edit.js';
import * as sendMessage from '../../src/data/send-message.js';
import { isContextMessage } from '../../src/lib/content-blocks.js';
import { resolveOpenerContext } from '../../src/lib/stream-engine.js';

// Both branch paths copy an explicit field list. A seeded chat's greeting is
// only wire-excluded and echoed while it keeps `seedRole: 'greeting'`, and a
// user turn's stamp is only byte-stable while it keeps `utcOffsetMinutes`.

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function row(partial: Partial<MessageRow> & Pick<MessageRow, 'id' | 'role' | 'createdAt'>) {
  return {
    chatId: 'c1',
    contentBlocks: [{ type: 'text' as const, text: partial.id }],
    updatedAt: partial.createdAt,
    bookmarked: false,
    streamingState: 'complete' as const,
    ...partial,
  };
}

beforeEach(async () => {
  await openClientDataDb();
  const db = getClientDataDb();
  await db.pills.clear();
  await db.messages.clear();
  await db.chats.clear();
  await db.chats.add({
    id: 'c1',
    personaId: 'p1',
    title: 'Seeded',
    resolvedMindspaceId: 'm1',
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 6,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  });
  await db.messages.bulkAdd([
    row({ id: 'greet', role: 'persona', createdAt: 1, kind: 'seed', seedRole: 'greeting' }),
    row({ id: 'sb-u', role: 'user', createdAt: 2, kind: 'seed', seedRole: 'body' }),
    row({ id: 'sb-p', role: 'persona', createdAt: 3, kind: 'seed', seedRole: 'body' }),
    row({ id: 'u1', role: 'user', createdAt: 4, utcOffsetMinutes: 345 }),
    row({ id: 'a1', role: 'persona', createdAt: 5 }),
    row({ id: 'u2', role: 'user', createdAt: 6, utcOffsetMinutes: -300 }),
  ]);
});

afterEach(async () => {
  await _resetClientDataDbForTests();
  vi.restoreAllMocks();
});

async function expectSeedAndOffsetKept(newChatId: string): Promise<void> {
  const db = getClientDataDb();
  const source = await db.messages.where('chatId').equals('c1').sortBy('createdAt');
  const branched = await db.messages.where('chatId').equals(newChatId).sortBy('createdAt');

  const greeting = branched.find((m) => m.createdAt === 1);
  expect(greeting?.seedRole).toBe('greeting');
  expect(greeting && isContextMessage(greeting)).toBe(false);
  expect(resolveOpenerContext(branched, 'chat')).toBe(resolveOpenerContext(source, 'chat'));
  expect(resolveOpenerContext(branched, 'chat')).toBe('greet');
  expect(branched.find((m) => m.createdAt === 2)?.seedRole).toBe('body');
  expect(branched.find((m) => m.createdAt === 3)?.seedRole).toBe('body');
  expect(branched.find((m) => m.createdAt === 4)?.utcOffsetMinutes).toBe(345);
}

describe('branch paths keep seedRole and utcOffsetMinutes', () => {
  it('useBranchChat', async () => {
    const { result } = renderHook(() => useBranchChat(), { wrapper });
    await waitFor(() => expect(result.current.mutateAsync).toBeDefined());
    const newChatId = await result.current.mutateAsync({
      sourceChatId: 'c1',
      branchPointMessageId: 'u2',
      title: 'Branch',
    });
    await expectSeedAndOffsetKept(newChatId);
    const db = getClientDataDb();
    const branched = await db.messages.where('chatId').equals(newChatId).sortBy('createdAt');
    expect(branched.find((m) => m.createdAt === 6)?.utcOffsetMinutes).toBe(-300);
  });

  it('the edit-branch path', async () => {
    const send = vi.fn().mockResolvedValue('ignored');
    vi.spyOn(sendMessage, 'useSendMessage').mockReturnValue({ mutateAsync: send } as never);
    const { result } = renderHook(() => useEditAndBranch(), { wrapper });
    await waitFor(() => expect(result.current.mutateAsync).toBeDefined());
    const newChatId = await result.current.mutateAsync({
      sourceChatId: 'c1',
      personaId: 'p1',
      editingMessageId: 'u2',
      text: 'edited',
      stagedRemovals: [],
      reasoning: { kind: 'off' },
    });
    await expectSeedAndOffsetKept(newChatId);
  });
});
