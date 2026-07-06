// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

/** Cumulative store definitions as they stood at v29, before allowDirect was added in v30. */
const V29_STORES = {
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
  memoryJournal: 'id, personaId, [personaId+state], [personaId+createdAt]',
  memoryBody: 'id, personaId, [personaId+version]',
  compactionCheckpoints: 'id, chatId, createdAt',
} as const;

/**
 * Plant a v29 database containing three mcpServers rows — one per routing value
 * ('direct', 'proxy', null) — all lacking the `allowDirect` field that the v30
 * upgrade handler must backfill.
 */
async function plantV29WithMcpServers(): Promise<void> {
  const db = new Dexie('chatsundere_client_data');
  for (let v = 1; v <= 29; v++) db.version(v).stores(V29_STORES);
  await db.open();

  const base = {
    name: 'Test Server',
    url: 'http://192.168.1.1:8080',
    prefix: 'test',
    auth: null,
    onByDefault: false,
    autoRun: false,
    enabled: true,
    resolvedEndpoint: null,
    tools: [],
    hiddenTools: [],
    lastTestedAt: null,
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
    // allowDirect deliberately absent — v30 upgrade must derive it from routing
  };

  await db.table('mcpServers').bulkAdd([
    { ...base, id: 'srv-direct', routing: 'direct' },
    { ...base, id: 'srv-proxy', routing: 'proxy' },
    { ...base, id: 'srv-null', routing: null },
  ]);

  db.close();
}

describe('client-data-db v30 — MCP local-network routing', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('opens at version 30 on a fresh install', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(34);
  });

  it('round-trips an mcpServers row carrying allowDirect', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    await db.mcpServers.put({
      id: 'srv-1',
      name: 'LAN tools',
      url: 'http://192.168.1.50:9000',
      prefix: 'lan',
      auth: null,
      onByDefault: false,
      autoRun: false,
      enabled: true,
      allowDirect: true,
      routing: null,
      resolvedEndpoint: null,
      tools: [],
      hiddenTools: [],
      lastTestedAt: null,
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const back = await db.mcpServers.get('srv-1');
    expect(back?.allowDirect).toBe(true);
  });

  it('on upgrade from v29: backfills allowDirect from routing for each pre-existing row', async () => {
    await plantV29WithMcpServers();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();

    const db = getClientDataDb();
    expect(db.verno).toBe(34);

    // routing === 'direct' → the server was already going direct; preserve that intent
    const direct = await db.mcpServers.get('srv-direct');
    expect(direct?.allowDirect).toBe(true);

    // routing === 'proxy' → the server was proxy-only; allowDirect must remain false
    const proxy = await db.mcpServers.get('srv-proxy');
    expect(proxy?.allowDirect).toBe(false);

    // routing === null → unresolved; conservative default is proxy-only (false)
    const nullRouted = await db.mcpServers.get('srv-null');
    expect(nullRouted?.allowDirect).toBe(false);
  });
});
