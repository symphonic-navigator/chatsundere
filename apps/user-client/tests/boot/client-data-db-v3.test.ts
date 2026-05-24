// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

const V2_STORES = {
  settings: 'id',
  providers: 'id, templateId, enabled',
  mindspaces: 'id, builtIn, displayName',
  personas: 'id, providerId',
  chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
  messages: 'id, chatId, [chatId+createdAt]',
  pills: 'id, messageId',
} as const;

/** Open a raw Dexie v2 database, plant seed data, close it, then hand off to
 *  the real entrypoint — which will run the v3 upgrade handler. */
async function plantV2Database(
  opts: { texture?: 'cloudy' | 'aurora' | 'grain' } = {},
): Promise<void> {
  const now = Date.now();
  const msId = 'ms-seed-1';
  const v2 = new Dexie('chatsundere_client_data');
  v2.version(1).stores(V2_STORES);
  v2.version(2).stores(V2_STORES);
  await v2.open();
  await v2.table('mindspaces').add({
    id: msId,
    displayName: 'Aurum',
    palette: {
      bg: '#0a0a0a',
      surfaceBase: '',
      surfaceRaised: '',
      surfaceInput: '',
      accent: '#c9a84c',
      accentSubtle: '',
      accentBorder: '',
      accentBorderActive: '',
      accentGlow: '',
      text: { primary: '', secondary: '', muted: '', ghost: '' },
    },
    texture: opts.texture ?? 'cloudy',
    builtIn: true,
    createdAt: now,
  });
  await v2.table('settings').add({
    id: 1,
    globalUnlockerPrompt: '',
    globalAboutMe: '',
    defaultMindspaceId: msId,
    animationsEnabled: true,
    corsProxy: null,
    createdAt: now,
    updatedAt: now,
  });
  v2.close();
}

describe('client-data-db v3 migration', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('seeds SettingsRow.userTexture as "cloudy" on a fresh install', async () => {
    await openClientDataDb();
    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.userTexture).toBe('cloudy');
  });

  it('seeds PersonaRow.textureOverride as null on persona creation', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    await db.personas.add({
      id: 'p-1',
      name: 'Test',
      tagline: '',
      colour: '#c9a84c',
      font: 'serif',
      instructions: 'x',
      providerId: 'pr-1',
      modelId: 'm-1',
      mindspaceId: null,
      aboutMeOverride: null,
      textureOverride: null,
      temperature: 0.85,
      adultPersona: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const row = await db.personas.get('p-1');
    expect(row?.textureOverride).toBeNull();
  });

  it('on upgrade, backfills SettingsRow.userTexture from the default mindspace.texture if available', async () => {
    // Plant a v2 database where the default mindspace has texture='aurora',
    // then let the v3 entrypoint run the upgrade handler.
    await plantV2Database({ texture: 'aurora' });
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const newSettings = await getClientDataDb().settings.get(1);
    expect(newSettings?.userTexture).toBe('aurora');
  });

  it('on upgrade, backfills PersonaRow.textureOverride to null for existing personas', async () => {
    // Plant a v2 database with a persona row that has no textureOverride field.
    const now = Date.now();
    const v2 = new Dexie('chatsundere_client_data');
    v2.version(1).stores(V2_STORES);
    v2.version(2).stores(V2_STORES);
    await v2.open();
    await v2.table('mindspaces').add({
      id: 'ms-1',
      displayName: 'Aurum',
      palette: {
        bg: '#0a0a0a',
        surfaceBase: '',
        surfaceRaised: '',
        surfaceInput: '',
        accent: '#c9a84c',
        accentSubtle: '',
        accentBorder: '',
        accentBorderActive: '',
        accentGlow: '',
        text: { primary: '', secondary: '', muted: '', ghost: '' },
      },
      texture: 'cloudy',
      builtIn: true,
      createdAt: now,
    });
    await v2.table('settings').add({
      id: 1,
      globalUnlockerPrompt: '',
      globalAboutMe: '',
      defaultMindspaceId: 'ms-1',
      animationsEnabled: true,
      corsProxy: null,
      createdAt: now,
      updatedAt: now,
    });
    // Plant a pre-v3 persona — no textureOverride field.
    await v2.table('personas').add({
      id: 'p-1',
      name: 'Pre-existing',
      tagline: '',
      colour: '#c9a84c',
      font: 'serif',
      instructions: 'x',
      providerId: 'pr-1',
      modelId: 'm-1',
      mindspaceId: null,
      aboutMeOverride: null,
      temperature: 0.85,
      adultPersona: false,
      createdAt: now,
      updatedAt: now,
    });
    v2.close();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const row = await getClientDataDb().personas.get('p-1');
    expect(row?.textureOverride).toBeNull();
  });
});
