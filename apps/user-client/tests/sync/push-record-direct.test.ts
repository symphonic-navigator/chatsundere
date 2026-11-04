// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { type MasterKey, type SealedRecord, asMasterKey, toBase64Url } from '@chatsundere/crypto';
import type { SyncPulledRecord, SyncPushRecord, SyncPushResponse } from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type McpOAuthGrantRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { withGrantLock } from '../../src/mcp/oauth/grant-lock.js';
import { createDexieGrantStore } from '../../src/mcp/oauth/grant-store.js';
import { _resetApplyForTests, _setApplyOpenRecord } from '../../src/sync/apply.js';
import {
  SYNC_LOCK_NAME,
  _resetWorkerForTests,
  _setCryptoDeps,
  _setGrantPublisher,
  _setPullLoop,
  _setPushTransport,
  pushRecordDirect,
  runSyncCycle,
  snapshotGrant,
  withSyncLock,
} from '../../src/sync/worker.js';

vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return { ...actual, getLinkedAccount: vi.fn(async () => null) };
});

const KEY = 'srv-1';
const MK: MasterKey = asMasterKey(new Uint8Array(32).fill(5));

const placeholderBlob = {
  version: 1 as const,
  ciphertext: new Uint8Array([7, 7, 7]),
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
    tokens: placeholderBlob,
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

/** Rows the fake sealer saw, in order. */
let sealedRows: unknown[] = [];

function installFakeCrypto(): void {
  _setCryptoDeps({
    computeBlindId: async (_mk, collection, key) =>
      new TextEncoder().encode(`bid:${collection}:${key}`),
    sealRecord: async (_mk, collection, key, row): Promise<SealedRecord> => {
      sealedRows.push(row);
      return {
        blindId: new TextEncoder().encode(`bid:${collection}:${key}`),
        envelopeVersion: 1,
        nonce: new Uint8Array([1, 2, 3]),
        ciphertext: new Uint8Array([9, 9]),
        ciphertextHash: new TextEncoder().encode(`hash:${collection}:${key}`),
      };
    },
  });
}

function seedLinkedOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useDiscoveryStore.setState({
    status: 'ok',
    // biome-ignore lint/suspicious/noExplicitAny: partial store shape for the test
    config: { syncUrl: 'https://sync.example', features: ['sync'] } as any,
  });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: MK });
}

function respond(
  records: SyncPushRecord[],
  result: SyncPushResponse['results'][number],
  epoch = 'E1',
): SyncPushResponse {
  void records;
  return { head: 100, epoch, results: [result] };
}

async function seedEpoch(epoch: string): Promise<void> {
  const db = getClientDataDb();
  await db.syncState.put({
    id: 'state',
    epoch,
    watermarkRev: 0,
    lastSyncAt: null,
    pulling: null,
    attention: null,
  });
}

/** A minimal Web Locks stand-in that queues per name, so lock order can be observed. */
function installFakeLocks(): { held: Set<string>; requested: string[]; uninstall: () => void } {
  const held = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();
  const requested: string[] = [];
  const locks = {
    async request(
      name: string,
      a: unknown,
      b?: (lock: unknown) => Promise<unknown>,
    ): Promise<unknown> {
      const opts = (typeof a === 'function' ? {} : a) as { ifAvailable?: boolean };
      const fn = (typeof a === 'function' ? a : b) as (lock: unknown) => Promise<unknown>;
      requested.push(name);
      if (opts.ifAvailable && held.has(name)) return fn(null);
      while (held.has(name)) {
        await new Promise<void>((resolve) => {
          const list = waiters.get(name) ?? [];
          list.push(resolve);
          waiters.set(name, list);
        });
      }
      held.add(name);
      try {
        return await fn({ name });
      } finally {
        held.delete(name);
        const next = waiters.get(name)?.shift();
        next?.();
      }
    },
  };
  Object.defineProperty(globalThis.navigator, 'locks', { value: locks, configurable: true });
  return {
    held,
    requested,
    uninstall: () => {
      Object.defineProperty(globalThis.navigator, 'locks', {
        value: undefined,
        configurable: true,
      });
    },
  };
}

beforeEach(async () => {
  sealedRows = [];
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  installFakeCrypto();
});

afterEach(async () => {
  _resetWorkerForTests();
  _resetApplyForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('pushRecordDirect', () => {
  it('seals the row it is given, not the stored one, with baseRev as given', async () => {
    const db = getClientDataDb();
    await db.mcpOAuthGrants.put(grant({ scope: 'stored' }));
    await db.syncRows.put({ collection: 'mcpOAuthGrants', key: KEY, rev: 5, ciphertextHash: 'x' });
    const pushed: SyncPushRecord[] = [];
    _setPushTransport(async (records) => {
      pushed.push(...records);
      return respond(records, { status: 'error', code: 'quota_exceeded' });
    });

    const result = await pushRecordDirect({
      collection: 'mcpOAuthGrants',
      key: KEY,
      row: grant({ scope: 'given' }),
      baseRev: 3,
      mk: MK,
    });

    expect(result.status).toBe('error');
    expect((sealedRows[0] as McpOAuthGrantRow).scope).toBe('given');
    expect(pushed[0]?.baseRev).toBe(3);
  });

  it('on ok writes the row and its syncRows revision together', async () => {
    const db = getClientDataDb();
    await db.mcpOAuthGrants.put(grant());
    await db.syncRows.put({ collection: 'mcpOAuthGrants', key: KEY, rev: 2, ciphertextHash: 'x' });
    _setPushTransport(async (records) => respond(records, { status: 'ok', rev: 7 }));

    const claimed = grant({ claim: { deviceId: 'dev-a', at: 42 } });
    const result = await pushRecordDirect({
      collection: 'mcpOAuthGrants',
      key: KEY,
      row: claimed,
      baseRev: 2,
      mk: MK,
    });

    expect(result).toEqual({ status: 'ok', rev: 7 });
    expect((await db.mcpOAuthGrants.get(KEY))?.claim).toEqual({ deviceId: 'dev-a', at: 42 });
    const meta = await db.syncRows.get(['mcpOAuthGrants', KEY]);
    expect(meta?.rev).toBe(7);
    // The local hash of our own ciphertext, so the pulled echo is recognised.
    expect(meta?.ciphertextHash).toBe(
      toBase64Url(new TextEncoder().encode(`hash:mcpOAuthGrants:${KEY}`)),
    );
  });

  it('a won claim is visible in the local row after a simulated restart', async () => {
    const db = getClientDataDb();
    await db.mcpOAuthGrants.put(grant());
    _setPushTransport(async (records) => respond(records, { status: 'ok', rev: 4 }));

    await pushRecordDirect({
      collection: 'mcpOAuthGrants',
      key: KEY,
      row: grant({ claim: { deviceId: 'dev-a', at: 1 } }),
      baseRev: 0,
      mk: MK,
    });
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();

    const snap = await snapshotGrant(KEY);
    expect(snap?.row.claim?.deviceId).toBe('dev-a');
    expect(snap?.rev).toBe(4);
  });

  it('a lower revision never overwrites a higher one', async () => {
    const db = getClientDataDb();
    await db.mcpOAuthGrants.put(grant({ scope: 'newer' }));
    await db.syncRows.put({ collection: 'mcpOAuthGrants', key: KEY, rev: 10, ciphertextHash: 'x' });
    _setPushTransport(async (records) => respond(records, { status: 'ok', rev: 8 }));

    const result = await pushRecordDirect({
      collection: 'mcpOAuthGrants',
      key: KEY,
      row: grant({ scope: 'older' }),
      baseRev: 7,
      mk: MK,
    });

    expect(result).toEqual({ status: 'ok', rev: 8 });
    expect((await db.mcpOAuthGrants.get(KEY))?.scope).toBe('newer');
    expect((await db.syncRows.get(['mcpOAuthGrants', KEY]))?.rev).toBe(10);
  });

  it('an epoch mismatch returns epoch-mismatch and writes nothing', async () => {
    const db = getClientDataDb();
    await seedEpoch('E1');
    await db.mcpOAuthGrants.put(grant({ scope: 'before' }));
    await db.syncRows.put({ collection: 'mcpOAuthGrants', key: KEY, rev: 2, ciphertextHash: 'x' });
    _setPushTransport(async (records) => respond(records, { status: 'ok', rev: 9 }, 'E2'));

    const result = await pushRecordDirect({
      collection: 'mcpOAuthGrants',
      key: KEY,
      row: grant({ scope: 'after' }),
      baseRev: 2,
      mk: MK,
    });

    expect(result).toEqual({ status: 'epoch-mismatch' });
    expect((await db.mcpOAuthGrants.get(KEY))?.scope).toBe('before');
    expect((await db.syncRows.get(['mcpOAuthGrants', KEY]))?.rev).toBe(2);
  });

  it('a transport failure is network and writes nothing', async () => {
    const db = getClientDataDb();
    await db.mcpOAuthGrants.put(grant({ scope: 'before' }));
    _setPushTransport(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await pushRecordDirect({
      collection: 'mcpOAuthGrants',
      key: KEY,
      row: grant({ scope: 'after' }),
      baseRev: 0,
      mk: MK,
    });

    expect(result).toEqual({ status: 'network' });
    expect((await db.mcpOAuthGrants.get(KEY))?.scope).toBe('before');
    expect(await db.syncRows.get(['mcpOAuthGrants', KEY])).toBeUndefined();
  });
});

describe('snapshotGrant', () => {
  it('returns row and revision together, rev 0 when never synced, null when absent', async () => {
    const db = getClientDataDb();
    expect(await snapshotGrant(KEY)).toBeNull();
    await db.mcpOAuthGrants.put(grant({ scope: 'one' }));
    expect((await snapshotGrant(KEY))?.rev).toBe(0);
    await db.syncRows.put({ collection: 'mcpOAuthGrants', key: KEY, rev: 6, ciphertextHash: 'x' });
    const snap = await snapshotGrant(KEY);
    expect(snap?.row.scope).toBe('one');
    expect(snap?.rev).toBe(6);
  });
});

describe('Dexie grant store', () => {
  it('adopt goes through applyRecord and keeps the pending fields', async () => {
    const db = getClientDataDb();
    await db.mcpOAuthGrants.put(
      grant({ scope: 'local', pendingTokens: placeholderBlob, pendingBaseRev: 3 }),
    );
    await db.syncRows.put({ collection: 'mcpOAuthGrants', key: KEY, rev: 3, ciphertextHash: 'x' });
    _setApplyOpenRecord(async () => grant({ scope: 'pulled', pendingTokens: undefined }));
    const record: SyncPulledRecord = {
      blindId: toBase64Url(new TextEncoder().encode(`bid:mcpOAuthGrants:${KEY}`)),
      collection: 'mcpOAuthGrants',
      rev: 5,
      deleted: false,
      nonce: toBase64Url(new Uint8Array([1])),
      ciphertext: toBase64Url(new Uint8Array([5, 5])),
    };

    await createDexieGrantStore().adopt(record);

    const row = await db.mcpOAuthGrants.get(KEY);
    expect(row?.scope).toBe('pulled');
    expect(Array.from(row?.pendingTokens?.ciphertext ?? [])).toEqual([7, 7, 7]);
    expect(row?.pendingBaseRev).toBe(3);
    expect((await db.syncRows.get(['mcpOAuthGrants', KEY]))?.rev).toBe(5);
  });

  it('pendingIds lists only grants holding a pending pair', async () => {
    const db = getClientDataDb();
    await db.mcpOAuthGrants.bulkPut([
      grant({ id: 'a' }),
      grant({ id: 'b', pendingTokens: placeholderBlob }),
    ]);
    expect(await createDexieGrantStore().pendingIds()).toEqual(['b']);
  });
});

describe('lock order', () => {
  it('a grant holder proceeds while the sync lock is held elsewhere', async () => {
    const fake = installFakeLocks();
    try {
      await getClientDataDb().mcpOAuthGrants.put(grant());
      _setPushTransport(async (records) => respond(records, { status: 'ok', rev: 3 }));
      let releaseSync = (): void => undefined;
      const syncHeld = new Promise<void>((resolve) => {
        releaseSync = resolve;
      });
      const holder = withSyncLock(() => syncHeld);
      await vi.waitFor(() => expect(fake.held.has(SYNC_LOCK_NAME)).toBe(true));

      const result = await withGrantLock(KEY, () =>
        pushRecordDirect({
          collection: 'mcpOAuthGrants',
          key: KEY,
          row: grant({ claim: { deviceId: 'dev-a', at: 1 } }),
          baseRev: 0,
          mk: MK,
        }),
      );

      expect(result).toEqual({ status: 'ok', rev: 3 });
      expect(fake.held.has(SYNC_LOCK_NAME)).toBe(true);
      expect(fake.requested).toContain('chatsundere-mcp-oauth-srv-1');
      releaseSync();
      await holder;
    } finally {
      fake.uninstall();
    }
  });

  it('the sync cycle publishes pending tokens only after releasing the sync lock', async () => {
    const fake = installFakeLocks();
    try {
      const events: string[] = [];
      _setPullLoop(async () => {
        events.push(fake.held.has(SYNC_LOCK_NAME) ? 'pull-locked' : 'pull-unlocked');
      });
      const published = new Promise<void>((resolve) => {
        _setGrantPublisher(async () => {
          events.push(fake.held.has(SYNC_LOCK_NAME) ? 'publish-locked' : 'publish-unlocked');
          resolve();
        });
      });

      await runSyncCycle();
      await published;

      expect(events).toEqual(['pull-locked', 'publish-unlocked']);
    } finally {
      fake.uninstall();
    }
  });
});
