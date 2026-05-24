// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

const V4_STORES = {
  settings: 'id',
  providers: 'id, templateId, enabled',
  mindspaces: 'id, builtIn, displayName',
  personas: 'id, providerId',
  chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
  messages: 'id, chatId, [chatId+createdAt]',
  pills: 'id, messageId',
} as const;

async function plantV4DatabaseWithoutAdultMode(): Promise<void> {
  const now = Date.now();
  const v4 = new Dexie('chatsundere_client_data');
  v4.version(1).stores(V4_STORES);
  v4.version(2).stores(V4_STORES);
  v4.version(3).stores(V4_STORES);
  v4.version(4).stores(V4_STORES);
  await v4.open();
  await v4.table('mindspaces').add({
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
  await v4.table('settings').add({
    id: 1,
    displayName: '',
    globalUnlockerPrompt: '',
    globalAboutMe: '',
    defaultMindspaceId: 'ms-1',
    userTexture: 'cloudy',
    animationsEnabled: true,
    corsProxy: null,
    createdAt: now,
    updatedAt: now,
  });
  v4.close();
}

describe('client-data-db v5 migration (adultMode)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('seeds SettingsRow.adultMode as "nsfw" on a fresh install', async () => {
    await openClientDataDb();
    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.adultMode).toBe('nsfw');
  });

  it('on upgrade, backfills SettingsRow.adultMode to "nsfw" for an existing v4 row', async () => {
    await plantV4DatabaseWithoutAdultMode();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.adultMode).toBe('nsfw');
  });
});
