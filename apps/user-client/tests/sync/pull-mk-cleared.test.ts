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
  resetBlindIdCycleCache,
  setInvalidator,
} from '../../src/sync/apply.js';
import { getSyncState } from '../../src/sync/watermark.js';
import {
  _resetWorkerForTests,
  _setPullTransport,
  _setPushTransport,
  runPullLoop,
} from '../../src/sync/worker.js';

/**
 * Task B5 (Workstream B, Finding #5) — a `closeAndForget()` (session lock/logout,
 * or a foreground 401) that interleaves with an in-flight `applyRecord` must
 * hold the watermark for the record it interrupted, not silently advance past
 * it. Before this fix, the post-decrypt blind-id re-check (`seal.ts`'s
 * `openRecord`, and the tombstone path's `findKeyByBlindId`) re-derives from the
 * raw MK buffer AFTER an await; a concurrent `closeAndForget()` zeroes that same
 * buffer in place (`session.ts`'s `close()`), so the re-check throws or silently
 * fails to match — surfacing as `{kind:'rejected'}` / `{kind:'tombstoned'}`
 * rather than `{kind:'unavailable'}`. Both of B1's already-landed guards (the
 * `apply.ts` decrypt-catch and `worker.ts`'s blanket `applyRecord` catch)
 * convert ANY throw to `{rejected}` and advance the watermark regardless — so
 * this fix must hold at the `runPullLoop` level, re-checking session liveness
 * after every record, not just inside `applyRecord`'s own guards.
 */

// ===== Fixtures (mirror pull-unavailable.test.ts / tombstone-resolution.test.ts) =====

function fakeBlindId(collection: string, key: string): Uint8Array {
  return new TextEncoder().encode(`bid:${collection}:${key}`);
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

function pulledTombstone(collection: string, key: string, rev: number): SyncPulledRecord {
  return {
    blindId: toBase64Url(fakeBlindId(collection, key)),
    collection: collection as SyncCollection,
    rev,
    deleted: true,
  };
}

/** A session mock with a real `close()` so `closeAndForget()` behaves like production. */
function seedLinkedOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useDiscoveryStore.setState({
    status: 'ok',
    // biome-ignore lint/suspicious/noExplicitAny: partial store shape for the test
    config: { syncUrl: 'https://sync.example', features: ['sync'] } as any,
  });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({
    session: { id: 'sess-1', accessToken: 'tok', close: () => undefined } as never,
    mk: {} as never,
  });
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  _setApplyComputeBlindId(async (_mk, collection, key) => fakeBlindId(collection, key));
  setInvalidator(() => undefined); // isolate from the shared queryClient
  resetBlindIdCycleCache();
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

describe('pull loop — hold the watermark when the MK is cleared mid-record (task B5)', () => {
  it('treats an MK-vanish during the post-decrypt open as unavailable, not rejected (apply.ts catch-site)', async () => {
    const db = getClientDataDb();

    // rev 5 opens normally. rev 6's mock simulates the real race: the AEAD await
    // has already resolved (the decrypt itself succeeded), but a concurrent
    // `closeAndForget()` zeroes the MK buffer before the post-decrypt blind-id
    // re-check — which then throws, exactly like seal.ts's real `openRecord`.
    let openCalls = 0;
    _setApplyOpenRecord(async () => {
      openCalls += 1;
      if (openCalls === 1) return { id: 'pA' };
      await Promise.resolve();
      useSessionStore.getState().closeAndForget();
      throw new Error('corrupted_data: blind id mismatch (simulated post-clear re-check)');
    });

    const page: SyncPullResponse = {
      head: 7,
      epoch: 'E1',
      more: false,
      records: [
        pulledUpsert('personas', 'pA', new Uint8Array([1]), 5),
        pulledUpsert('personas', 'pB', new Uint8Array([2]), 6),
        pulledUpsert('personas', 'pC', new Uint8Array([3]), 7),
      ],
    };
    _setPullTransport(async () => page);

    await runPullLoop();

    expect(await db.personas.get('pA')).toBeDefined(); // rev 5 landed
    expect(await db.personas.get('pB')).toBeUndefined(); // rev 6 threw — inert
    expect(await db.personas.get('pC')).toBeUndefined(); // rev 7 never attempted
    expect(openCalls).toBe(2); // the loop aborted at rev 6 — rev 7 unreached

    // THE assertion: the watermark holds at the last durably-absorbed rev, not
    // the falsely-rejected rev 6 or the never-attempted rev 7. A silent
    // `rejected`-with-advance would skip rev 6 forever (server only serves
    // rev > since).
    expect((await getSyncState()).watermarkRev).toBe(5);
    expect((await getSyncState()).attention).toBeNull();
  });

  it("treats an MK-vanish surfacing OUTSIDE applyRecord's own guards as unavailable (worker.ts blanket-catch site, B1)", async () => {
    const db = getClientDataDb();

    // rev 6's mock clears the session then returns a row `extractKeyFor` cannot
    // key (no `.id`) — a throw that escapes every try/catch INSIDE apply.ts and
    // is only caught by worker.ts's B1 blanket catch around `applyRecord`. This
    // proves the fix holds even when the throw does not originate at the
    // decrypt/open catch site B5's belt-and-braces guard also covers.
    let openCalls = 0;
    _setApplyOpenRecord(async () => {
      openCalls += 1;
      if (openCalls === 1) return { id: 'pA' };
      await Promise.resolve();
      useSessionStore.getState().closeAndForget();
      return null; // extractKeyFor('personas')(null) throws outside apply.ts's try/catch
    });

    const page: SyncPullResponse = {
      head: 7,
      epoch: 'E1',
      more: false,
      records: [
        pulledUpsert('personas', 'pA', new Uint8Array([1]), 5),
        pulledUpsert('personas', 'pB', new Uint8Array([2]), 6),
        pulledUpsert('personas', 'pC', new Uint8Array([3]), 7),
      ],
    };
    _setPullTransport(async () => page);

    await runPullLoop();

    expect(await db.personas.get('pA')).toBeDefined();
    expect(await db.personas.get('pB')).toBeUndefined();
    expect(await db.personas.get('pC')).toBeUndefined();
    expect(openCalls).toBe(2);
    expect((await getSyncState()).watermarkRev).toBe(5);
    expect((await getSyncState()).attention).toBeNull();
  });

  it('treats an MK-vanish during the tombstone blind-id re-derive as unavailable, not a silent no-op delete', async () => {
    const db = getClientDataDb();

    // A local chat with a CAS base — the steady-state stage-1 findKeyByBlindId
    // path. The tombstone SHOULD resolve to key 'K' and trash it, but the mock
    // simulates the MK vanishing mid-re-derive: session cleared, then a
    // deliberately WRONG blind id returned, so stage 1 finds no match — the
    // exact "silent no-op delete" the brief calls out as worse than the
    // decrypt-throw path (findKeyByBlindId re-derives after a Dexie await).
    await db.chats.put({ id: 'K', title: 'gone', createdAt: 1, updatedAt: 1 } as never);
    await db.syncRows.put({ collection: 'chats', key: 'K', rev: 2, ciphertextHash: 'h' });

    _setApplyComputeBlindId(async (_mk, collection, key) => {
      if (key === 'K') {
        useSessionStore.getState().closeAndForget();
        return new TextEncoder().encode('deliberately-wrong-bid');
      }
      return fakeBlindId(collection, key);
    });

    const page: SyncPullResponse = {
      head: 5,
      epoch: 'E1',
      more: false,
      records: [pulledTombstone('chats', 'K', 5)],
    };
    _setPullTransport(async () => page);
    _setPushTransport(async (records) => ({
      head: 0,
      epoch: 'E1',
      results: records.map((_r, i) => ({ status: 'ok', rev: i })),
    }));

    await runPullLoop();

    // The row was NOT silently orphaned — the tombstone was held, not dropped.
    expect(await db.chats.get('K')).toBeDefined();
    // The watermark did NOT advance past the falsely-unresolved tombstone: a
    // future cycle (once the session is restored) will re-fetch rev 5 and
    // correctly trash the row.
    expect((await getSyncState()).watermarkRev).toBe(0);
    expect((await getSyncState()).attention).toBeNull();
  });
});
