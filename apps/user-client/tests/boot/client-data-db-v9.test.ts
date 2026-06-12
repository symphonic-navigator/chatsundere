// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

const V8_STORES = {
  settings: 'id',
  providers: 'id, templateId, enabled',
  mindspaces: 'id, builtIn, displayName',
  personas: 'id, providerId',
  chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
  messages: 'id, chatId, [chatId+createdAt]',
  pills: 'id, messageId',
} as const;

/** Plant a v8 DB with a legacy-unlocker settings row + one persona, then
 *  close so the real entrypoint runs the v9 upgrade over it. */
async function plantV8Database(): Promise<void> {
  const v8 = new Dexie('chatsundere_client_data');
  for (let v = 1; v <= 8; v++) v8.version(v).stores(V8_STORES);
  await v8.open();
  await v8.table('settings').add({
    id: 1,
    displayName: '',
    globalUnlockerPrompt: 'OLD UNLOCKER TEXT',
    globalAboutMe: '',
    defaultMindspaceId: 'ms-1',
    userTexture: 'cloudy',
    animationsEnabled: true,
    adultMode: 'nsfw',
    corsProxy: null,
    createdAt: 1,
    updatedAt: 1,
  });
  await v8.table('personas').add({
    id: 'p1',
    name: 'Legacy',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: 'Be helpful.',
    canonicalId: null,
    providerId: 'pr1',
    modelId: 'm',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    createdAt: 1,
    updatedAt: 1,
  });
  v8.close();
}

describe('client-data-db v9 (tonality flag + global-instructions rename)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('reports verno === 11 on a fresh install and seeds globalInstructions', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(22);
    const settings = await db.settings.get(1);
    expect(settings).toHaveProperty('globalInstructions');
    expect((settings as unknown as Record<string, unknown>).globalUnlockerPrompt).toBeUndefined();
  });

  it('copies the unlocker into globalInstructions and backfills tonality on upgrade', async () => {
    await plantV8Database();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(22);
    const settings = await db.settings.get(1);
    const persona = await db.personas.get('p1');
    expect(settings?.globalInstructions).toBe('OLD UNLOCKER TEXT');
    expect((settings as unknown as Record<string, unknown>).globalUnlockerPrompt).toBeUndefined();
    expect(persona?.chatsundereTonality).toBe(true);
  });
});
