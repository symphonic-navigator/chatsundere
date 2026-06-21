// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  countUnextractedUserMessages,
  listBodyVersions,
  rollbackBody,
  saveBody,
} from '../../src/memory/repo.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('repo UI extensions', () => {
  it('listBodyVersions returns all versions newest-first', async () => {
    await saveBody('p1', 'v1', 1, 'dream');
    await saveBody('p1', 'v2', 2, 'manual');
    const versions = await listBodyVersions('p1');
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it('rollbackBody re-saves an older version as the new newest', async () => {
    await saveBody('p1', 'old content', 1, 'dream');
    await saveBody('p1', 'new content', 2, 'manual');
    const rolled = await rollbackBody('p1', 1);
    expect(rolled.version).toBe(3);
    expect(rolled.content).toBe('old content');
    expect(rolled.source).toBe('manual');
  });

  it('countUnextractedUserMessages counts complete user messages after the cursor', async () => {
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
      lastExtractedMessageId: 'a',
    });
    await db.messages.bulkAdd([
      {
        id: 'a',
        chatId: 'c1',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'x' }],
        createdAt: 1,
        bookmarked: false,
        streamingState: 'complete',
      },
      {
        id: 'b',
        chatId: 'c1',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'y' }],
        createdAt: 2,
        bookmarked: false,
        streamingState: 'complete',
      },
      {
        id: 'c',
        chatId: 'c1',
        role: 'persona',
        contentBlocks: [{ type: 'text', text: 'z' }],
        createdAt: 3,
        bookmarked: false,
        streamingState: 'complete',
      },
    ] as never);
    expect(await countUnextractedUserMessages('c1')).toBe(1); // only 'b' (user, after cursor 'a')
  });
});
