import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';

describe('client-data-db v6 migration', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
  });
  afterEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
  });

  it('backfills draftInput="" on existing chats', async () => {
    // Plant a v5 DB with a chat row missing draftInput
    const planted = new Dexie('chatsundere_client_data');
    planted.version(5).stores({
      settings: 'id',
      providers: 'id, templateId, enabled',
      mindspaces: 'id, builtIn, displayName',
      personas: 'id, providerId',
      chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
      messages: 'id, chatId, [chatId+createdAt]',
      pills: 'id, messageId',
    });
    await planted.open();
    await planted.table('chats').add({
      id: 'c1',
      personaId: 'p1',
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
    });
    planted.close();

    const db = await openClientDataDb();
    const row = (await db.chats.get('c1')) as { draftInput?: string } | undefined;
    expect(row?.draftInput).toBe('');
  });

  it('fresh install starts with no chats (draftInput field is contract for new rows)', async () => {
    const db = await openClientDataDb();
    expect((await db.chats.toArray()).length).toBe(0);
  });
});
