// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { SealedRecord } from '@chatsundere/crypto';
import type { SyncPullResponse } from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { _resetApplyForTests } from '../../src/sync/apply.js';
import {
  _resetRecoveryForTests,
  _setRecoveryPull,
  _setRecoverySleep,
  isEnginePaused,
  runRecovery,
} from '../../src/sync/recovery.js';
import {
  _resetWorkerForTests,
  _setCryptoDeps,
  _setPushTransport,
  runSyncCycle,
} from '../../src/sync/worker.js';

// The crypto IDB connection is opaque to `enforceServerIdentity` — it is only
// ever passed straight into the mocked `getLinkedAccount` below — so a dummy
// value is enough; no real connection needs opening in this test file
// (mirrors `server-identity.test.ts`).
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return { ...actual, getLinkedAccount: vi.fn(async () => null) };
});

function fakeSealed(collection: string, key: string): SealedRecord {
  return {
    blindId: new TextEncoder().encode(`bid:${collection}:${key}`),
    envelopeVersion: 1,
    nonce: new Uint8Array([1, 2, 3]),
    ciphertext: new Uint8Array([9, 9]),
    ciphertextHash: new TextEncoder().encode(`hash:${collection}:${key}`),
  };
}

function installFakeCrypto(): void {
  _setCryptoDeps({
    computeBlindId: async (_mk, collection, key) =>
      new TextEncoder().encode(`bid:${collection}:${key}`),
    sealRecord: async (_mk, collection, key) => fakeSealed(collection, key),
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
  useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: {} as never });
}

async function addOutbox(collection: string, key: string, op: 'upsert' | 'delete'): Promise<void> {
  await getClientDataDb().syncOutbox.add({
    // biome-ignore lint/suspicious/noExplicitAny: SyncCollection narrowed by callers
    collection: collection as any,
    key,
    op,
    enqueuedAt: Date.now(),
  });
}

/** An empty pull page reporting a given epoch (the fresh-reset server case). */
function emptyPull(epoch: string): SyncPullResponse {
  return { head: 0, epoch, more: false, records: [] };
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  installFakeCrypto();
  _setRecoverySleep(async () => undefined); // no real backoff sleep in tests
});

afterEach(async () => {
  _resetRecoveryForTests();
  _resetWorkerForTests();
  _resetApplyForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
});

describe('canRunCycle quiesces while recovery is paused (Finding P)', () => {
  it('a paused engine runs no drain/pull cycle', async () => {
    // Trip the M-4 flap-stop: three recoveries within the hour latches
    // `enginePaused`.
    _setRecoveryPull(async () => emptyPull('E2'));
    _setPushTransport(async (records) => ({
      head: 0,
      epoch: 'E2',
      results: records.map((_r, i) => ({ status: 'ok', rev: i })),
    }));
    await runRecovery();
    await runRecovery();
    await runRecovery(); // the third within the hour trips the limit
    expect(isEnginePaused()).toBe(true);

    // Now a normal cycle trigger must no-op entirely — no drain, no pull.
    let drained = false;
    _setPushTransport(async () => {
      drained = true;
      throw new Error('unreachable — the cycle must not run while paused');
    });
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1', name: 'v1', updatedAt: 1 } as never);
    await addOutbox('personas', 'p1', 'upsert');

    await runSyncCycle();

    expect(drained).toBe(false);
  });

  it('a non-paused engine still runs the cycle', async () => {
    expect(isEnginePaused()).toBe(false);
    let drained = false;
    _setPushTransport(async (records) => {
      drained = true;
      return {
        head: 1,
        epoch: 'E1',
        results: records.map((_r, i) => ({ status: 'ok', rev: i })),
      };
    });
    _setRecoveryPull(async () => emptyPull('E1'));
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1', name: 'v1', updatedAt: 1 } as never);
    await addOutbox('personas', 'p1', 'upsert');

    await runSyncCycle();

    expect(drained).toBe(true);
  });
});
