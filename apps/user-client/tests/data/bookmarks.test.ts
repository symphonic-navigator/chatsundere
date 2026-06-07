// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { bookmarkGroups, setBookmarkLabel } from '../../src/data/bookmarks.js';

beforeEach(async () => {
  await openClientDataDb();
  const db = getClientDataDb();
  await db.messages.clear();
  await db.chats.clear();
  await db.chats.add({
    id: 'c1',
    personaId: 'p1',
    title: 'Chat one',
    resolvedMindspaceId: 'm1',
    createdAt: 10,
    lastMessageAt: 30,
    bookmarkedMessageCount: 1,
    draftInput: '',
    libraryIds: [],
  });
  await db.messages.bulkAdd([
    {
      id: 'u1',
      chatId: 'c1',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'first' }],
      createdAt: 11,
      bookmarked: false,
      streamingState: 'complete',
    },
    {
      id: 'u2',
      chatId: 'c1',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'starred one' }],
      createdAt: 12,
      bookmarked: true,
      streamingState: 'complete',
    },
  ]);
});

afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('setBookmarkLabel', () => {
  it('writes a custom label and can clear it back to null', async () => {
    await setBookmarkLabel({ messageId: 'u2', label: 'Important' });
    expect((await getClientDataDb().messages.get('u2'))?.bookmarkLabel).toBe('Important');
    await setBookmarkLabel({ messageId: 'u2', label: null });
    expect((await getClientDataDb().messages.get('u2'))?.bookmarkLabel).toBe(null);
  });
});

describe('bookmarkGroups', () => {
  it('returns only starred messages, grouped by chat, label-resolved', async () => {
    const groups = await bookmarkGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.chat.id).toBe('c1');
    expect(groups[0]?.bookmarks.map((b) => b.message.id)).toEqual(['u2']);
    expect(groups[0]?.bookmarks[0]?.label).toBe('starred one');
  });

  it('reflects a custom label', async () => {
    await setBookmarkLabel({ messageId: 'u2', label: 'My pin' });
    const groups = await bookmarkGroups();
    expect(groups[0]?.bookmarks[0]?.label).toBe('My pin');
  });
});
