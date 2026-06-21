// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  addJournalEntries,
  advanceCursor,
  archiveCommitted,
  commitOldestUncommitted,
  countJournal,
  getCurrentBody,
  getUnextractedUserText,
  listJournal,
  loadMemoryContext,
  saveBody,
} from '../../src/memory/repo.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('memory repo', () => {
  it('adds uncommitted entries and counts by state', async () => {
    await addJournalEntries('p1', [
      { content: 'A', category: 'fact', isCorrection: false },
      { content: 'B', category: null, isCorrection: true },
    ]);
    expect(await countJournal('p1', 'uncommitted')).toBe(2);
    const rows = await listJournal('p1', 'uncommitted');
    expect(rows[0]?.state).toBe('uncommitted');
    expect(rows[1]?.isCorrection).toBe(true);
  });

  it('commitOldestUncommitted promotes oldest, keeps the recent window', async () => {
    for (let i = 0; i < 7; i++) {
      await addJournalEntries('p1', [{ content: `e${i}`, category: null, isCorrection: false }]);
    }
    const committed = await commitOldestUncommitted('p1', 5);
    expect(committed).toBe(2);
    expect(await countJournal('p1', 'committed')).toBe(2);
    expect(await countJournal('p1', 'uncommitted')).toBe(5);
  });

  it('saveBody versions and getCurrentBody returns the latest', async () => {
    await saveBody('p1', 'first', 3, 'dream');
    const second = await saveBody('p1', 'second', 4, 'manual');
    expect(second.version).toBe(2);
    expect((await getCurrentBody('p1'))?.content).toBe('second');
  });

  it('archiveCommitted moves committed → archived with a dream id', async () => {
    await addJournalEntries('p1', [{ content: 'x', category: null, isCorrection: false }]);
    await commitOldestUncommitted('p1', 0);
    const n = await archiveCommitted('p1', 'dream-1');
    expect(n).toBe(1);
    expect(await countJournal('p1', 'archived')).toBe(1);
  });

  it('getUnextractedUserText returns user text after the cursor and a new cursor', async () => {
    const db = getClientDataDb();
    await db.chats.add({
      id: 'c1',
      personaId: 'p1',
      title: null,
      resolvedMindspaceId: 'ms',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    await db.messages.bulkAdd([
      {
        id: 'a',
        chatId: 'c1',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'hello' }],
        createdAt: 1,
        bookmarked: false,
        streamingState: 'complete',
      },
      {
        id: 'b',
        chatId: 'c1',
        role: 'persona',
        contentBlocks: [{ type: 'text', text: 'hi' }],
        createdAt: 2,
        bookmarked: false,
        streamingState: 'complete',
      },
      {
        id: 'c',
        chatId: 'c1',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'world' }],
        createdAt: 3,
        bookmarked: false,
        streamingState: 'complete',
      },
    ]);
    const { texts, newCursor } = await getUnextractedUserText('c1', 'a', 20);
    expect(texts).toEqual(['world']);
    expect(newCursor).toBe('c');
    await advanceCursor('c1', 'c');
    expect((await db.chats.get('c1'))?.lastExtractedMessageId).toBe('c');
  });

  it('loadMemoryContext assembles the block from body + journal', async () => {
    await saveBody('p1', 'Likes tea.', 1, 'dream');
    await addJournalEntries('p1', [
      { content: 'pending fact', category: null, isCorrection: false },
    ]);
    const ctx = await loadMemoryContext('p1');
    expect(ctx).toContain('Likes tea.');
    expect(ctx).toContain('- [pending] pending fact');
  });
});
