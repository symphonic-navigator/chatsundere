// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

/** Store definitions present at v22 (no store changes since voiceAudio in v21). */
const V22_STORES = {
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

/** Plant a v22 database containing a settings row WITHOUT the two voice slot
 *  refs. After reopening at head the v23 upgrade handler must backfill them. */
async function plantV22Database(): Promise<void> {
  const db = new Dexie('chatsundere_client_data');
  for (let v = 1; v <= 22; v++) db.version(v).stores(V22_STORES);
  await db.open();

  await db.table('settings').add({
    id: 1,
    displayName: '',
    globalInstructions: '',
    globalAboutMe: '',
    defaultMindspaceId: 'ms-1',
    userTexture: 'cloudy',
    animationsEnabled: true,
    adultMode: 'nsfw',
    corsProxy: null,
    webInterfacing: { search: null, fetch: null },
    expertWeb: { search: null, fetch: null, searchTierId: null },
    substituteVisionModel: null,
    expertModel: null,
    imageGeneration: { primary: null, nsfw: null },
    voiceMode: 'paragraph',
    dictationSensitivity: 'medium',
    dictationRedemptionMs: 1_728,
    dictationAutoSend: false,
    // ttsOffering and sttOffering deliberately absent
    createdAt: 1,
    updatedAt: 1,
  });

  db.close();
}

describe('client-data-db v23 (voice offering slots)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });

  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('opens at current head verno on a fresh install', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(34);
  });

  it('seeds both voice slot refs as null on a fresh settings row', async () => {
    await openClientDataDb();
    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.ttsOffering).toBeNull();
    expect(settings?.sttOffering).toBeNull();
  });

  it('on upgrade from v22: backfills both refs to null when fields are absent', async () => {
    await plantV22Database();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();

    const db = getClientDataDb();
    expect(db.verno).toBe(34);

    const settings = await db.settings.get(1);
    expect(settings?.ttsOffering).toBeNull();
    expect(settings?.sttOffering).toBeNull();
  });

  it('preserves an explicit ttsOffering ref across a re-open', async () => {
    await openClientDataDb();
    await getClientDataDb().settings.update(1, { ttsOffering: 'xai:grok-tts' });
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();

    const settings = await getClientDataDb().settings.get(1);
    // an explicit string ref persists across reopen/seeding (the v23 upgrade
    // handler does not re-run once the database is already at verno 23)
    expect(settings?.ttsOffering).toBe('xai:grok-tts');
    expect(settings?.sttOffering).toBeNull();
  });
});
