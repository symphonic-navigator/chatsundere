// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { SealedRecord } from '@chatsundere/crypto';
import type { SyncPushRecord, SyncPushResponse } from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SyncOutboxRow } from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { getSyncState } from '../../src/sync/watermark.js';
import {
  _resetWorkerForTests,
  _setCryptoDeps,
  _setPushTransport,
  drainOutbox,
} from '../../src/sync/worker.js';

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

/** A push result refusing the record as permanently too large (§11.3). */
function tooLargeResponse(): SyncPushResponse {
  return { head: 0, epoch: 'E1', results: [{ status: 'error', code: 'record_too_large' }] };
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

describe('terminal refusal (record_too_large)', () => {
  it('marks the outbox entry terminal and skips it on the next drain', async () => {
    const db = getClientDataDb();
    await db.chats.put({ id: 'c1', title: 'huge', updatedAt: 1 } as never);
    await addOutbox('chats', 'c1', 'upsert');
    _setPushTransport(async () => tooLargeResponse());

    await drainOutbox();

    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.terminal).toBe(true);

    // The attention state raised by applyError is preserved.
    const state = await getSyncState();
    expect(state.attention?.kind).toBe('record_too_large');

    // A terminal entry must never enter a drain phase again.
    let pushed = 0;
    _setPushTransport(async (records: SyncPushRecord[]) => {
      pushed += records.length;
      throw new Error('no push expected for a terminal entry');
    });
    await drainOutbox();
    expect(pushed).toBe(0);
  });

  it('applyOk clears leftover terminal entries for the same key on a later successful push', async () => {
    const db = getClientDataDb();
    await db.chats.put({ id: 'c1', title: 'smaller', updatedAt: 2 } as never);
    // A stale terminal sentinel from an earlier oversize refusal…
    await db.syncOutbox.add({
      // biome-ignore lint/suspicious/noExplicitAny: SyncCollection narrowed here
      collection: 'chats' as any,
      key: 'c1',
      op: 'upsert',
      enqueuedAt: Date.now(),
      terminal: true,
    });
    // …plus a fresh, non-terminal edit of the same key (the user shrank it).
    await addOutbox('chats', 'c1', 'upsert');

    _setPushTransport(async () => ({ head: 3, epoch: 'E1', results: [{ status: 'ok', rev: 3 }] }));

    await drainOutbox();

    const remaining = await db.syncOutbox.where('[collection+key]').equals(['chats', 'c1']).count();
    expect(remaining).toBe(0);
  });
});
