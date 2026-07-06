// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { SealedRecord } from '@chatsundere/crypto';
import type { BlobRef } from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { _resetApplyForTests } from '../../src/sync/apply.js';
import { _resetBlobRepairForTests } from '../../src/sync/blob-repair.js';
import {
  _resetWorkerForTests,
  _setBlobTransport,
  _setCryptoDeps,
  drainOutbox,
} from '../../src/sync/worker.js';

// Runs in the node env (like blob-drain.test.ts) for a real `structuredClone`
// that round-trips stored rows; the reference check reads a plain-object
// `blobRef`, which survives fake-indexeddb regardless.

/** A 22-char base64url blob id (the transport's `BLOB_ID_RE`). */
function id22(seed: string): string {
  return (seed + 'A'.repeat(22)).slice(0, 22);
}

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

/** blobIds passed to the delete transport this drain. */
let deleted: string[] = [];

function installBlobTransport(): void {
  _setBlobTransport({
    sealBlob: async () => ({ body: new Uint8Array([1, 2, 3, 4]), hash: new Uint8Array([9]) }),
    putBlob: async () => ({ status: 'created' }),
    deleteBlob: async (blobId) => {
      deleted.push(blobId);
    },
  });
}

async function addBlobDelete(collection: string, key: string, blobId: string): Promise<void> {
  await getClientDataDb().syncOutbox.add({
    // biome-ignore lint/suspicious/noExplicitAny: SyncCollection narrowed by callers
    collection: collection as any,
    key,
    op: 'blob-delete',
    blobId,
    enqueuedAt: Date.now(),
  });
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  installFakeCrypto();
  installBlobTransport();
  _resetBlobRepairForTests();
  deleted = [];
});

afterEach(async () => {
  _resetWorkerForTests();
  _resetApplyForTests();
  _resetBlobRepairForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('reference-aware phase-3 blob-delete gate (audit #6)', () => {
  it('drops a queued blob-delete whose id a live row still references', async () => {
    const db = getClientDataDb();
    const X = id22('ref1');
    const ref: BlobRef = { blobId: X, bytes: 12 };
    // A restore (Task 8) revived the same blobId under a NEW key. The queued
    // delete still names the DEAD old key — the M-2 gate cannot see this ref.
    await db.artefacts.put({
      id: 'a-live',
      title: 'Restored',
      blob: new Blob(['bytes']),
      blobRef: ref,
    } as never);
    await addBlobDelete('artefacts', 'a-old', X);

    await drainOutbox();

    // Never destroy the object a live row still references...
    expect(deleted).not.toContain(X);
    // ...and the delete is DROPPED (authoritatively alive), not retried.
    const rows = await db.syncOutbox.toArray();
    expect(rows.filter((r) => r.op === 'blob-delete' && r.blobId === X)).toHaveLength(0);
  });

  it('still executes an unreferenced blob-delete', async () => {
    const db = getClientDataDb();
    const X = id22('ref2');
    // No live artefacts row references X — the delete is genuinely orphaning.
    await db.artefacts.put({
      id: 'a-other',
      title: 'Unrelated',
      blob: new Blob(['bytes']),
      blobRef: { blobId: id22('other'), bytes: 12 },
    } as never);
    await addBlobDelete('artefacts', 'a-old', X);

    await drainOutbox();

    expect(deleted).toContain(X);
    const rows = await db.syncOutbox.toArray();
    expect(rows.filter((r) => r.op === 'blob-delete' && r.blobId === X)).toHaveLength(0);
  });
});
