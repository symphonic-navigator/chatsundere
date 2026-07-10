// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// Node env: real `Blob` bytes survive fake-indexeddb's structuredClone and
// expose `arrayBuffer()` (jsdom's do not) — mirrors blob-reupload-confirm.test.ts.
import 'fake-indexeddb/auto';
import type { SealedRecord } from '@chatsundere/crypto';
import type { SyncPullResponse, SyncPushRecord } from '@chatsundere/shared-types';
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
import {
  _resetRecoveryForTests,
  _setRecoveryBlobDeps,
  _setRecoveryPull,
  _setRecoverySleep,
  runRecovery,
} from '../../src/sync/recovery.js';
import { _resetWorkerForTests, _setCryptoDeps, _setPushTransport } from '../../src/sync/worker.js';

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

describe('runRecovery — blob-collection records re-push (#6a)', () => {
  it('re-enqueues personaAvatars/artefacts/attachments rows, AFTER the blob byte re-upload', async () => {
    const db = getClientDataDb();

    // A local avatar whose bytes this device still holds, and a matching ref —
    // the epoch reset dropped the server's record channel, so the row's
    // blindId/rev in `syncRows` is gone too (step 2 clears it either way).
    await db.personaAvatars.add({
      personaId: 'p1',
      blob: new Blob(['avatar-bytes']),
      blobRef: { blobId: 'blob-1', bytes: 41 },
      mime: 'image/jpeg',
      width: 10,
      height: 10,
      crop: { x: 0, y: 0, zoom: 1 },
      updatedAt: 100,
    } as never);
    // A plain (non-blob) collection row too, to prove the general re-push still runs.
    await db.personas.add({ id: 'per1', name: 'Ada', updatedAt: 100 } as never);

    _setRecoveryPull(async () => emptyPull('E2'));

    const order: string[] = [];

    // The server inventory lost the avatar's bytes — recoverBlobs() must re-PUT it.
    _setRecoveryBlobDeps({
      listBlobs: async () => ({ blobs: [], totalBytes: 0, quotaBytes: 1_000_000_000 }),
      sealBlob: async (_mk, blobId) => ({
        body: new TextEncoder().encode(`sealed:${blobId}`),
        hash: new TextEncoder().encode(`hash:${blobId}`),
      }),
      putBlob: async (blobId) => {
        order.push(`blob-upload:${blobId}`);
        return { status: 'created' };
      },
    });

    const pushed: SyncPushRecord[][] = [];
    _setPushTransport(async (records) => {
      for (const r of records) {
        if (r.collection === 'personaAvatars') order.push('record-push:personaAvatars');
      }
      pushed.push(records);
      return {
        head: 10,
        epoch: 'E2',
        results: records.map((_r, i) => ({ status: 'ok', rev: 10 + i })),
      };
    });

    await runRecovery();

    // The blob-collection row WAS re-enqueued and pushed (the bug: it was
    // filtered out of REPUSH_COLLECTIONS and never re-included). Only this
    // one row exists in `personaAvatars`, so matching by collection alone
    // identifies it — the wire record itself carries only the blind index,
    // never the plaintext key.
    const avatarRec = pushed.flat().find((r) => r.collection === 'personaAvatars');
    expect(avatarRec).toBeDefined();

    // The general re-push still covers ordinary collections.
    const personaRec = pushed.flat().find((r) => r.collection === 'personas');
    expect(personaRec).toBeDefined();

    // Ordering (§11.5): the blob bytes land server-side BEFORE the record
    // naming that blobId is pushed.
    expect(order).toEqual(['blob-upload:blob-1', 'record-push:personaAvatars']);

    // Outbox fully drained — no leftover entries from either re-push pass.
    expect(await db.syncOutbox.count()).toBe(0);
  });
});
