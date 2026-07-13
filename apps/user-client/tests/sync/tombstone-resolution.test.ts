// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { toBase64Url } from '@chatsundere/crypto';
import type { SyncCollection, SyncPulledRecord } from '@chatsundere/shared-types';
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
  applyRecord,
  resetBlindIdCycleCache,
} from '../../src/sync/apply.js';
import { isDeadKey } from '../../src/sync/dead-keys.js';
import { _resetWorkerForTests } from '../../src/sync/worker.js';

// ===== Fixtures (mirror of tests/sync/apply.test.ts) =====

/** Deterministic fake blind id — mirrors the fake crypto the worker tests use. */
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

/** A tombstone whose blind id points at `keyForBlindId` but carries `collection`. */
function tombstoneForKey(collection: string, keyForBlindId: string, rev: number): SyncPulledRecord {
  return pulledTombstone(collection, keyForBlindId, rev);
}

function installFakeBlindId(): void {
  _setApplyComputeBlindId(async (_mk, collection, key) => fakeBlindId(collection, key));
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
  installFakeBlindId();
  resetBlindIdCycleCache();
});

afterEach(async () => {
  resetBlindIdCycleCache();
  _resetApplyForTests();
  _resetWorkerForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

// ===== Task 5 — findKeyByBlindId stage-2 local-key fallback (audit #4) =====

describe('findKeyByBlindId — stage-2 local-key fallback (audit #4)', () => {
  it('resolves a tombstone via local keys when syncRows is empty (recovery)', async () => {
    const db = getClientDataDb();
    // A local chat exists but recovery cleared syncRows — the classic recovery state.
    await db.chats.put({ id: 'K', title: 'gone', createdAt: 1, updatedAt: 1 } as never);
    expect(await db.syncRows.where('collection').equals('chats').count()).toBe(0);

    const outcome = await applyRecord(tombstoneForKey('chats', 'K', 5));

    expect(outcome).toEqual({ kind: 'tombstoned' });
    // The row moved to trash (resolved by the stage-2 fallback), not left orphaned.
    expect(await db.chats.get('K')).toBeUndefined();
    const trash = await db.trash.get('chats:K');
    expect(trash?.collection).toBe('chats');
    expect(await isDeadKey('chats', 'K')).toBe(true);
  });

  it('resolves tombstones for non-repush collections during recovery', async () => {
    const db = getClientDataDb();
    // attachments is excluded from REPUSH_COLLECTIONS, so during recovery these were
    // never cleaned up before this fix — no syncRows meta, no repush to re-mint one.
    await db.attachments.put({
      id: 'att1',
      chatId: 'c1',
      messageId: 'm1',
      updatedAt: 1,
      blobRef: { blobId: 'attAAAAAAAAAAAAAAAAAAA', bytes: 40 },
    } as never);
    expect(await db.syncRows.where('collection').equals('attachments').count()).toBe(0);

    const outcome = await applyRecord(tombstoneForKey('attachments', 'att1', 7));

    expect(outcome).toEqual({ kind: 'tombstoned' });
    expect(await db.attachments.get('att1')).toBeUndefined();
    expect(await db.trash.get('attachments:att1')).toBeDefined();
    expect(await isDeadKey('attachments', 'att1')).toBe(true);
  });

  it('still no-ops for a genuinely unknown blind id', async () => {
    const db = getClientDataDb();
    // Empty syncRows AND no matching local row → nothing to remove.
    const outcome = await applyRecord(tombstoneForKey('chats', 'never-existed', 5));

    expect(outcome).toEqual({ kind: 'tombstoned' });
    expect(await db.trash.count()).toBe(0);
    expect(await isDeadKey('chats', 'never-existed')).toBe(false);
  });

  it('steady state stays on stage 1 (no local enumeration when syncRows hits)', async () => {
    const db = getClientDataDb();
    await db.chats.put({ id: 'K', title: 'gone', createdAt: 1, updatedAt: 1 } as never);
    await db.syncRows.put({ collection: 'chats', key: 'K', rev: 2, ciphertextHash: 'h' });

    // stage 2's ONLY table-enumeration entry point is `db.table(collection).toCollection()`.
    // A stage-1 hit must never reach it.
    const table = db.table('chats');
    const spy = vi.spyOn(table, 'toCollection');

    const outcome = await applyRecord(tombstoneForKey('chats', 'K', 5));

    expect(outcome).toEqual({ kind: 'tombstoned' });
    expect(await db.chats.get('K')).toBeUndefined();
    expect(spy).not.toHaveBeenCalled(); // resolved on stage 1 — never enumerated the table
  });
});

// ===== Task B3 — stage-1 per-cycle memoisation (MEDIUM-3) =====

describe('findKeyByBlindId — stage-1 per-cycle memoisation (Task B3)', () => {
  it('derives each syncRows meta blind id at most once per cycle, not once per tombstone', async () => {
    const db = getClientDataDb();

    // M=20 syncRows metas, none of which the N=5 tombstones below will match —
    // a guaranteed stage-1 miss on every lookup, so the UNMEMOISED baseline
    // scans all M metas on EVERY one of the N lookups (N×M = 100 derivations).
    // No local rows are seeded for 'chats', so stage 2's fallback enumerates an
    // empty table and contributes zero extra derivations either way — the count
    // below isolates stage 1's behaviour cleanly.
    const M = 20;
    const N = 5;
    for (let i = 0; i < M; i++) {
      await db.syncRows.put({ collection: 'chats', key: `k${i}`, rev: 1, ciphertextHash: 'h' });
    }

    let deriveCalls = 0;
    _setApplyComputeBlindId(async (_mk, collection, key) => {
      deriveCalls += 1;
      return fakeBlindId(collection, key);
    });

    for (let i = 0; i < N; i++) {
      const outcome = await applyRecord(tombstoneForKey('chats', `ghost${i}`, i + 1));
      expect(outcome).toEqual({ kind: 'tombstoned' }); // no match — no-op, as before
    }

    // Memoised: the first miss caches all M metas' blind ids; the remaining
    // N-1 lookups reuse the cache and derive nothing new. Ceiling per the brief:
    // at most M (+N for genuinely new/uncached keys) — nowhere near N×M.
    expect(deriveCalls).toBeLessThanOrEqual(M + N);
  });
});
