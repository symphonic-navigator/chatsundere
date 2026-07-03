// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { applyActiveCompaction } from '../../src/compaction/apply.js';
import { writeCheckpoint } from '../../src/compaction/repo.js';

const msg = (id: string, createdAt: number) =>
  ({
    id,
    chatId: 'a1',
    role: 'user',
    contentBlocks: [],
    createdAt,
    bookmarked: false,
    streamingState: 'complete',
  }) as never;

describe('applyActiveCompaction', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('returns inputs unchanged when there is no active checkpoint', async () => {
    await openClientDataDb();
    const chat = { id: 'noop', activeCompactionId: null } as never;
    const prior = [msg('x', 1)];
    const out = await applyActiveCompaction(chat, prior, '<usermemory/>');
    expect(out.priorMessages).toBe(prior);
    expect(out.memoryContext).toBe('<usermemory/>');
  });

  it('slices to the tail and injects the compact block', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    await db.chats.add({
      id: 'a1',
      personaId: 'p',
      title: null,
      resolvedMindspaceId: 'm',
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    await writeCheckpoint({
      id: 'cp',
      chatId: 'a1',
      createdAt: 1,
      modelId: 'm',
      summaryMarkdown: 'BRIEFING',
      lastMessageIdBefore: 'm2',
      tailStartMessageId: 'm3',
      tokensBefore: 1,
      tokensAfter: 1,
      tailTokenCount: 1,
      prevCheckpointId: null,
      trigger: 'manual',
    });
    const chat = await db.chats.get('a1');
    if (!chat) throw new Error('chat missing');
    const prior = [msg('m1', 1), msg('m2', 2), msg('m3', 3), msg('m4', 4)];
    const out = await applyActiveCompaction(chat, prior, '<usermemory/>');
    expect(out.priorMessages.map((m) => m.id)).toEqual(['m3', 'm4']);
    expect(out.memoryContext).toContain('<conversation_compact>');
    expect(out.memoryContext).toContain('BRIEFING');
    expect(out.memoryContext).toContain('<usermemory/>');
  });
});
