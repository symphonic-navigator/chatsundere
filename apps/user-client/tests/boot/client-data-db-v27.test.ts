// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

/** Store definitions present at v26 (no store changes since voiceAudio in v21). */
const V26_STORES = {
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
} as const;

async function plantV26WithPersonaAndChat(): Promise<void> {
  const db = new Dexie('chatsundere_client_data');
  for (let v = 1; v <= 26; v++) db.version(v).stores(V26_STORES);
  await db.open();
  await db.table('personas').add({ id: 'p1', name: 'P', providerId: 'pr1' });
  await db.table('chats').add({ id: 'c1', personaId: 'p1', lastMessageAt: 1 });
  db.close();
}

describe('client-data-db v27 (memory tables + persona/chat fields)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('opens at verno 27 on a fresh install with the two memory tables', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(36);
    await expect(db.memoryJournal.count()).resolves.toBe(0);
    await expect(db.memoryBody.count()).resolves.toBe(0);
  });

  it('on upgrade from v26: backfills persona + chat memory fields', async () => {
    await plantV26WithPersonaAndChat();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(36);
    const persona = await db.personas.get('p1');
    expect(persona?.useMemory).toBe(true);
    expect(persona?.memoryInstructions).toBe('');
    expect(persona?.lastViewedMemoryBodyVersion).toBe(0);
    expect(persona?.memoryIntroShown).toBe(false);
    const chat = await db.chats.get('c1');
    expect(chat?.lastExtractedMessageId).toBeNull();
  });
});
