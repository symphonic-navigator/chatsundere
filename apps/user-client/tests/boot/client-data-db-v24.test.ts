// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

/** Store definitions present at v23 (no store changes since voiceAudio in v21). */
const V23_STORES = {
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

/** Plant a v23 database containing a settings row WITHOUT the two auto-read-aloud
 *  fields. After reopening at head the v24 upgrade handler must backfill them. */
async function plantV23Database(): Promise<void> {
  const db = new Dexie('chatsundere_client_data');
  for (let v = 1; v <= 23; v++) db.version(v).stores(V23_STORES);
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
    ttsOffering: null,
    sttOffering: null,
    // autoReadAloud and voiceStopHintSeen deliberately absent
    createdAt: 1,
    updatedAt: 1,
  });

  db.close();
}

describe('client-data-db v24 (auto-read-aloud fields)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });

  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('opens at verno 26 on a fresh install', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(36);
  });

  it('seeds autoReadAloud=false and voiceStopHintSeen=false', async () => {
    await openClientDataDb();
    const row = await getClientDataDb().settings.get(1);
    expect(row?.autoReadAloud).toBe(false);
    expect(row?.voiceStopHintSeen).toBe(false);
  });

  it('on upgrade from v23: backfills both fields to false when absent', async () => {
    await plantV23Database();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();

    const db = getClientDataDb();
    expect(db.verno).toBe(36);

    const settings = await db.settings.get(1);
    expect(settings?.autoReadAloud).toBe(false);
    expect(settings?.voiceStopHintSeen).toBe(false);
  });

  it('preserves an explicit autoReadAloud=true across a re-open', async () => {
    await openClientDataDb();
    await getClientDataDb().settings.update(1, { autoReadAloud: true });
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();

    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.autoReadAloud).toBe(true);
    expect(settings?.voiceStopHintSeen).toBe(false);
  });
});
