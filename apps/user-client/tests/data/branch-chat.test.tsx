// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useBranchChat } from '../../src/data/chats.js';

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
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
    title: 'Source',
    resolvedMindspaceId: 'm1',
    createdAt: 100,
    lastMessageAt: 300,
    bookmarkedMessageCount: 1,
    draftInput: 'half typed',
    libraryIds: [],
  });
  await db.messages.add({
    id: 'u1',
    chatId: 'c1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'question' }],
    createdAt: 100,
    bookmarked: true,
    streamingState: 'complete',
  });
  await db.messages.add({
    id: 'a1',
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [
      { type: 'text', text: 'answer ' },
      { type: 'pill', pillId: 'pl1' },
    ],
    createdAt: 200,
    bookmarked: false,
    streamingState: 'complete',
  });
  await db.messages.add({
    id: 'u2',
    chatId: 'c1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'later' }],
    createdAt: 300,
    bookmarked: false,
    streamingState: 'complete',
  });
  await db.pills.add({
    id: 'pl1',
    messageId: 'a1',
    kind: 'tool-call',
    positionHint: 'inline',
    status: 'completed',
    payload: { tool: 'search', args: { q: 'x' } },
    createdAt: 200,
  });
});

afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('useBranchChat', () => {
  it('forks at the branch point with fresh ids and remapped pill references', async () => {
    const { result } = renderHook(() => useBranchChat(), { wrapper });

    let newChatId = '';
    await waitFor(() => expect(result.current.mutateAsync).toBeDefined());
    newChatId = await result.current.mutateAsync({
      sourceChatId: 'c1',
      branchPointMessageId: 'a1',
      title: 'My branch',
    });

    const db = getClientDataDb();

    expect(newChatId).not.toBe('c1');
    const branch = await db.chats.get(newChatId);
    expect(branch).toBeTruthy();
    expect(branch?.title).toBe('My branch');
    expect(branch?.personaId).toBe('p1');
    expect(branch?.resolvedMindspaceId).toBe('m1');
    expect(branch?.draftInput).toBe('');
    expect(branch?.bookmarkedMessageCount).toBe(1);
    expect(branch?.lastMessageAt).toBe(200);

    const branchMsgs = await db.messages.where('chatId').equals(newChatId).sortBy('createdAt');
    expect(branchMsgs).toHaveLength(2);
    expect(branchMsgs.map((m) => m.id)).not.toContain('u1');
    expect(branchMsgs.map((m) => m.id)).not.toContain('a1');
    expect(branchMsgs.map((m) => m.createdAt)).toEqual([100, 200]);
    expect(
      branchMsgs.some((m) => m.contentBlocks.some((b) => b.type === 'text' && b.text === 'later')),
    ).toBe(false);

    const copiedPersona = branchMsgs.find((m) => m.role === 'persona');
    const pillBlock = copiedPersona?.contentBlocks.find((b) => b.type === 'pill') as
      | { type: 'pill'; pillId: string }
      | undefined;
    expect(pillBlock).toBeTruthy();
    expect(pillBlock?.pillId).not.toBe('pl1');
    const newPill = await db.pills.get(pillBlock?.pillId ?? '');
    expect(newPill).toBeTruthy();
    expect(newPill?.messageId).toBe(copiedPersona?.id);
    expect(newPill?.kind).toBe('tool-call');

    const srcMsgs = await db.messages.where('chatId').equals('c1').toArray();
    expect(srcMsgs).toHaveLength(3);
    const srcPill = await db.pills.get('pl1');
    expect(srcPill?.messageId).toBe('a1');
  });

  it('throws when the branch point does not exist', async () => {
    const { result } = renderHook(() => useBranchChat(), { wrapper });
    await waitFor(() => expect(result.current.mutateAsync).toBeDefined());
    await expect(
      result.current.mutateAsync({ sourceChatId: 'c1', branchPointMessageId: 'nope', title: 'X' }),
    ).rejects.toThrow();
  });

  it('throws when the source chat does not exist', async () => {
    const { result } = renderHook(() => useBranchChat(), { wrapper });
    await waitFor(() => expect(result.current.mutateAsync).toBeDefined());
    await expect(
      result.current.mutateAsync({ sourceChatId: 'ghost', branchPointMessageId: 'a1', title: 'X' }),
    ).rejects.toThrow();
  });

  it('copies an incomplete branch-point message verbatim (streamingState preserved)', async () => {
    const db = getClientDataDb();
    // Replace the persona message a1 with an incomplete one as the branch point.
    await db.messages.update('a1', { streamingState: 'incomplete' });

    const { result } = renderHook(() => useBranchChat(), { wrapper });
    await waitFor(() => expect(result.current.mutateAsync).toBeDefined());
    const newChatId = await result.current.mutateAsync({
      sourceChatId: 'c1',
      branchPointMessageId: 'a1',
      title: 'Incomplete branch',
    });

    const branchMsgs = await db.messages.where('chatId').equals(newChatId).sortBy('createdAt');
    const copiedPersona = branchMsgs.find((m) => m.role === 'persona');
    expect(copiedPersona?.streamingState).toBe('incomplete');
  });
});
