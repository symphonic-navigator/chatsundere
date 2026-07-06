// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

/** Store definitions present at v21 (voiceAudio added in v21). */
const V21_STORES = {
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

/** Plant a v21 database containing a settings row WITHOUT the three dictation
 *  fields. After reopening at head the v22 upgrade handler must backfill them. */
async function plantV21Database(): Promise<void> {
  const db = new Dexie('chatsundere_client_data');
  for (let v = 1; v <= 21; v++) db.version(v).stores(V21_STORES);
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
    // dictationSensitivity, dictationRedemptionMs, dictationAutoSend deliberately absent
    createdAt: 1,
    updatedAt: 1,
  });

  db.close();
}

/** Plant a v21 database with a settings row that already has
 *  `dictationSensitivity: 'high'` — the upgrade guard must leave it unchanged. */
async function plantV21DatabaseWithHighSensitivity(): Promise<void> {
  const db = new Dexie('chatsundere_client_data');
  for (let v = 1; v <= 21; v++) db.version(v).stores(V21_STORES);
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
    dictationSensitivity: 'high',
    dictationRedemptionMs: 2_000,
    dictationAutoSend: true,
    createdAt: 1,
    updatedAt: 1,
  });

  db.close();
}

describe('client-data-db v22 (dictation/STT settings)', () => {
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

  it('seeds the three dictation defaults on a fresh settings row', async () => {
    await openClientDataDb();
    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.dictationSensitivity).toBe('medium');
    expect(settings?.dictationRedemptionMs).toBe(1_728);
    expect(settings?.dictationAutoSend).toBe(false);
  });

  it('on upgrade from v21: backfills dictation defaults when fields are absent', async () => {
    await plantV21Database();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();

    const db = getClientDataDb();
    expect(db.verno).toBe(34);

    const settings = await db.settings.get(1);
    expect(settings?.dictationSensitivity).toBe('medium');
    expect(settings?.dictationRedemptionMs).toBe(1_728);
    expect(settings?.dictationAutoSend).toBe(false);
  });

  it('on upgrade from v21: preserves existing dictationSensitivity: high', async () => {
    await plantV21DatabaseWithHighSensitivity();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();

    const db = getClientDataDb();
    expect(db.verno).toBe(34);

    const settings = await db.settings.get(1);
    // 'high' is a valid sentinel value — the upgrade guard must not overwrite it
    expect(settings?.dictationSensitivity).toBe('high');
    expect(settings?.dictationRedemptionMs).toBe(2_000);
    expect(settings?.dictationAutoSend).toBe(true);
  });
});
