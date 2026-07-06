// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { toBase64Url } from '@chatsundere/crypto';
import type { SealedRecord } from '@chatsundere/crypto';
import type {
  SyncCollection,
  SyncPulledRecord,
  SyncPushRecord,
  SyncPushResponse,
} from '@chatsundere/shared-types';
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
  _resetApplyForTests,
  _setApplyComputeBlindId,
  _setApplyOpenRecord,
  applyRecord,
} from '../../src/sync/apply.js';
import { getSyncState } from '../../src/sync/watermark.js';
import {
  _resetWorkerForTests,
  _setCryptoDeps,
  _setPushTransport,
  drainOutbox,
} from '../../src/sync/worker.js';

// ===== Fixtures =====

/** Deterministic fake blind id — mirrors the fake crypto the sibling suites use. */
function fakeBlindId(collection: string, key: string): Uint8Array {
  return new TextEncoder().encode(`bid:${collection}:${key}`);
}

/** The apply pipeline's own local SHA-256 → base64url of ciphertext bytes (§7.0). */
async function localHash(ciphertext: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', ciphertext as BufferSource);
  return toBase64Url(new Uint8Array(digest));
}

function pulledUpsert(
  collection: string,
  key: string,
  ciphertext: Uint8Array,
  rev: number,
): SyncPulledRecord {
  return {
    blindId: toBase64Url(fakeBlindId(collection, key)),
    collection: collection as SyncCollection,
    rev,
    deleted: false,
    nonce: toBase64Url(new Uint8Array([1, 2, 3])),
    ciphertext: toBase64Url(ciphertext),
  };
}

/** Deterministic worker-side seal — no key material, mirrors worker.test. */
function fakeSealed(collection: string, key: string): SealedRecord {
  return {
    blindId: fakeBlindId(collection, key),
    envelopeVersion: 1,
    nonce: new Uint8Array([1, 2, 3]),
    ciphertext: new Uint8Array([9, 9]),
    ciphertextHash: new TextEncoder().encode(`hash:${collection}:${key}`),
  };
}

function installFakeCrypto(): void {
  _setApplyComputeBlindId(async (_mk, collection, key) => fakeBlindId(collection, key));
  _setCryptoDeps({
    computeBlindId: async (_mk, collection, key) => fakeBlindId(collection, key),
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
  _resetApplyForTests();
  _resetWorkerForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

// ===== §7.4 L-3 suppression durability (audit #3, #5) =====

describe('applyRecord — §7.4 L-3 suppression establishes the CAS base + records the rev', () => {
  it('writes the syncRows CAS base when suppressing a pulled upsert', async () => {
    const db = getClientDataDb();
    // A pending local delete for chats:K wins locally; the pulled insert is suppressed.
    await db.syncOutbox.add({ collection: 'chats', key: 'K', op: 'delete', enqueuedAt: 1 });
    _setApplyOpenRecord(async () => ({ id: 'K', title: 'x', createdAt: 1, updatedAt: 9 }));
    const ct = new Uint8Array([4, 5, 6]);

    const outcome = await applyRecord(pulledUpsert('chats', 'K', ct, 9));

    expect(outcome).toEqual({ kind: 'suppressed' });
    // Audit #3: the CAS base is now written, so a later drain finds meta and mints
    // the tombstone rather than dropping the pending delete on the L-4 no-meta guard.
    expect(await db.syncRows.get(['chats', 'K'])).toEqual({
      collection: 'chats',
      key: 'K',
      rev: 9,
      ciphertextHash: await localHash(ct),
    });
  });

  it('records the suppressed rev for the Undo rewind', async () => {
    const db = getClientDataDb();
    await db.syncOutbox.add({ collection: 'chats', key: 'K', op: 'delete', enqueuedAt: 1 });
    _setApplyOpenRecord(async () => ({ id: 'K', title: 'x', createdAt: 1, updatedAt: 9 }));

    const outcome = await applyRecord(pulledUpsert('chats', 'K', new Uint8Array([4, 5, 6]), 9));

    expect(outcome).toEqual({ kind: 'suppressed' });
    // Audit #5: the suppressed rev is recorded so a fast Undo can rewind the
    // watermark below it and re-pull the (now-restored) upsert.
    expect((await getSyncState()).suppressedRevs).toEqual({ 'chats:K': 9 });
  });

  it('drains the pending delete as a tombstone after a recovery cleared syncRows', async () => {
    const db = getClientDataDb();
    // The finding-#3 chain: a pending delete for chats:K survives a recovery that
    // cleared syncRows; the live upsert is pulled (suppressed, meta re-established);
    // the drain must now mint a tombstone rather than silently drop the deletion.
    await db.syncOutbox.add({ collection: 'chats', key: 'K', op: 'delete', enqueuedAt: 1 });

    // Simulate recovery step 2 (recovery.ts performRecovery): syncRows cleared,
    // watermark reset to 0.
    await db.syncRows.clear();
    await getSyncState();
    await db.syncState.update('state', { watermarkRev: 0 });

    // Pull K's live upsert → suppressed; the CAS base is re-established.
    _setApplyOpenRecord(async () => ({ id: 'K', title: 'x', createdAt: 1, updatedAt: 9 }));
    const outcome = await applyRecord(pulledUpsert('chats', 'K', new Uint8Array([4, 5, 6]), 9));
    expect(outcome).toEqual({ kind: 'suppressed' });

    // Drain against a stub push transport: the delete now finds meta and pushes a
    // DELETE record (previously the L-4 no-meta guard dropped it and pushed nothing).
    const push = vi.fn(async (_records: SyncPushRecord[]) => okResponse([10], 10));
    _setPushTransport(push);

    await drainOutbox();

    expect(push).toHaveBeenCalledTimes(1);
    const sent = push.mock.calls[0]?.[0] as SyncPushRecord[];
    expect(sent).toHaveLength(1);
    expect(sent[0]?.deleted).toBe(true);
    expect(sent[0]?.blindId).toBe(toBase64Url(fakeBlindId('chats', 'K')));
  });
});
