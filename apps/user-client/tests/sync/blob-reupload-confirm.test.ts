// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { MasterKey, SealedRecord } from '@chatsundere/crypto';
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
import {
  _resetRecoveryForTests,
  _setRecoveryBlobDeps,
  _setRecoveryPull,
  _setRecoverySleep,
  confirmBlobReupload,
  runRecovery,
} from '../../src/sync/recovery.js';
import { getSyncState, setAttention } from '../../src/sync/watermark.js';
import { _resetWorkerForTests, _setCryptoDeps, _setPushTransport } from '../../src/sync/worker.js';

/**
 * Task 6 (audit #7) — the `blob_reupload_threshold` answer path. Above the
 * per-recovery re-upload threshold the automatic recovery ASKS and uploads
 * nothing; `confirmBlobReupload()` is the user-invokable answer that re-runs the
 * inventory diff and uploads regardless of size, clearing the attention on
 * success. Node env: real `Blob` bytes survive fake-indexeddb's structuredClone
 * and expose `arrayBuffer()` (jsdom's do not), mirroring blob-scenarios.test.ts.
 */

const MK = {} as MasterKey;
const enc = new TextEncoder();

/** A 22-char base64url blob id (the transport's `BLOB_ID_RE` shape). */
function id22(seed: string): string {
  return (seed + 'A'.repeat(22)).slice(0, 22);
}

/** A deterministic, IO-free blob seal for the re-upload loop. */
async function sealBlobFake(
  _mk: MasterKey,
  _blobId: string,
  bytes: Uint8Array,
): Promise<{ body: Uint8Array; hash: Uint8Array }> {
  return { body: bytes, hash: new Uint8Array([1]) };
}

function fakeSealed(collection: string, key: string): SealedRecord {
  return {
    blindId: enc.encode(`bid:${collection}:${key}`),
    envelopeVersion: 1,
    nonce: new Uint8Array([1, 2, 3]),
    ciphertext: new Uint8Array([9, 9]),
    ciphertextHash: enc.encode(`hash:${collection}:${key}`),
  };
}

function installFakeCrypto(): void {
  _setCryptoDeps({
    computeBlindId: async (_mk, collection, key) => enc.encode(`bid:${collection}:${key}`),
    sealRecord: async (_mk, collection, key) => fakeSealed(collection, key),
  });
}

function seedLinkedOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useDiscoveryStore.setState({
    status: 'ok',
    // biome-ignore lint/suspicious/noExplicitAny: partial discovery-config shape for the test.
    config: { syncUrl: 'https://sync.example', features: ['sync'] } as any,
  });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: MK as never });
}

/** An empty pull page reporting a given epoch (the fresh-reset server case). */
function emptyPull(epoch: string): SyncPullResponse {
  return { head: 0, epoch, more: false, records: [] };
}

/** Seed an artefact carrying local `Blob` bytes plus its persisted ref. */
async function seedArtefact(id: string, blobId: string, body: string): Promise<void> {
  await getClientDataDb().artefacts.put({
    id,
    title: id,
    blob: new Blob([body]),
    blobRef: { blobId, bytes: body.length },
  } as never);
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
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
});

describe('confirmBlobReupload — the blob_reupload_threshold answer path (audit #7)', () => {
  it('uploads every missing blob and clears the attention when forced', async () => {
    const ID1 = id22('one');
    const ID2 = id22('two');
    await seedArtefact('a1', ID1, 'image one bytes');
    await seedArtefact('a2', ID2, 'image two bytes');

    const puts: string[] = [];
    // A 1-byte threshold: any real image is "large" — the automatic path would ask.
    _setRecoveryBlobDeps(
      {
        listBlobs: async () => ({ blobs: [], totalBytes: 0, quotaBytes: 0 }), // server lost both
        putBlob: async (blobId) => {
          puts.push(blobId);
          return { status: 'created' };
        },
        sealBlob: sealBlobFake,
      },
      1,
    );

    // The state `performRecovery` would have left after asking.
    await setAttention({ kind: 'blob_reupload_threshold', bytes: 30, count: 2 });

    await confirmBlobReupload();

    expect(puts).toContain(ID1);
    expect(puts).toContain(ID2);
    expect(puts).toHaveLength(2);
    expect((await getSyncState()).attention).toBeNull();
  });

  it('keeps the attention when an upload fails', async () => {
    const ID1 = id22('ok');
    const ID2 = id22('boom');
    await seedArtefact('a1', ID1, 'image one bytes');
    await seedArtefact('a2', ID2, 'image two bytes');

    _setRecoveryBlobDeps(
      {
        listBlobs: async () => ({ blobs: [], totalBytes: 0, quotaBytes: 0 }),
        putBlob: async (blobId) => {
          if (blobId === ID2) throw new Error('upload failed mid re-upload');
          return { status: 'created' };
        },
        sealBlob: sealBlobFake,
      },
      1,
    );

    await setAttention({ kind: 'blob_reupload_threshold', bytes: 30, count: 2 });

    await expect(confirmBlobReupload()).rejects.toThrow('upload failed');
    // A failed upload leaves the ask in place — nothing to click away yet.
    expect((await getSyncState()).attention).toMatchObject({ kind: 'blob_reupload_threshold' });
  });

  it('performRecovery still asks (uploads nothing) above the threshold — force does not leak', async () => {
    await seedArtefact('a1', id22('auto'), 'some image bytes over the tiny threshold');

    _setRecoveryPull(async () => emptyPull('E2'));
    _setPushTransport(async (records) => ({
      head: 0,
      epoch: 'E2',
      results: records.map((_r, i) => ({ status: 'ok', rev: i })),
    }));
    const puts = vi.fn(async (blobId: string) => {
      void blobId;
      return { status: 'created' as const };
    });
    _setRecoveryBlobDeps(
      {
        listBlobs: async () => ({ blobs: [], totalBytes: 0, quotaBytes: 0 }),
        putBlob: puts,
        sealBlob: sealBlobFake,
      },
      1,
    );

    await runRecovery();

    expect(puts).not.toHaveBeenCalled(); // it asked first — uploaded nothing
    expect((await getSyncState()).attention).toMatchObject({ kind: 'blob_reupload_threshold' });
  });
});
