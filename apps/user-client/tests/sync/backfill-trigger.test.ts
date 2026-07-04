// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { SealedRecord } from '@chatsundere/crypto';
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
import { checkEpoch } from '../../src/sync/watermark.js';
import {
  _resetWorkerForTests,
  _setBackfill,
  _setCryptoDeps,
  _setPullLoop,
  _setPushTransport,
  _setRecovery,
  runSyncCycle,
} from '../../src/sync/worker.js';

// The cycle-start server-identity guard (Task 4) reads the crypto DB's linked
// account; these tests exercise the backfill handoff, not that guard, so it
// is stubbed inert (no account linked → the guard never fires).
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return { ...actual, getLinkedAccount: vi.fn(async () => null) };
});

/** Deterministic fake crypto — no key material, no real WebCrypto needed. */
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

describe('cycle → backfill handoff', () => {
  it('runs the registered backfill after drain+pull within the same cycle', async () => {
    const calls: string[] = [];
    // A pure-reader cycle (empty outbox → head === null) hands off to the pull loop.
    _setPullLoop(async () => {
      calls.push('pull');
    });
    _setBackfill(async () => {
      calls.push('backfill');
    });

    await runSyncCycle();

    expect(calls).toEqual(['pull', 'backfill']);
  });

  it('does not run backfill when recovery was handed off instead', async () => {
    // Force an authenticated epoch mismatch so the drain reports needsRecovery and
    // the cycle returns early — before ever reaching the backfill handoff.
    const db = getClientDataDb();
    await checkEpoch('E1'); // persist the first-synced epoch
    await db.personas.put({ id: 'p1' } as never);
    await addOutbox('personas', 'p1', 'upsert');
    _setPushTransport(async () => ({ head: 2, epoch: 'E2', results: [{ status: 'ok', rev: 2 }] }));

    const recover = vi.fn(async () => undefined);
    const backfill = vi.fn(async () => undefined);
    _setRecovery(recover);
    _setBackfill(backfill);

    await runSyncCycle();

    expect(recover).toHaveBeenCalledTimes(1);
    expect(backfill).not.toHaveBeenCalled();
  });
});
