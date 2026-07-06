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
import type { SyncOutboxRow } from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { isDeadKey } from '../../src/sync/dead-keys.js';
import {
  _resetWorkerForTests,
  _setCryptoDeps,
  _setPushTransport,
  drainOutbox,
} from '../../src/sync/worker.js';

// The cycle-start server-identity guard (Task 4) reads the crypto DB's linked
// account; these tests exercise the drain's coalesce-degrade path only, so it is
// stubbed inert (no account linked → the guard never fires).
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

async function outbox(): Promise<SyncOutboxRow[]> {
  return getClientDataDb().syncOutbox.toArray();
}

/** A push response with one `ok` result per record unless overridden. */
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

describe('drainOutbox — coalesce degrade (audit #2)', () => {
  it('pushes a tombstone when a queued delete was followed by an upsert of a vanished row', async () => {
    const db = getClientDataDb();
    // The server knows the row (rev 3); the local `chats` row is already gone.
    await db.syncRows.put({ collection: 'chats', key: 'k1', rev: 3, ciphertextHash: 'h' });
    await addOutbox('chats', 'k1', 'delete'); // seq 1
    await addOutbox('chats', 'k1', 'upsert'); // seq 2 — a background job's no-op upsert raced in

    const push = vi.fn(async (_records: SyncPushRecord[]) => okResponse([4], 4));
    _setPushTransport(push);

    await drainOutbox();

    // Last-op-wins would have made this an upsert and dropped it (row gone); the
    // truthful push is the tombstone at the server's known baseRev.
    expect(push).toHaveBeenCalledTimes(1);
    const sent = push.mock.calls[0]?.[0] as SyncPushRecord[];
    expect(sent).toHaveLength(1);
    expect(sent[0]?.deleted).toBe(true);
    expect(sent[0]?.ciphertext).toBeUndefined();
    expect(sent[0]?.baseRev).toBe(3);
    expect(sent[0]?.blindId).toBe(toBase64Url(new TextEncoder().encode('bid:chats:k1')));

    // Both covered seqs cleared on the `ok` ack, and the key is marked dead.
    expect(await outbox()).toHaveLength(0);
    expect(await db.syncRows.get(['chats', 'k1'])).toBeUndefined();
    expect(await isDeadKey('chats', 'k1')).toBe(true);
  });

  it('still drops a pure upsert of a vanished row (no queued delete)', async () => {
    const db = getClientDataDb();
    await db.syncRows.put({ collection: 'chats', key: 'k1', rev: 3, ciphertextHash: 'h' });
    await addOutbox('chats', 'k1', 'upsert'); // row does not exist locally

    const push = vi.fn(async () => okResponse([], 0));
    _setPushTransport(push);

    await drainOutbox();

    expect(push).not.toHaveBeenCalled();
    expect(await outbox()).toHaveLength(0);
  });

  it('still drops a delete the server never knew (L-4)', async () => {
    // No syncRows meta → the server never stored this row; minting a tombstone
    // would be a bogus baseRev-0 push that deletes nothing.
    await addOutbox('chats', 'k1', 'delete');

    const push = vi.fn(async () => okResponse([], 0));
    _setPushTransport(push);

    await drainOutbox();

    expect(push).not.toHaveBeenCalled();
    expect(await outbox()).toHaveLength(0);
  });

  it('does not tombstone a delete+upsert group the server never knew (L-4, degrade half)', async () => {
    // No meta, and the row is gone: the degrade branch must still honour the L-4
    // meta guard — a delete of a never-known row is a truthful no-op, not a push.
    await addOutbox('chats', 'k1', 'delete'); // seq 1
    await addOutbox('chats', 'k1', 'upsert'); // seq 2

    const push = vi.fn(async () => okResponse([], 0));
    _setPushTransport(push);

    await drainOutbox();

    expect(push).not.toHaveBeenCalled();
    expect(await outbox()).toHaveLength(0);
  });

  it('keeps distinct keys in separate groups (separator sanity)', async () => {
    const db = getClientDataDb();
    await db.chats.put({ id: 'k1', title: 'a', updatedAt: 1 } as never);
    await db.chats.put({ id: 'k2', title: 'b', updatedAt: 1 } as never);
    await addOutbox('chats', 'k1', 'upsert');
    await addOutbox('chats', 'k2', 'upsert');

    const push = vi.fn(async (_records: SyncPushRecord[]) => okResponse([1, 2], 2));
    _setPushTransport(push);

    await drainOutbox();

    expect(push).toHaveBeenCalledTimes(1);
    const sent = push.mock.calls[0]?.[0] as SyncPushRecord[];
    expect(sent).toHaveLength(2); // two separate records, not merged into one group
  });
});
