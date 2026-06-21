// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  getActiveCheckpoint,
  listCheckpoints,
  markCompactionToastShown,
  writeCheckpoint,
} from '../../src/compaction/repo.js';

const cp = (id: string, chatId: string, prev: string | null) => ({
  id,
  chatId,
  createdAt: Date.now(),
  modelId: 'm',
  summaryMarkdown: '## Topic & Goal\n_(none)_',
  lastMessageIdBefore: 'a',
  tailStartMessageId: 'b',
  tokensBefore: 100,
  tokensAfter: 10,
  tailTokenCount: 20,
  prevCheckpointId: prev,
  trigger: 'manual' as const,
});

describe('compaction repo', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('writeCheckpoint stores the row and points the chat at it', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    await db.chats.add({
      id: 'c1',
      personaId: 'p1',
      title: null,
      resolvedMindspaceId: 'm',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    await writeCheckpoint(cp('cp1', 'c1', null));
    const chat = await db.chats.get('c1');
    expect(chat?.activeCompactionId).toBe('cp1');
    if (!chat) throw new Error('chat missing');
    const active = await getActiveCheckpoint(chat);
    expect(active?.id).toBe('cp1');
  });

  it('listCheckpoints returns all checkpoints for a chat, oldest first', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    await db.chats.add({
      id: 'c2',
      personaId: 'p1',
      title: null,
      resolvedMindspaceId: 'm',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    await writeCheckpoint(cp('cp2', 'c2', null));
    await writeCheckpoint(cp('cp3', 'c2', 'cp2'));
    const all = await listCheckpoints('c2');
    expect(all.map((c) => c.id)).toEqual(['cp2', 'cp3']);
  });

  it('markCompactionToastShown sets the flag', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    await db.chats.add({
      id: 'c3',
      personaId: 'p1',
      title: null,
      resolvedMindspaceId: 'm',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    await markCompactionToastShown('c3');
    expect((await db.chats.get('c3'))?.compactionToastShown).toBe(true);
  });
});
