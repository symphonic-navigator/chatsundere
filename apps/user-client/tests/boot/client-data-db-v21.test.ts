// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

/** Store definitions shared across every version up to v20. */
const V20_STORES = {
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
} as const;

/** Plant a v20 database containing a settings row WITHOUT voiceMode and a
 *  persona WITHOUT voice/narratorVoice. After reopening at head the v21
 *  upgrade handler must backfill both tables. */
async function plantV20Database(): Promise<void> {
  const db = new Dexie('chatsundere_client_data');
  for (let v = 1; v <= 20; v++) db.version(v).stores(V20_STORES);
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
    // voiceMode deliberately absent — v21 upgrade must backfill it
    createdAt: 1,
    updatedAt: 1,
  });

  await db.table('personas').add({
    id: 'p-legacy',
    name: 'Legacy',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: 'Be helpful.',
    canonicalId: null,
    providerId: 'pr-1',
    modelId: 'm',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
    roleplay: false,
    narration: 'first',
    greetingEnabled: false,
    greetingInstructions: '',
    // voice and narratorVoice deliberately absent — v21 upgrade must backfill them
    createdAt: 1,
    updatedAt: 1,
  });

  db.close();
}

describe('client-data-db v21 (voice settings + voiceAudio table)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });

  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('opens at verno 21 on a fresh install and voiceAudio table exists', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(28);
    // Table must exist and be queryable
    expect(await db.voiceAudio.count()).toBe(0);
  });

  it('seeds voiceMode on fresh settings', async () => {
    await openClientDataDb();
    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.voiceMode).toBe('paragraph');
  });

  it('on upgrade from v20: backfills settings.voiceMode, persona.voice, persona.narratorVoice, and creates voiceAudio', async () => {
    await plantV20Database();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();

    const db = getClientDataDb();
    expect(db.verno).toBe(28);

    // Settings: voiceMode must default to 'paragraph'
    const settings = await db.settings.get(1);
    expect(settings?.voiceMode).toBe('paragraph');

    // Persona: voice and narratorVoice must be null
    const persona = await db.personas.get('p-legacy');
    expect(persona?.voice).toBeNull();
    expect(persona?.narratorVoice).toBeNull();

    // voiceAudio table must exist and be empty
    expect(await db.voiceAudio.count()).toBe(0);
  });
});
