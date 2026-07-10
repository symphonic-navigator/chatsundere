// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
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
  setInvalidator,
} from '../../src/sync/apply.js';
import { getSyncState } from '../../src/sync/watermark.js';
import { _resetWorkerForTests, _setPullTransport, runPullLoop } from '../../src/sync/worker.js';

/**
 * Finding #2, client half: an adversarial/compromised server can serve a record
 * for a collection the client has never heard of (a poison page). The client
 * must not trust `pulled.collection` — a Dexie `db.table(collection)` lookup on
 * an unknown table throws `InvalidTableError`, and BEFORE this fix that throw
 * escaped `runPullLoop`'s per-record apply with no `catch`, wedging the pull
 * pipeline forever (the poison rev is re-served every cycle, watermark never
 * advances past it).
 */

// ===== Fixtures (mirror apply.test.ts / pull-unavailable.test.ts) =====

function fakeBlindId(collection: string, key: string): Uint8Array {
  return new TextEncoder().encode(`bid:${collection}:${key}`);
}

function pulledTombstone(collection: string, key: string, rev: number): SyncPulledRecord {
  return {
    blindId: toBase64Url(fakeBlindId(collection, key)),
    collection: collection as SyncCollection,
    rev,
    deleted: true,
  };
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

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  _setApplyComputeBlindId(async (_mk, collection, key) => fakeBlindId(collection, key));
  setInvalidator(() => undefined); // isolate from the shared queryClient
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

describe('applyRecord — unknown collection is guarded, not trusted (#2 client half)', () => {
  it('a pulled tombstone for an unknown collection resolves inertly, never throws', async () => {
    const outcome = await applyRecord(pulledTombstone('evil', 'x1', 5));
    // Nothing local ever existed for the never-registered "evil" table — the
    // guarded lookup finds no match, same inert outcome as any unmatched tombstone.
    expect(outcome).toEqual({ kind: 'tombstoned' });
  });
});

describe('runPullLoop — a poison record never wedges the pipeline (#2 client half)', () => {
  it('advances the watermark past an unknown-collection tombstone; a valid record after it still applies', async () => {
    const db = getClientDataDb();
    await db.chats.put({ id: 'c1', title: 'gone', createdAt: 1, updatedAt: 1 } as never);
    await db.syncRows.put({ collection: 'chats', key: 'c1', rev: 1, ciphertextHash: 'h' });

    const page: SyncPullResponse = {
      head: 6,
      epoch: 'E1',
      more: false,
      records: [
        pulledTombstone('evil', 'poison', 5), // unknown collection — must not wedge the loop
        pulledTombstone('chats', 'c1', 6), // a valid record AFTER the poison in the same page
      ],
    };
    _setPullTransport(async () => page);

    await expect(runPullLoop()).resolves.toBeUndefined(); // no throw escapes

    // The valid record after the poison one WAS applied (routed to trash).
    expect(await db.chats.get('c1')).toBeUndefined();
    const trash = await db.trash.get('chats:c1');
    expect(trash?.collection).toBe('chats');

    // The watermark advanced past BOTH records — the poison one never held it back.
    expect((await getSyncState()).watermarkRev).toBe(6);
  });

  it('catches ANY unexpected throw from applyRecord (not just the collection guard) and keeps paging', async () => {
    const db = getClientDataDb();
    let openCalls = 0;
    // Simulate a genuinely unexpected bug unrelated to the collection guard: the
    // decrypted row for the first record is malformed (null) — `extractKeyFor`
    // throws reading `.id` off it. Nothing in apply.ts's own try/catch covers
    // this step; only the pull loop's defence-in-depth wrapper does.
    _setApplyOpenRecord(async () => {
      openCalls += 1;
      if (openCalls === 1) return null;
      return { id: 'p2', updatedAt: 9 };
    });

    const page: SyncPullResponse = {
      head: 6,
      epoch: 'E1',
      more: false,
      records: [
        pulledUpsert('personas', 'p1', new Uint8Array([1]), 5), // triggers the unexpected throw
        pulledUpsert('personas', 'p2', new Uint8Array([2]), 6), // valid, applied after the crash
      ],
    };
    _setPullTransport(async () => page);

    await expect(runPullLoop()).resolves.toBeUndefined(); // no throw escapes

    expect(await db.personas.get('p2')).toBeDefined();
    expect((await getSyncState()).watermarkRev).toBe(6);
  });
});
