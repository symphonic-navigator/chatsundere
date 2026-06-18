// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

describe('ChatRow.importedFrom', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('round-trips a chat with importedFrom and queries by personaId', async () => {
    const db = getClientDataDb();
    await db.chats.add({
      id: 'c1',
      personaId: 'p1',
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
      importedFrom: 'chatsune-session-42',
    });
    const rows = await db.chats.where('personaId').equals('p1').toArray();
    expect(rows[0]?.importedFrom).toBe('chatsune-session-42');
  });
});
