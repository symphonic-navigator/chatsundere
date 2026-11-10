// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// Node, not jsdom: under jsdom a re-stored row's bytes cross realms and come back as plain
// objects, which would hide whether the refusal really left the row unchanged.
import 'fake-indexeddb/auto';
import { type MasterKey, asMasterKey, toBase64Url } from '@chatsundere/crypto';
import type { SyncPulledRecord } from '@chatsundere/shared-types';
import { useSessionStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type McpOAuthGrantRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { QK } from '../../src/data/queryKeys.js';
import {
  _resetApplyForTests,
  _setApplyOpenRecord,
  applyRecord,
  flushInvalidations,
  setInvalidator,
} from '../../src/sync/apply.js';

vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

const KEY = 'srv-1';
const MK: MasterKey = asMasterKey(new Uint8Array(32).fill(5));

const tokensBlob = {
  version: 1 as const,
  ciphertext: new Uint8Array([1, 1]),
  nonce: new Uint8Array(12),
};
const pendingBlob = {
  version: 1 as const,
  ciphertext: new Uint8Array([2, 2]),
  nonce: new Uint8Array(12),
};
const pulledBlob = {
  version: 1 as const,
  ciphertext: new Uint8Array([3, 3]),
  nonce: new Uint8Array(12),
};

function grant(overrides: Partial<McpOAuthGrantRow> = {}): McpOAuthGrantRow {
  return {
    id: KEY,
    resource: 'https://mcp.example/mcp',
    issuer: 'https://auth.example',
    tokenEndpoint: 'https://auth.example/token',
    revocationEndpoint: 'https://auth.example/revoke',
    clientId: 'client-1',
    registration: 'dcr',
    scope: null,
    tokenRoute: 'direct',
    tokens: tokensBlob,
    claim: null,
    pendingTokens: null,
    pendingBaseRev: null,
    pendingSpentRefresh: null,
    pendingNewFamily: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** What another device sealed: synced fields only, as `stripForSync` leaves them. */
function sealedBody(overrides: Partial<McpOAuthGrantRow>): McpOAuthGrantRow {
  const {
    pendingTokens,
    pendingBaseRev,
    pendingSpentRefresh,
    pendingNewFamily,
    seenGeneration,
    heldGeneration,
    ...rest
  } = grant({ scope: 'pulled', tokens: pulledBlob, updatedAt: 2, ...overrides });
  void [pendingTokens, pendingBaseRev, pendingSpentRefresh, pendingNewFamily];
  void [seenGeneration, heldGeneration];
  return rest as McpOAuthGrantRow;
}

function record(rev: number, ciphertext: number): SyncPulledRecord {
  return {
    blindId: toBase64Url(new TextEncoder().encode(`bid:mcpOAuthGrants:${KEY}`)),
    collection: 'mcpOAuthGrants',
    rev,
    deleted: false,
    nonce: toBase64Url(new Uint8Array([1])),
    ciphertext: toBase64Url(new Uint8Array([ciphertext])),
  };
}

async function pull(body: McpOAuthGrantRow, rev: number): Promise<string> {
  _setApplyOpenRecord(async () => structuredClone(body));
  const outcome = await applyRecord(record(rev, rev));
  flushInvalidations();
  return outcome.kind === 'resolved' ? `resolved-${outcome.winner}` : outcome.kind;
}

let invalidated: (readonly unknown[])[] = [];

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  useSessionStore.setState({ mk: MK });
  invalidated = [];
  setInvalidator((keys) => {
    invalidated.push(...keys);
  });
});

afterEach(async () => {
  _resetApplyForTests();
  await _resetClientDataDbForTests();
  useSessionStore.setState({ session: null, mk: null });
});

describe('pulled grant generations', () => {
  it('refuses an older generation and leaves the local row unchanged', async () => {
    const db = getClientDataDb();
    const local = grant({
      generation: 9,
      seenGeneration: 9,
      heldGeneration: null,
      pendingTokens: pendingBlob,
      pendingBaseRev: 5,
    });
    await db.mcpOAuthGrants.put(local);
    await db.syncRows.put({ collection: 'mcpOAuthGrants', key: KEY, rev: 5, ciphertextHash: 'x' });
    const before = await db.mcpOAuthGrants.get(KEY);

    expect(await pull(sealedBody({ generation: 4 }), 8)).toBe('refused');

    expect(await db.mcpOAuthGrants.get(KEY)).toEqual({ ...before, heldGeneration: 4 });
    const meta = await db.syncRows.get(['mcpOAuthGrants', KEY]);
    expect(meta?.rev).toBe(8);
    expect(meta?.ciphertextHash).toBe('x');
    expect(await db.syncOutbox.count()).toBe(0);
    expect(invalidated).toContainEqual(QK.mcpOAuthGrants);
  });

  it('records the refused revision with its ciphertext hash when no base exists', async () => {
    const db = getClientDataDb();
    const local = grant({ generation: 3, seenGeneration: 3 });
    await db.mcpOAuthGrants.put(local);
    const before = await db.mcpOAuthGrants.get(KEY);

    expect(await pull(sealedBody({ generation: 2 }), 7)).toBe('refused');

    expect(await db.mcpOAuthGrants.get(KEY)).toEqual({ ...before, heldGeneration: 2 });
    const meta = await db.syncRows.get(['mcpOAuthGrants', KEY]);
    expect(meta?.rev).toBe(7);
    expect(meta?.ciphertextHash).toMatch(/.+/);
    expect(meta?.ciphertextHash).not.toBe('x');
    expect(await db.syncOutbox.count()).toBe(0);
  });

  it.each([
    [9, 9],
    [12, 12],
  ])('applies generation %i and clears the hold', async (generation, seen) => {
    const db = getClientDataDb();
    await db.mcpOAuthGrants.put(
      grant({
        generation: 9,
        seenGeneration: 9,
        heldGeneration: 4,
        pendingTokens: pendingBlob,
        pendingBaseRev: 5,
      }),
    );
    await db.syncRows.put({ collection: 'mcpOAuthGrants', key: KEY, rev: 5, ciphertextHash: 'x' });

    expect(await pull(sealedBody({ generation }), 9)).toBe('resolved-pulled');

    const row = await db.mcpOAuthGrants.get(KEY);
    expect(row?.scope).toBe('pulled');
    expect(row?.generation).toBe(generation);
    expect(Array.from(row?.tokens?.ciphertext ?? [])).toEqual([3, 3]);
    expect(row?.seenGeneration).toBe(seen);
    expect(row?.heldGeneration).toBeNull();
    expect(Array.from(row?.pendingTokens?.ciphertext ?? [])).toEqual([2, 2]);
    expect(row?.pendingBaseRev).toBe(5);
    expect((await db.syncRows.get(['mcpOAuthGrants', KEY]))?.rev).toBe(9);
    expect(invalidated).toContainEqual(QK.mcpOAuthGrants);
  });

  it('legacy rows apply', async () => {
    const db = getClientDataDb();
    await db.mcpOAuthGrants.put(grant());
    await db.syncRows.put({ collection: 'mcpOAuthGrants', key: KEY, rev: 2, ciphertextHash: 'x' });

    expect(await pull(sealedBody({}), 3)).toBe('resolved-pulled');

    const row = await db.mcpOAuthGrants.get(KEY);
    expect(row?.scope).toBe('pulled');
    expect(row?.seenGeneration).toBe(0);
    expect(row?.heldGeneration).toBeNull();
  });

  it('a fresh device accepts and records seen', async () => {
    const db = getClientDataDb();

    expect(await pull(sealedBody({ generation: 6 }), 4)).toBe('inserted');

    const row = await db.mcpOAuthGrants.get(KEY);
    expect(row?.generation).toBe(6);
    expect(row?.seenGeneration).toBe(6);
    expect(row?.heldGeneration).toBeNull();
    expect(row?.pendingTokens).toBeNull();
  });
});
