// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

const V3_STORES = {
  settings: 'id',
  providers: 'id, templateId, enabled',
  mindspaces: 'id, builtIn, displayName',
  personas: 'id, providerId',
  chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
  messages: 'id, chatId, [chatId+createdAt]',
  pills: 'id, messageId',
} as const;

async function plantV3DatabaseWithoutDisplayName(): Promise<void> {
  const now = Date.now();
  const v3 = new Dexie('chatsundere_client_data');
  v3.version(1).stores(V3_STORES);
  v3.version(2).stores(V3_STORES);
  v3.version(3).stores(V3_STORES);
  await v3.open();
  await v3.table('mindspaces').add({
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
  await v3.table('settings').add({
    id: 1,
    globalUnlockerPrompt: '',
    globalAboutMe: '',
    defaultMindspaceId: 'ms-1',
    userTexture: 'cloudy',
    animationsEnabled: true,
    corsProxy: null,
    createdAt: now,
    updatedAt: now,
  });
  v3.close();
}

describe('client-data-db v4 migration (displayName)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('seeds SettingsRow.displayName as "" on a fresh install', async () => {
    await openClientDataDb();
    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.displayName).toBe('');
  });

  it('on upgrade, backfills SettingsRow.displayName to "" for an existing v3 row', async () => {
    await plantV3DatabaseWithoutDisplayName();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.displayName).toBe('');
  });
});
