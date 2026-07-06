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
import {
  RecoveryAbortedError,
  _resetRecoveryForTests,
  _setRecoveryPull,
  _setRecoverySleep,
  runRecovery,
} from '../../src/sync/recovery.js';
import { checkEpoch, getSyncState, isRecovering } from '../../src/sync/watermark.js';
import {
  _resetWorkerForTests,
  _setPullTransport,
  _setPushTransport,
  runPullLoop,
} from '../../src/sync/worker.js';

// ===== Fixtures (mirror apply.test.ts / recovery.test.ts) =====

/** Deterministic fake blind id — mirrors the fake crypto the sync tests use. */
function fakeBlindId(collection: string, key: string): Uint8Array {
  return new TextEncoder().encode(`bid:${collection}:${key}`);
}

/** Build a pulled UPSERT wire record (body present) for the given collection/key. */
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
  _setRecoverySleep(async () => undefined); // no real backoff sleep in tests
  setInvalidator(() => undefined); // isolate from the shared queryClient
});

afterEach(async () => {
  _resetApplyForTests();
  _resetWorkerForTests();
  _resetRecoveryForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('pull loop — engine-availability abort (audit finding #1)', () => {
  it('aborts the page and holds the watermark when the MK vanishes mid-page', async () => {
    const db = getClientDataDb();

    // openRecord returns a fresh persona per call; AFTER rev 5 is decrypted the
    // session MK is nulled — as `closeAndForget()` would fire mid-pull. rev 5 has
    // already captured its MK, so it still lands; rev 6 then sees no MK.
    let openCalls = 0;
    _setApplyOpenRecord(async () => {
      openCalls += 1;
      const key = openCalls === 1 ? 'pA' : openCalls === 2 ? 'pB' : 'pC';
      if (openCalls === 1) useSessionStore.setState({ mk: null });
      return { id: key };
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

    // rev 5 landed; revs 6 and 7 did NOT.
    expect(await db.personas.get('pA')).toBeDefined();
    expect(await db.personas.get('pB')).toBeUndefined();
    expect(await db.personas.get('pC')).toBeUndefined();
    // The watermark held at the last durably-absorbed rev — NOT advanced past the
    // unapplied corpus (the server only serves rev > since, so 7 would be a loss).
    expect((await getSyncState()).watermarkRev).toBe(5);
    // No attention raised — engine loss is not a tamper/poison signal.
    expect((await getSyncState()).attention).toBeNull();
    // openRecord was reached exactly once (rev 6 aborted before decrypting).
    expect(openCalls).toBe(1);
  });

  it('applyRecord returns unavailable (not rejected) without an MK', async () => {
    useSessionStore.setState({ mk: null });
    const outcome = await applyRecord(pulledUpsert('personas', 'p1', new Uint8Array([1, 2, 3]), 5));
    expect(outcome.kind).toBe('unavailable');
  });
});

describe('recovery — engine-availability abort before the epoch persist (audit finding #1)', () => {
  it('recovery aborts before the epoch persist when the MK vanishes mid-pull-all', async () => {
    const db = getClientDataDb();
    await checkEpoch('E1'); // an epoch is already persisted from before recovery

    // The pull-all page carries two records; the MK vanishes after the first.
    let openCalls = 0;
    _setApplyOpenRecord(async () => {
      openCalls += 1;
      const key = openCalls === 1 ? 'rA' : 'rB';
      if (openCalls === 1) useSessionStore.setState({ mk: null });
      return { id: key };
    });

    _setRecoveryPull(async () => ({
      head: 6,
      epoch: 'E2',
      more: false,
      records: [
        pulledUpsert('personas', 'rA', new Uint8Array([1]), 5),
        pulledUpsert('personas', 'rB', new Uint8Array([2]), 6),
      ],
    }));
    // A push transport that would let a (buggy) recovery complete — the fix must
    // throw before ever reaching the drain, so this stays uncalled.
    _setPushTransport(async (records) => ({
      head: 0,
      epoch: 'E2',
      results: records.map((_r, i) => ({ status: 'ok', rev: i })),
    }));

    await expect(runRecovery()).rejects.toBeInstanceOf(RecoveryAbortedError);

    // Step 5 (epoch persist) was never reached — the epoch is UNCHANGED.
    expect((await getSyncState()).epoch).toBe('E1');
    // The recovering flag was cleared on the way out (the finally).
    expect(isRecovering()).toBe(false);
    // Only the first record decrypted before the abort.
    expect(openCalls).toBe(1);
    // The syncState singleton exists but no new epoch was written.
    expect(db).toBeDefined();
  });
});
