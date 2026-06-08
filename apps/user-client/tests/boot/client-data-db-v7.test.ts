// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ContentBlock,
  type MessageRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

const V6_STORES = {
  settings: 'id',
  providers: 'id, templateId, enabled',
  mindspaces: 'id, builtIn, displayName',
  personas: 'id, providerId',
  chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
  messages: 'id, chatId, [chatId+createdAt]',
  pills: 'id, messageId',
} as const;

/** Open a raw Dexie v6 database, plant a chat + message with the legacy
 *  text/pill ContentBlock set, then close so the real entrypoint can pick
 *  it up and run the v7 noop bump. */
async function plantV6DatabaseWithLegacyMessage(): Promise<void> {
  const now = Date.now();
  const v6 = new Dexie('chatsundere_client_data');
  v6.version(1).stores(V6_STORES);
  v6.version(2).stores(V6_STORES);
  v6.version(3).stores(V6_STORES);
  v6.version(4).stores(V6_STORES);
  v6.version(5).stores(V6_STORES);
  v6.version(6).stores(V6_STORES);
  await v6.open();
  await v6.table('mindspaces').add({
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
  await v6.table('settings').add({
    id: 1,
    displayName: '',
    globalUnlockerPrompt: '',
    globalAboutMe: '',
    defaultMindspaceId: 'ms-1',
    userTexture: 'cloudy',
    animationsEnabled: true,
    adultMode: 'nsfw',
    corsProxy: null,
    createdAt: now,
    updatedAt: now,
  });
  await v6.table('chats').add({
    id: 'chat-1',
    personaId: 'p-1',
    title: null,
    resolvedMindspaceId: 'ms-1',
    createdAt: now,
    lastMessageAt: now,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  });
  await v6.table('messages').add({
    id: 'msg-legacy',
    chatId: 'chat-1',
    role: 'persona',
    contentBlocks: [
      { type: 'text', text: 'Hello there.' },
      { type: 'pill', pillId: 'pill-xyz' },
    ],
    createdAt: now,
    bookmarked: false,
    streamingState: 'complete',
  });
  v6.close();
}

describe('client-data-db v7 (reasoning ContentBlock variant)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('reports verno === 11 after open on a fresh install', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(16);
  });

  it('round-trips a message with a reasoning ContentBlock', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    const now = Date.now();
    await db.chats.add({
      id: 'chat-r',
      personaId: 'p-1',
      title: null,
      resolvedMindspaceId: 'ms-r',
      createdAt: now,
      lastMessageAt: now,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    const reasoningBlock: ContentBlock = {
      type: 'reasoning',
      text: 'First I weighed the options, then I chose.',
    };
    const row: MessageRow = {
      id: 'msg-r',
      chatId: 'chat-r',
      role: 'persona',
      contentBlocks: [reasoningBlock, { type: 'text', text: 'My answer is 42.' }],
      createdAt: now,
      bookmarked: false,
      streamingState: 'complete',
    };
    await db.messages.add(row);
    const readBack = await db.messages.get('msg-r');
    expect(readBack).toBeDefined();
    expect(readBack?.contentBlocks[0]?.type).toBe('reasoning');
    expect(readBack?.contentBlocks).toEqual(row.contentBlocks);
  });

  it('preserves existing v6 text/pill messages across the v7/v8 bump', async () => {
    await plantV6DatabaseWithLegacyMessage();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(16);
    const row = await db.messages.get('msg-legacy');
    expect(row).toBeDefined();
    expect(row?.contentBlocks).toEqual([
      { type: 'text', text: 'Hello there.' },
      { type: 'pill', pillId: 'pill-xyz' },
    ]);
  });
});
