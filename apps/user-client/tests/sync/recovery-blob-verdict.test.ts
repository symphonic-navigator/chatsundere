// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// Node env: real `Blob` bytes survive fake-indexeddb's structuredClone and
// expose `arrayBuffer()` (jsdom's do not) — mirrors recovery-blob-records.test.ts.
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
import { getSyncState } from '../../src/sync/watermark.js';
import { _resetWorkerForTests, _setCryptoDeps, _setPushTransport } from '../../src/sync/worker.js';

/**
 * Task B7 (#6b) — `recoverBlobs` must not discard the typed `PutBlobResult`
 * verdict from a re-upload. Before this fix the loop called `deps.putBlob(...)`
 * and threw the result away, so `performRecovery` persisted the new epoch
 * UNCONDITIONALLY even when a re-upload hit `quota_exceeded` / `blob_too_large`
 * / `blobs_disabled` (bytes never landed — false convergence), and a
 * `blob_exists` verdict (the spec's tamper/divergence signal) vanished with no
 * attention raised at all.
 */

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

/** A push transport that acks every record `ok` under the given epoch. */
function okPushTransport(epoch: string, sink?: SyncPushRecord[][]) {
  return async (records: SyncPushRecord[]) => {
    sink?.push(records);
    return {
      head: 10,
      epoch,
      results: records.map((_r, i) => ({ status: 'ok' as const, rev: 10 + i })),
    };
  };
}

async function seedArtefact(id: string, blobId: string, body: string): Promise<void> {
  await getClientDataDb().artefacts.put({
    id,
    title: id,
    blob: new Blob([body]),
    blobRef: { blobId, bytes: body.length },
  } as never);
}

/**
 * Seed the persisted epoch as a REAL recovery trigger would find it: a genuine
 * mismatch (e.g. `E1`) against what the server now reports (`E2`), not the
 * never-observed-yet "first" case. `checkEpoch` (watermark.ts) only persists on
 * its `'first'` branch (`state.epoch === null`); a fresh test db without this
 * seed would let step 4's ordinary drain silently persist the epoch on its own
 * via that branch, masking whether the step-5 withhold this suite targets
 * actually held.
 */
async function seedEpoch(epoch: string): Promise<void> {
  await getSyncState();
  await getClientDataDb().syncState.update('state', { epoch });
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

describe('recoverBlobs — honours typed PUT verdicts (#6b)', () => {
  it.each([
    ['quota_exceeded', { status: 'quota_exceeded' as const, usedBytes: 10, quotaBytes: 5 }],
    ['blobs_disabled', { status: 'blobs_disabled' as const }],
  ])(
    'withholds the step-5 epoch persist when a re-upload verdict is %s',
    async (_label, verdict) => {
      await seedArtefact('a1', 'blob-1', 'artefact image bytes');
      await seedEpoch('E1');
      _setRecoveryPull(async () => emptyPull('E2'));
      _setPushTransport(okPushTransport('E2'));
      _setRecoveryBlobDeps({
        listBlobs: async () => ({ blobs: [], totalBytes: 0, quotaBytes: 1_000_000_000 }),
        sealBlob: async (_mk, blobId) => ({
          body: new TextEncoder().encode(`sealed:${blobId}`),
          hash: new TextEncoder().encode(`hash:${blobId}`),
        }),
        putBlob: async () => verdict,
      });

      await runRecovery();

      // The bytes never landed server-side — persisting here would be false
      // convergence. The epoch stays at its PRE-recovery value (still
      // mismatched) so the next authenticated mismatch re-runs recovery and
      // retries the PUT.
      expect((await getSyncState()).epoch).toBe('E1');
    },
  );

  it('recovers on a subsequent run once the re-upload lands', async () => {
    await seedArtefact('a1', 'blob-1', 'artefact image bytes');
    await seedEpoch('E1');
    _setRecoveryPull(async () => emptyPull('E2'));
    _setPushTransport(okPushTransport('E2'));

    // First recovery: quota_exceeded — withheld.
    _setRecoveryBlobDeps({
      listBlobs: async () => ({ blobs: [], totalBytes: 0, quotaBytes: 1_000_000_000 }),
      sealBlob: async (_mk, blobId) => ({
        body: new TextEncoder().encode(`sealed:${blobId}`),
        hash: new TextEncoder().encode(`hash:${blobId}`),
      }),
      putBlob: async () => ({ status: 'quota_exceeded' as const }),
    });
    await runRecovery();
    expect((await getSyncState()).epoch).toBe('E1');

    // Second recovery: the quota clears — the re-upload lands and the epoch persists.
    _setRecoveryBlobDeps({
      listBlobs: async () => ({ blobs: [], totalBytes: 0, quotaBytes: 1_000_000_000 }),
      sealBlob: async (_mk, blobId) => ({
        body: new TextEncoder().encode(`sealed:${blobId}`),
        hash: new TextEncoder().encode(`hash:${blobId}`),
      }),
      putBlob: async () => ({ status: 'created' as const }),
    });
    await runRecovery();
    expect((await getSyncState()).epoch).toBe('E2');
  });

  it('raises a tamper-class attention on a blob_exists verdict, but still converges', async () => {
    await seedArtefact('a1', 'blob-1', 'artefact image bytes');
    await seedEpoch('E1');
    _setRecoveryPull(async () => emptyPull('E2'));
    _setPushTransport(okPushTransport('E2'));
    _setRecoveryBlobDeps({
      listBlobs: async () => ({ blobs: [], totalBytes: 0, quotaBytes: 1_000_000_000 }),
      sealBlob: async (_mk, blobId) => ({
        body: new TextEncoder().encode(`sealed:${blobId}`),
        hash: new TextEncoder().encode(`hash:${blobId}`),
      }),
      putBlob: async () => ({ status: 'blob_exists' as const }),
    });

    await runRecovery();

    // The tamper signal is surfaced — never silently lost (the core #6b fix).
    expect((await getSyncState()).attention).toEqual({ kind: 'tamper' });
    // Unlike quota/too-large/disabled, a lone 409 does not itself withhold the
    // epoch persist — the attention is the durable, sticky signal a human acts
    // on; recovery is not expected to spin retrying an id the server insists it
    // already holds under different bytes.
    expect((await getSyncState()).epoch).toBe('E2');
  });
});

describe('recoverBlobs — raises user-visible attention parity with the drain path (review B7 #1)', () => {
  it('raises the quota_exceeded attention on a quota verdict, mirroring the drain path', async () => {
    await seedArtefact('a1', 'blob-1', 'artefact image bytes');
    await seedEpoch('E1');
    _setRecoveryPull(async () => emptyPull('E2'));
    _setPushTransport(okPushTransport('E2'));
    _setRecoveryBlobDeps({
      listBlobs: async () => ({ blobs: [], totalBytes: 0, quotaBytes: 1_000_000_000 }),
      sealBlob: async (_mk, blobId) => ({
        body: new TextEncoder().encode(`sealed:${blobId}`),
        hash: new TextEncoder().encode(`hash:${blobId}`),
      }),
      putBlob: async () => ({ status: 'quota_exceeded' as const, usedBytes: 10, quotaBytes: 5 }),
    });

    await runRecovery();

    // Before the fix, a quota verdict during recovery re-upload set
    // `allLanded = false` and raised NOTHING — the user had no clue why sync
    // stopped converging, unlike the drain path's persistent banner for the
    // identical verdict.
    expect((await getSyncState()).attention).toEqual({
      kind: 'quota_exceeded',
      usedBytes: 10,
      quotaBytes: 5,
    });
  });
});

/**
 * Re-review B7 — the PREVIOUS fix made `blob_too_large` (413) raise the
 * `record_too_large` attention AND withhold the epoch, treating it as a
 * transient failure. That was wrong: `record_too_large` is only ever cleared
 * by the terminal-sentinel sweep in `applyOk` (worker.ts), keyed to a
 * `syncOutbox` row this re-upload path never creates — the banner would stick
 * forever (or be falsely cleared by an unrelated oversized record). And
 * withholding the epoch for a genuinely oversized blob retries the same
 * unfittable candidate every recovery cycle — an infinite loop. The correct
 * behaviour mirrors the drain path's own 413 handling (`oversizeSentinel`,
 * blob-repair.ts): durably exclude the blob (the sentinel this function's own
 * skip-check already honours), raise no banner, and never withhold the epoch.
 */
describe('recoverBlobs — blob_too_large is a durable terminal exclusion, not a withheld retry (re-review B7)', () => {
  it('durably sets the oversized sentinel, raises no attention, and does not withhold the epoch', async () => {
    await seedArtefact('a1', 'blob-1', 'artefact image bytes');
    await seedEpoch('E1');
    _setRecoveryPull(async () => emptyPull('E2'));
    _setPushTransport(okPushTransport('E2'));
    _setRecoveryBlobDeps({
      listBlobs: async () => ({ blobs: [], totalBytes: 0, quotaBytes: 1_000_000_000 }),
      sealBlob: async (_mk, blobId) => ({
        body: new TextEncoder().encode(`sealed:${blobId}`),
        hash: new TextEncoder().encode(`hash:${blobId}`),
      }),
      putBlob: async () => ({ status: 'blob_too_large' as const, maxBlobBytes: 1 }),
    });

    await runRecovery();

    // (1) the durable sentinel lands on the OWNING row.
    const row = await getClientDataDb().artefacts.get('a1');
    expect((row as { blobOversized?: boolean } | undefined)?.blobOversized).toBe(true);

    // (2) no banner — genuine parity, the drain path raises none for its own 413.
    expect((await getSyncState()).attention).toBeNull();

    // (3) a terminally-excluded blob must never withhold the epoch, or recovery
    // would spin retrying an unfittable candidate forever.
    expect((await getSyncState()).epoch).toBe('E2');
  });

  it('skips the terminally-excluded blob on a subsequent recovery run instead of retrying it', async () => {
    await seedArtefact('a1', 'blob-1', 'artefact image bytes');
    await seedEpoch('E1');
    _setRecoveryPull(async () => emptyPull('E2'));
    _setPushTransport(okPushTransport('E2'));
    let listCalls = 0;
    let putCalls = 0;
    _setRecoveryBlobDeps({
      listBlobs: async () => {
        listCalls += 1;
        return { blobs: [], totalBytes: 0, quotaBytes: 1_000_000_000 };
      },
      sealBlob: async (_mk, blobId) => ({
        body: new TextEncoder().encode(`sealed:${blobId}`),
        hash: new TextEncoder().encode(`hash:${blobId}`),
      }),
      putBlob: async () => {
        putCalls += 1;
        return { status: 'blob_too_large' as const, maxBlobBytes: 1 };
      },
    });

    await runRecovery();
    expect(putCalls).toBe(1);
    expect(listCalls).toBe(1);

    // A fresh mismatch re-triggers recovery; the candidate is now excluded by
    // its own sentinel, so `recoverBlobs` never even reaches the inventory
    // round-trip — no second re-upload attempt.
    await seedEpoch('E1');
    await runRecovery();
    expect(putCalls).toBe(1);
    expect(listCalls).toBe(1);
  });
});
