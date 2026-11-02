// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import {
  type MasterKey,
  asMasterKey,
  computeBlindId,
  fromBase64Url,
  getRandomBytes,
  sealRecord,
  toBase64Url,
} from '@chatsundere/crypto';
import type { SyncCollection, SyncPulledRecord } from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type McpOAuthGrantRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { getDeviceId, openTokens, sealTokens } from '../../src/data/mcp-oauth-grants.js';
import type { TokenSet } from '../../src/mcp/oauth/token-client.js';
import {
  _resetApplyForTests,
  _setApplyComputeBlindId,
  _setApplyOpenRecord,
  applyRecord,
} from '../../src/sync/apply.js';
import {
  BACKFILL_ORDER,
  _resetBackfillForTests,
  _setBackfillDrain,
  _setVectorKeysSource,
  runBackfillIfPending,
} from '../../src/sync/backfill.js';
import { runReconciliationIfDue } from '../../src/sync/reconcile.js';
import { prepareRecord } from '../../src/sync/seal-batch.js';
import { _resetWorkerForTests } from '../../src/sync/worker.js';

// ===== Fixtures =====

const ACCESS = 'access-plaintext-marker-7f3a';
const REFRESH = 'refresh-plaintext-marker-91bc';

const TOKENS: TokenSet = {
  accessToken: ACCESS,
  refreshToken: REFRESH,
  accessExpiresAt: 1_900_000_000_000,
  scope: 'mcp',
};

const placeholderBlob = {
  version: 1 as const,
  ciphertext: new Uint8Array([7, 7, 7]),
  nonce: new Uint8Array(12),
};

function grant(id: string, overrides: Partial<McpOAuthGrantRow> = {}): McpOAuthGrantRow {
  return {
    id,
    resource: 'https://mcp.example/mcp',
    issuer: 'https://auth.example',
    tokenEndpoint: 'https://auth.example/token',
    revocationEndpoint: 'https://auth.example/revoke',
    clientId: 'https://chatsune.me/oauth/client.json',
    registration: 'cimd',
    scope: 'mcp',
    tokenRoute: 'direct',
    tokens: placeholderBlob,
    claim: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function fakeBlindId(collection: string, key: string): Uint8Array {
  return new TextEncoder().encode(`bid:${collection}:${key}`);
}

function pulledUpsert(key: string, rev: number): SyncPulledRecord {
  return {
    blindId: toBase64Url(fakeBlindId('mcpOAuthGrants', key)),
    collection: 'mcpOAuthGrants',
    rev,
    deleted: false,
    nonce: toBase64Url(new Uint8Array([1, 2, 3])),
    ciphertext: toBase64Url(new Uint8Array([rev, 4, 5, 6])),
  };
}

function pulledTombstone(key: string, rev: number): SyncPulledRecord {
  return {
    blindId: toBase64Url(fakeBlindId('mcpOAuthGrants', key)),
    collection: 'mcpOAuthGrants',
    rev,
    deleted: true,
  };
}

function seedLinkedOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useDiscoveryStore.setState({
    status: 'ok',
    // biome-ignore lint/suspicious/noExplicitAny: partial store shape for the test
    config: { syncUrl: 'https://sync.example', features: ['sync'] } as any,
  });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: {} as never });
}

let mk: MasterKey;

beforeEach(async () => {
  mk = asMasterKey(getRandomBytes(32));
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  _setApplyComputeBlindId(async (_mk, collection, key) => fakeBlindId(collection, key));
});

afterEach(async () => {
  _resetApplyForTests();
  _resetBackfillForTests();
  _resetWorkerForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

// ===== Token sealing =====

describe('sealTokens / openTokens', () => {
  it('round-trips a token set under the server slot', async () => {
    const blob = await sealTokens(TOKENS, mk, 'srv-1');
    expect(await openTokens(blob, mk, 'srv-1')).toEqual(TOKENS);
  });

  it('returns null for a null blob', async () => {
    expect(await openTokens(null, mk, 'srv-1')).toBeNull();
  });

  it("fails to open under another server's slot", async () => {
    const blob = await sealTokens(TOKENS, mk, 'srv-1');
    let failed = false;
    try {
      await openTokens(blob, mk, 'srv-2');
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});

// ===== Per-device id =====

describe('getDeviceId', () => {
  it('creates one id on first use and keeps it in syncState', async () => {
    const [a, b] = await Promise.all([getDeviceId(), getDeviceId()]);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(await getDeviceId()).toBe(a);
    expect((await getClientDataDb().syncState.get('state'))?.mcpDeviceId).toBe(a);
  });
});

// ===== Pull apply =====

describe('applyRecord — mcpOAuthGrants', () => {
  it('a pulled grant replaces the local row but keeps the local pending fields', async () => {
    const db = getClientDataDb();
    await db.mcpOAuthGrants.put(
      grant('srv-1', {
        updatedAt: 50,
        scope: 'local',
        pendingTokens: placeholderBlob,
        pendingBaseRev: 3,
        pendingSpentRefresh: null,
        pendingNewFamily: true,
      }),
    );
    await db.syncRows.put({
      collection: 'mcpOAuthGrants',
      key: 'srv-1',
      rev: 3,
      ciphertextHash: 'x',
    });
    _setApplyOpenRecord(async () => grant('srv-1', { updatedAt: 10, scope: 'pulled' }));

    const outcome = await applyRecord(pulledUpsert('srv-1', 4));

    expect(outcome).toEqual({ kind: 'resolved', winner: 'pulled' });
    const row = await db.mcpOAuthGrants.get('srv-1');
    expect(row?.scope).toBe('pulled');
    expect(row?.updatedAt).toBe(10);
    // Compared by bytes: a structured clone under jsdom yields another realm's Uint8Array.
    expect(Array.from(row?.pendingTokens?.ciphertext ?? [])).toEqual([7, 7, 7]);
    expect(row?.pendingBaseRev).toBe(3);
    expect(row?.pendingNewFamily).toBe(true);
    expect((await db.syncRows.get(['mcpOAuthGrants', 'srv-1']))?.rev).toBe(4);
    expect(await db.syncOutbox.count()).toBe(0);
  });

  it('a pulled grant tombstone deletes the row and creates no trash entry', async () => {
    const db = getClientDataDb();
    await db.mcpOAuthGrants.put(grant('srv-1'));
    await db.syncRows.put({
      collection: 'mcpOAuthGrants',
      key: 'srv-1',
      rev: 3,
      ciphertextHash: 'x',
    });
    await db.syncOutbox.add({
      collection: 'mcpOAuthGrants',
      key: 'srv-1',
      op: 'upsert',
      enqueuedAt: 1,
    });

    const outcome = await applyRecord(pulledTombstone('srv-1', 5));

    expect(outcome).toEqual({ kind: 'tombstoned' });
    expect(await db.mcpOAuthGrants.get('srv-1')).toBeUndefined();
    expect(await db.trash.count()).toBe(0);
    expect(await db.syncRows.get(['mcpOAuthGrants', 'srv-1'])).toBeUndefined();
    expect(await db.syncOutbox.count()).toBe(0);
  });
});

// ===== Seal =====

describe('prepareRecord — mcpOAuthGrants', () => {
  it('seals a grant given as an explicit row, with no token plaintext on the wire', async () => {
    const row = grant('srv-1', {
      tokens: await sealTokens(TOKENS, mk, 'srv-1'),
      claim: { deviceId: 'dev-a', at: 5 },
      pendingTokens: await sealTokens(TOKENS, mk, 'srv-1'),
      pendingBaseRev: 2,
    });
    const prepared = await prepareRecord({ computeBlindId, sealRecord }, mk, {
      collection: 'mcpOAuthGrants',
      key: 'srv-1',
      op: 'upsert',
      seqs: [],
      row,
      baseRev: 2,
    });

    expect(prepared.collection).toBe('mcpOAuthGrants');
    expect(prepared.record.baseRev).toBe(2);
    expect(prepared.record.deleted).toBe(false);
    expect(prepared.record.ciphertext).toBeDefined();
    const wire = JSON.stringify(prepared.record);
    const ciphertext = new TextDecoder().decode(fromBase64Url(prepared.record.ciphertext ?? ''));
    for (const haystack of [wire, ciphertext]) {
      expect(haystack.includes(ACCESS)).toBe(false);
      expect(haystack.includes(REFRESH)).toBe(false);
      // The row itself is sealed, so even its plain metadata never shows.
      expect(haystack.includes('auth.example')).toBe(false);
    }
  });
});

// ===== Reconcile =====

describe('reconcile — mcpOAuthGrants', () => {
  it('never enqueues a grant, even when it differs from the stamped hash', async () => {
    const db = getClientDataDb();
    await db.mcpOAuthGrants.put(grant('srv-1', { scope: 'changed' }));
    await db.syncRows.put({
      collection: 'mcpOAuthGrants',
      key: 'srv-1',
      rev: 5,
      ciphertextHash: 'wire',
      localContentHash: 'stale-baseline',
    });
    await db.syncState.put({
      id: 'state',
      epoch: null,
      watermarkRev: 0,
      lastSyncAt: null,
      pulling: null,
      attention: null,
      lastReconcileAt: null,
    });

    await runReconciliationIfDue();

    expect(await db.syncOutbox.where('collection').equals('mcpOAuthGrants').count()).toBe(0);
    // The pass itself completed (so the grant was skipped, not merely unreached).
    expect((await db.syncState.get('state'))?.lastReconcileAt).not.toBeNull();
  });
});

// ===== Backfill =====

describe('backfill — mcpOAuthGrants', () => {
  it('runs straight after mcpServers', () => {
    expect(BACKFILL_ORDER.indexOf('mcpOAuthGrants')).toBe(BACKFILL_ORDER.indexOf('mcpServers') + 1);
  });

  it('uploads an ordinary grant and skips one with pendingNewFamily', async () => {
    const db = getClientDataDb();
    await db.mcpOAuthGrants.bulkPut([
      grant('srv-plain'),
      grant('srv-new-family', {
        tokens: null,
        pendingTokens: placeholderBlob,
        pendingNewFamily: true,
      }),
    ]);
    await db.syncState.put({
      id: 'state',
      epoch: null,
      watermarkRev: 0,
      lastSyncAt: null,
      pulling: null,
      attention: null,
      backfillPending: true,
      backfillTotal: null,
      backfillDone: null,
    });
    const seen: Array<{ collection: SyncCollection; key: string }> = [];
    _setVectorKeysSource(async () => []);
    _setBackfillDrain(async () => {
      const rows = await db.syncOutbox.toArray();
      await db.transaction('rw', db.syncRows, db.syncOutbox, async () => {
        for (const r of rows) {
          seen.push({ collection: r.collection, key: r.key });
          await db.syncRows.put({
            collection: r.collection,
            key: r.key,
            rev: 1,
            ciphertextHash: 'h',
          });
          if (r.seq !== undefined) await db.syncOutbox.delete(r.seq);
        }
      });
    });

    await runBackfillIfPending();

    const grantKeys = seen.filter((s) => s.collection === 'mcpOAuthGrants').map((s) => s.key);
    expect(grantKeys).toEqual(['srv-plain']);
    expect((await db.syncState.get('state'))?.backfillPending).toBe(false);
  });
});
