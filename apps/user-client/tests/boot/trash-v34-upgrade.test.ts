// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

/**
 * Cumulative store definitions as they stood at v33 — the trash store carried
 * only `id, purgeAt` and there was no deadKeys store. Enough of the schema is
 * declared for a legacy open at v33 to succeed.
 */
const V33_STORES = {
  settings: 'id',
  providers: 'id, templateId, enabled',
  mindspaces: 'id, builtIn, displayName',
  personas: 'id, providerId',
  chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
  messages: 'id, chatId, [chatId+createdAt]',
  pills: 'id, messageId',
  personaAvatars: 'personaId',
  attachments: 'id, chatId, messageId, [chatId+messageId]',
  artefacts: 'id, chatId, personaId, favourite, [chatId+createdAt]',
  libraries: 'id, name, nsfw',
  documents: 'id, libraryId, embeddingStatus, [libraryId+createdAt]',
  mcpServers: 'id, createdAt',
  voiceAudio: 'key, lastUsedAt',
  memoryJournal: 'id, personaId, [personaId+state], [personaId+createdAt]',
  memoryBody: 'id, personaId, [personaId+version]',
  compactionCheckpoints: 'id, chatId, createdAt',
  seedTemplates: 'id, createdAt, nsfw',
  syncOutbox: '++seq, [collection+key]',
  syncRows: '[collection+key]',
  syncState: 'id',
  trash: 'id, purgeAt',
} as const;

/**
 * Plant a v33 database containing one legacy `chats` trash row whose snapshot
 * carries a `personaId` foreign key but none of the v34 grouping fields.
 */
async function plantV33WithLegacyTrash(): Promise<void> {
  const db = new Dexie('chatsundere_client_data');
  for (let v = 1; v <= 33; v++) db.version(v).stores(V33_STORES);
  await db.open();

  await db.table('trash').put({
    id: 'chats:c1',
    collection: 'chats',
    key: 'c1',
    row: { id: 'c1', personaId: 'p1', title: 'Legacy chat' },
    deletedAt: 111,
    purgeAt: 999,
    // entityKind / rootGroup / parentRef deliberately absent — v34 backfills them
  });

  db.close();
}

describe('client-data-db v34 — trash grouping metadata + deadKeys', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('opens at version 34 on a fresh install', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(36);
  });

  it('backfills grouping metadata onto legacy trash rows from the snapshot foreign key', async () => {
    await plantV33WithLegacyTrash();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();

    const db = getClientDataDb();
    expect(db.verno).toBe(36);

    const migrated = await db.trash.get('chats:c1');
    expect(migrated?.entityKind).toBe('chat');
    expect(migrated?.rootGroup).toBe('persona:p1');
    expect(migrated?.parentRef).toEqual({ field: 'personaId', id: 'p1' });
  });

  it('seeds a durable deadKeys marker from each existing trash row on upgrade', async () => {
    await plantV33WithLegacyTrash();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();

    const db = getClientDataDb();
    const dead = await db.deadKeys.get('chats:c1');
    expect(dead).toEqual({ id: 'chats:c1', collection: 'chats', key: 'c1', diedAt: 111 });
  });
});
