// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { SyncPullResponse, SyncPushRecord, SyncPushResponse } from '@chatsundere/shared-types';
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
import {
  resetEngineStateForLocalOnly,
  resetEngineStateForNewLink,
} from '../../src/sync/link-reset.js';
import { advanceWatermark, getSyncState } from '../../src/sync/watermark.js';
import {
  _resetWorkerForTests,
  _setCryptoDeps,
  _setPullTransport,
  _setPushTransport,
  drainOutbox,
  runPullLoop,
} from '../../src/sync/worker.js';

// The reset path reads the crypto DB's linked account; stub it inert (no account
// linked → the identity stamp is `undefined`, never a mismatch).
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));
vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return { ...actual, getLinkedAccount: vi.fn(async () => null) };
});

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

function installFakeCrypto(): void {
  _setCryptoDeps({
    computeBlindId: async (_mk, collection, key) =>
      new TextEncoder().encode(`bid:${collection}:${key}`),
    sealRecord: async (_mk, collection, key) => ({
      blindId: new TextEncoder().encode(`bid:${collection}:${key}`),
      envelopeVersion: 1,
      nonce: new Uint8Array([1, 2, 3]),
      ciphertext: new Uint8Array([9, 9]),
      ciphertextHash: new TextEncoder().encode(`hash:${collection}:${key}`),
    }),
  });
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

function okResponse(revs: number[], head: number, epoch = 'E1'): SyncPushResponse {
  return { head, epoch, results: revs.map((rev) => ({ status: 'ok', rev })) };
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  installFakeCrypto();
});

afterEach(async () => {
  _resetWorkerForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('relink generation guard (audit finding #8)', () => {
  it('increments linkGeneration on every engine reset', async () => {
    expect((await getSyncState()).linkGeneration ?? 0).toBe(0);
    await resetEngineStateForNewLink();
    expect((await getSyncState()).linkGeneration).toBe(1);
    await resetEngineStateForLocalOnly();
    expect((await getSyncState()).linkGeneration).toBe(2);
  });

  it('discards a stale drain ack after a relink (no syncRows re-insert)', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1', name: 'v1', updatedAt: 1 } as never);
    await addOutbox('personas', 'p1', 'upsert');

    // A DELAYED push response — held until we release it.
    let release: (r: SyncPushResponse) => void = () => undefined;
    const pending = new Promise<SyncPushResponse>((res) => {
      release = res;
    });
    _setPushTransport((_records: SyncPushRecord[]) => pending);

    const draining = drainOutbox();
    // While the push is in flight, relink to a fresh account.
    await resetEngineStateForNewLink();
    // Now release the STALE ok ack (it belongs to the previous account).
    release(okResponse([5], 5));
    await draining;

    // The stale ack must NOT have re-inserted a syncRows meta (that is exactly the
    // silent-stranding bug: the backfill would then skip this key as already-synced).
    expect(await db.syncRows.get(['personas', 'p1'])).toBeUndefined();
    // The relink armed the backfill; it must still be pending.
    expect((await getSyncState()).backfillPending).toBe(true);
  });

  it('a stale pull page cannot advance the fresh watermark', async () => {
    // The device is behind at watermark 3 before the relink.
    await advanceWatermark(3);

    // The relink happens DURING the pull round-trip (deterministic ordering): the
    // page was requested against the OLD account (since=3) but resolves after the
    // reset cleared syncRows, reset the watermark to 0, and bumped the generation.
    let pulls = 0;
    _setPullTransport(async (): Promise<SyncPullResponse> => {
      pulls += 1;
      if (pulls === 1) await resetEngineStateForNewLink();
      return { epoch: 'E1', head: 9, more: false, records: [] };
    });

    await runPullLoop();

    // Without the guard the stale page would advance the watermark back to the
    // since it was requested at (3); the guard holds it at the freshly-reset 0.
    expect((await getSyncState()).watermarkRev).toBe(0);
  });
});
