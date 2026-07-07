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
 * Cumulative store definitions as they stood at v32, before the WS-C sync
 * engine added its four tables in v33. Planting a raw Dexie at v32 lets the
 * real class's v33 upgrade run on open.
 */
const V32_STORES = {
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
} as const;

/** A pre-existing `updatedAt` deliberately far in the past, to prove it survives. */
const PRE_EXISTING_UPDATED_AT = 1_700_000_000_000;

/**
 * Plant a v32 database with one unstamped and one stamped row in each of the
 * four LWW-keyed collections. The unstamped rows lack `updatedAt`; the stamped
 * rows carry an explicit historic value the v33 upgrade must not overwrite.
 */
async function plantV32WithLwwRows(): Promise<void> {
  const db = new Dexie('chatsundere_client_data');
  for (let v = 1; v <= 32; v++) db.version(v).stores(V32_STORES);
  await db.open();

  await db.table('chats').bulkAdd([
    {
      id: 'chat-bare',
      personaId: 'p1',
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    },
    {
      id: 'chat-stamped',
      personaId: 'p1',
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
      updatedAt: PRE_EXISTING_UPDATED_AT,
    },
  ]);
  await db.table('messages').bulkAdd([
    {
      id: 'msg-bare',
      chatId: 'chat-bare',
      role: 'user',
      contentBlocks: [],
      createdAt: 1,
      bookmarked: false,
      streamingState: 'complete',
    },
    {
      id: 'msg-stamped',
      chatId: 'chat-bare',
      role: 'user',
      contentBlocks: [],
      createdAt: 1,
      bookmarked: false,
      streamingState: 'complete',
      updatedAt: PRE_EXISTING_UPDATED_AT,
    },
  ]);
  await db.table('mindspaces').bulkAdd([
    {
      id: 'ms-bare',
      displayName: 'Bare',
      palette: {},
      texture: 'plain',
      builtIn: false,
      createdAt: 1,
    },
    {
      id: 'ms-stamped',
      displayName: 'Stamped',
      palette: {},
      texture: 'plain',
      builtIn: false,
      createdAt: 1,
      updatedAt: PRE_EXISTING_UPDATED_AT,
    },
  ]);
  await db.table('attachments').bulkAdd([
    {
      id: 'att-bare',
      chatId: 'chat-bare',
      messageId: null,
      origin: 'upload',
      kind: 'text',
      fileName: 'a.txt',
      mime: 'text/plain',
      order: 0,
      state: 'active',
      createdAt: 1,
    },
    {
      id: 'att-stamped',
      chatId: 'chat-bare',
      messageId: null,
      origin: 'upload',
      kind: 'text',
      fileName: 'b.txt',
      mime: 'text/plain',
      order: 1,
      state: 'active',
      createdAt: 1,
      updatedAt: PRE_EXISTING_UPDATED_AT,
    },
  ]);

  db.close();
}

describe('client-data-db v33 — sync engine schema', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('opens at version 33 with the four sync tables on a fresh install', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(36);
    const names = db.tables.map((t) => t.name);
    expect(names).toContain('syncOutbox');
    expect(names).toContain('syncRows');
    expect(names).toContain('syncState');
    expect(names).toContain('trash');
  });

  it('stamps updatedAt on pre-existing rows lacking it and preserves existing stamps', async () => {
    await plantV32WithLwwRows();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();

    const db = getClientDataDb();
    expect(db.verno).toBe(36);

    // Unstamped rows gain a numeric updatedAt.
    for (const [table, id] of [
      ['chats', 'chat-bare'],
      ['messages', 'msg-bare'],
      ['mindspaces', 'ms-bare'],
      ['attachments', 'att-bare'],
    ] as const) {
      const row = await db.table(table).get(id);
      expect(typeof row?.updatedAt).toBe('number');
    }

    // Stamped rows keep their original value.
    for (const [table, id] of [
      ['chats', 'chat-stamped'],
      ['messages', 'msg-stamped'],
      ['mindspaces', 'ms-stamped'],
      ['attachments', 'att-stamped'],
    ] as const) {
      const row = await db.table(table).get(id);
      expect(row?.updatedAt).toBe(PRE_EXISTING_UPDATED_AT);
    }
  });
});
