// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { toBase64Url } from '@chatsundere/crypto';
import type { SealedRecord } from '@chatsundere/crypto';
import type { SyncPushRecord, SyncPushResponse } from '@chatsundere/shared-types';
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
  _resetWorkerForTests,
  _setCryptoDeps,
  _setOpenRecord,
  _setPushTransport,
  drainOutbox,
} from '../../src/sync/worker.js';

// The cycle-start server-identity guard (Task 4) reads the crypto DB's linked
// account; these tests drive the drain machinery, not that guard, so it is
// stubbed inert (no account linked → the guard never fires).
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return { ...actual, getLinkedAccount: vi.fn(async () => null) };
});

/**
 * Finding #4c (Medium, server-amplifiable): `applyOk` used to write the
 * server-returned `rev` into `syncRows` UNCONDITIONALLY. A stale/low rev — a
 * concurrent pull already advanced `meta.rev` past it, or a misbehaving
 * server hands back a low rev on an `ok` ack — regressed the CAS base below
 * the watermark, wedging the key: it is never re-served, and a later local
 * edit pushes a stale `baseRev` into a perpetual conflict/re-push loop. The
 * fix guards the write behind a strict `rev > existing.rev` check inside the
 * same transaction, mirrored in `applyConflict`'s poison-heal branch.
 */

const HASH_BYTES = new TextEncoder().encode('hash:personas:p1');
const HASH_B64 = toBase64Url(HASH_BYTES);

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

/** A push response with one `ok` result per record. */
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

describe('applyOk — monotone rev guard on push acks (#4c)', () => {
  it('does not regress meta.rev/ciphertextHash when the ack rev is LOWER than the existing watermark', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1', name: 'v1', updatedAt: 1 } as never);
    await db.syncRows.put({
      collection: 'personas',
      key: 'p1',
      rev: 50,
      ciphertextHash: 'existing-hash-50',
    });
    await addOutbox('personas', 'p1', 'upsert');

    // A stale/low ack — a concurrent pull already advanced past rev 50, or a
    // misbehaving server hands back a low rev on an `ok` ack.
    _setPushTransport(async (_records: SyncPushRecord[]) => okResponse([3], 3));

    await drainOutbox();

    const meta = await db.syncRows.get(['personas', 'p1']);
    expect(meta?.rev).toBe(50); // unchanged — never regressed
    expect(meta?.ciphertextHash).toBe('existing-hash-50'); // never clobbered by the stale ack
  });

  it('DOES advance meta.rev/ciphertextHash when the ack rev is strictly HIGHER than the existing watermark', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1', name: 'v1', updatedAt: 1 } as never);
    await db.syncRows.put({
      collection: 'personas',
      key: 'p1',
      rev: 50,
      ciphertextHash: 'existing-hash-50',
    });
    await addOutbox('personas', 'p1', 'upsert');

    _setPushTransport(async (_records: SyncPushRecord[]) => okResponse([51], 51));

    await drainOutbox();

    const meta = await db.syncRows.get(['personas', 'p1']);
    expect(meta?.rev).toBe(51);
    expect(meta?.ciphertextHash).toBe(HASH_B64);
  });
});

describe('applyConflict — monotone rev guard on the poison-heal CAS-base adoption (#4c)', () => {
  it('does not regress meta.rev when the poison current.rev is LOWER than the existing watermark', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1', name: 'v1', updatedAt: 1 } as never);
    await db.syncRows.put({
      collection: 'personas',
      key: 'p1',
      rev: 50,
      ciphertextHash: 'existing-hash-50',
    });
    await addOutbox('personas', 'p1', 'upsert');

    // Undecryptable under our MK — the poison-heal branch.
    _setOpenRecord(async () => {
      throw new Error('codec failure (undecryptable poison)');
    });
    _setPushTransport(async (_records: SyncPushRecord[]) => ({
      head: 3,
      epoch: 'E1',
      results: [
        {
          status: 'conflict',
          current: {
            blindId: toBase64Url(new TextEncoder().encode('bid:personas:p1')),
            collection: 'personas',
            rev: 3, // lower than the existing watermark (50)
            deleted: false,
            nonce: toBase64Url(new Uint8Array([9, 9, 9])),
            ciphertext: toBase64Url(new Uint8Array([1, 2, 3])),
          },
        },
      ],
    }));

    await drainOutbox();

    const meta = await db.syncRows.get(['personas', 'p1']);
    expect(meta?.rev).toBe(50); // unchanged — never regressed
    expect(meta?.ciphertextHash).toBe('existing-hash-50');
  });

  it('DOES adopt the poison current.rev as the new CAS base when it is strictly HIGHER', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1', name: 'v1', updatedAt: 1 } as never);
    await db.syncRows.put({ collection: 'personas', key: 'p1', rev: 1, ciphertextHash: 'stale' });
    await addOutbox('personas', 'p1', 'upsert');

    _setOpenRecord(async () => {
      throw new Error('codec failure (undecryptable poison)');
    });
    _setPushTransport(async (_records: SyncPushRecord[]) => ({
      head: 12,
      epoch: 'E1',
      results: [
        {
          status: 'conflict',
          current: {
            blindId: toBase64Url(new TextEncoder().encode('bid:personas:p1')),
            collection: 'personas',
            rev: 12, // strictly higher than the existing watermark (1)
            deleted: false,
            nonce: toBase64Url(new Uint8Array([9, 9, 9])),
            ciphertext: toBase64Url(new Uint8Array([1, 2, 3])),
          },
        },
      ],
    }));

    await drainOutbox();

    const meta = await db.syncRows.get(['personas', 'p1']);
    expect(meta?.rev).toBe(12); // adopted — the heal
  });
});
