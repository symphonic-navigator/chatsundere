// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type McpOAuthGrantRow,
  type McpOAuthPendingRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

/** Minimal v37 store set; Dexie creates the remaining stores at head-open. */
const V37_MIN_STORES = {
  settings: 'id',
  mindspaces: 'id, builtIn, displayName',
  mcpServers: 'id, createdAt',
  syncState: 'id',
  projects: 'id, updatedAt',
} as const;

const blob = { version: 1 as const, ciphertext: new Uint8Array([1]), nonce: new Uint8Array(12) };

describe('client-data-db v38 (MCP OAuth grants and pending sign-ins)', () => {
  beforeEach(async () => await _resetClientDataDbForTests());
  afterEach(async () => await _resetClientDataDbForTests());

  it('opens at verno 38 on a fresh install with both new tables', async () => {
    const db = await openClientDataDb();
    expect(db.verno).toBe(38);
    expect(db.tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['mcpOAuthGrants', 'mcpOAuthPending']),
    );
    expect(db.mcpOAuthPending.schema.primKey.keyPath).toBe('state');
    expect(db.mcpOAuthGrants.schema.primKey.keyPath).toBe('id');
  });

  it('upgrades a v37 database with its data intact and the new tables usable', async () => {
    const raw = new Dexie('chatsundere_client_data');
    raw.version(37).stores(V37_MIN_STORES);
    await raw.open();
    await raw.table('mcpServers').add({ id: 'srv-1', name: 'tools', createdAt: 5 });
    await raw.table('projects').add({ id: 'proj-1', updatedAt: 7 });
    await raw.table('syncState').add({ id: 'state', watermarkRev: 42 });
    raw.close();

    await _resetClientDataDbForTests({ keepData: true });
    const db = await openClientDataDb();
    expect(db.verno).toBe(38);
    expect((await db.mcpServers.get('srv-1'))?.name).toBe('tools');
    expect((await db.projects.get('proj-1'))?.updatedAt).toBe(7);
    expect((await db.syncState.get('state'))?.watermarkRev).toBe(42);

    const grant: McpOAuthGrantRow = {
      id: 'srv-1',
      resource: 'https://mcp.example/mcp',
      issuer: 'https://auth.example',
      tokenEndpoint: 'https://auth.example/token',
      revocationEndpoint: null,
      clientId: 'https://chatsune.me/client.json',
      registration: 'cimd',
      scope: null,
      tokenRoute: 'direct',
      tokens: blob,
      claim: null,
      createdAt: 1,
      updatedAt: 1,
    };
    await db.mcpOAuthGrants.put(grant);
    expect((await db.mcpOAuthGrants.get('srv-1'))?.issuer).toBe('https://auth.example');

    const pending: McpOAuthPendingRow = {
      state: 'st-1',
      sealed: blob,
      serverId: 'srv-1',
      createdAt: 2,
    };
    await db.mcpOAuthPending.put(pending);
    expect((await db.mcpOAuthPending.get('st-1'))?.serverId).toBe('srv-1');
  });
});
