// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { SealedRecord } from '@chatsundere/crypto';
import { toBase64Url } from '@chatsundere/crypto';
import type { SyncCollection, SyncPullResponse, SyncPulledRecord } from '@chatsundere/shared-types';
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
import {
  _resetApplyForTests,
  _setApplyComputeBlindId,
  _setApplyOpenRecord,
  applyRecord,
} from '../../src/sync/apply.js';
import {
  _resetRecoveryForTests,
  _setRecoveryPull,
  _setRecoverySleep,
  runRecovery,
} from '../../src/sync/recovery.js';
import { _resetWorkerForTests, _setCryptoDeps, _setPushTransport } from '../../src/sync/worker.js';

// ===== Harness (mirrors recovery.test.ts + apply.test.ts) =====

function fakeBlindId(collection: string, key: string): Uint8Array {
  return new TextEncoder().encode(`bid:${collection}:${key}`);
}

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
  _setCryptoDeps({
    computeBlindId: async (_mk, collection, key) => fakeBlindId(collection, key),
    sealRecord: async (_mk, collection, key) => fakeSealed(collection, key),
  });
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

function emptyPull(epoch: string): SyncPullResponse {
  return { head: 0, epoch, more: false, records: [] };
}

/** A minimal user-created mindspace row (the seeded built-ins are `builtIn: true`). */
function userMindspace(id: string): unknown {
  return {
    id,
    displayName: 'Mine',
    palette: { accent: '#123456' },
    texture: 'cloudy',
    builtIn: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  installFakeCrypto();
  _setApplyComputeBlindId(async (_mk, collection, key) => fakeBlindId(collection, key));
  _setRecoverySleep(async () => undefined);
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

describe('built-in mindspaces never sync (engine spec §12.5, two-sided)', () => {
  it('enqueueFullRepush skips builtIn rows and enqueues user-created ones', async () => {
    const db = getClientDataDb();
    // `openClientDataDb` seeds the seven built-in mindspaces (builtIn: true); add
    // one more explicit built-in plus a user-created row so the filter is exercised.
    await db.mindspaces.add(userMindspace('user-created-id') as never);

    // Recovery pull-all delivers nothing; the drain THROWS so the freshly-enqueued
    // outbox rows are preserved for inspection (a successful drain would clear them).
    _setRecoveryPull(async () => emptyPull('E2'));
    _setPushTransport(async () => {
      throw new Error('halt drain to inspect the outbox');
    });
    await expect(runRecovery()).rejects.toThrow('halt drain');

    const keys = (await getClientDataDb().syncOutbox.toArray())
      .filter((r) => r.collection === 'mindspaces')
      .map((r) => r.key);
    expect(keys).toEqual(['user-created-id']);
  });

  it('a pulled builtIn mindspace record is ignored by the apply pipeline', async () => {
    const db = getClientDataDb();
    // The opened row carries `builtIn: true` — a device-local seed from elsewhere.
    _setApplyOpenRecord(async () => ({
      id: 'remote-builtin',
      displayName: 'Crimson',
      palette: { accent: '#b33a5e' },
      texture: 'cloudy',
      builtIn: true,
      createdAt: 1,
      updatedAt: 1,
    }));

    await applyRecord(pulledUpsert('mindspaces', 'remote-builtin', new Uint8Array([1]), 3));

    expect(await db.mindspaces.get('remote-builtin')).toBeUndefined();
  });
});
