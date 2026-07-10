// SPDX-License-Identifier: AGPL-3.0-only
import { sealBlob, toBase64Url } from '@chatsundere/crypto';
import type { MasterKey } from '@chatsundere/crypto';
import type { BlobListResponse, BlobRef, SyncCollection } from '@chatsundere/shared-types';
import type { SyncPullResponse } from '@chatsundere/shared-types';
import { SYNC_COLLECTIONS } from '@chatsundere/shared-types';
import { useSessionStore } from '@chatsundere/ui-shared';
import { getClientDataDb } from '../boot/client-data-db.js';
import { apiFetch } from '../lib/fetch.js';
import { effectiveSyncUrl } from '../lib/server-urls.js';
import { applyRecord, flushInvalidations, resetTombstoneCounter } from './apply.js';
import { blobFieldsOf } from './blob-transform.js';
import { type PutBlobResult, listBlobs, putBlob } from './blob-transport.js';
import { syncKeyOfRow } from './sync-keys.js';
import {
  advanceWatermark,
  getSyncState,
  setAttention,
  setPulling,
  setRecovering,
} from './watermark.js';
import { drainOutbox, withSyncLock } from './worker.js';

/**
 * Epoch recovery (spec §8) — SECURITY-RELEVANT. A server restore/reset mints a
 * new epoch; the client's CAS bases and watermark become meaningless against it.
 * Recovery re-converges WITHOUT silently discarding local data: local rows are
 * merged under §7's rules on the pull-all, then re-pushed with re-derived
 * baseRevs, so anything the server lost climbs back up.
 *
 * Order is load-bearing (spec §8):
 *  1. recovering flag ON (gates Class-2 writes, §5; status line shows re-check);
 *  2. invalidate every `syncRows` rev (CAS bases meaningless) and reset the
 *     watermark — every outbox `baseRev` derivation now yields the post-pull
 *     value or 0;
 *  3. pull-all from `since=0`, applying under §7 (settings still honours the
 *     §7.5 replay guard — Larissa I-5);
 *  4. full re-push of every handled-collection local row as fresh outbox
 *     entries, then drain (baseRevs re-derived from the post-pull `syncRows`);
 *  4b/4c. re-upload lost blob bytes, THEN re-push the blob-collection records
 *     naming them (#6a) — never the other order, so §11.5 holds (a record
 *     naming a blobId is never pushed before that blob exists server-side);
 *  5. persist the new epoch LAST — a crash between any step and this re-runs the
 *     whole recovery (the persisted epoch still mismatches).
 *
 * Recovery is triggered ONLY from the worker's authenticated epoch-mismatch
 * handoff (`_setRecovery`). A doorbell poke NEVER calls it — a poke is
 * unauthenticated content and merely schedules a verification cycle (Larissa
 * M-4).
 *
 * Flap containment (Larissa M-4): consecutive recoveries back off exponentially;
 * more than two within an hour STOP the engine with a persistent
 * `recovery_paused` attention and a manual `retryRecovery()` affordance.
 */

const STATE_ID = 'state' as const;
const HOUR_MS = 60 * 60 * 1_000;
/** The base of the exponential backoff between consecutive recoveries. */
const BACKOFF_BASE_MS = 1_000;
/** More than this many recoveries within the hour stops the engine (M-4). */
const MAX_RECOVERIES_PER_HOUR = 2;

const PULL_PAGE_LIMIT = 200;
const PULL_PAGE_CAP = 64;

/**
 * Thrown when the session MK vanishes mid-pull-all (audit finding #1): recovery
 * aborts BEFORE the step-5 epoch persist, so the persisted epoch still mismatches
 * and the whole recovery re-runs once the engine is available again.
 */
export class RecoveryAbortedError extends Error {
  constructor() {
    super('Recovery aborted: engine unavailable mid-pull.');
    this.name = 'RecoveryAbortedError';
  }
}

/**
 * Per-recovery blob re-upload threshold (spec §8, default 512 MiB): above this
 * the recovery ASKS before uploading (a `blob_reupload_threshold` attention),
 * rather than silently pushing a large amount over a possibly-costly link.
 */
const REUPLOAD_THRESHOLD_BYTES = 512 * 1024 * 1024;

/**
 * Blob-bearing collections join in WS-D. The GENERAL re-push (step 4) excludes
 * them (§3.1) — their records must not precede their bytes server-side (§11.5)
 * — but step 4c re-pushes exactly this set, AFTER `recoverBlobs()` (step 4b)
 * has put the bytes back, closing the #6a gap (an epoch reset that dropped a
 * blob-collection record left orphan bytes with no referencing row).
 */
const BLOB_COLLECTIONS: ReadonlySet<SyncCollection> = new Set<SyncCollection>([
  'personaAvatars',
  'artefacts',
  'attachments',
]);

/**
 * Collections recovery re-pushes from their local Dexie table. Excludes the
 * blob collections (WS-D) and `vectors` (they live in the separate knowledge
 * database and ride their document's lifecycle — the pull-all re-establishes
 * their CAS bases and any local-only chunk re-embeds from its re-pushed
 * document; see the task report's divergence note).
 */
const REPUSH_COLLECTIONS: readonly SyncCollection[] = SYNC_COLLECTIONS.filter(
  (c) => !BLOB_COLLECTIONS.has(c) && c !== 'vectors',
);

// ===== Injectable seams (production defaults; tests override) =====

type PullTransport = (sinceRev: number, limit: number) => Promise<SyncPullResponse>;

/** The §8 blob re-upload transport/seal the epoch-recovery step consumes. */
interface RecoveryBlobDeps {
  listBlobs: () => Promise<BlobListResponse>;
  putBlob: (blobId: string, body: Uint8Array, hash: string) => Promise<PutBlobResult>;
  sealBlob: (
    mk: MasterKey,
    blobId: string,
    bytes: Uint8Array,
  ) => Promise<{ body: Uint8Array; hash: Uint8Array }>;
}

let pullOverride: PullTransport | null = null;
let sleepOverride: ((ms: number) => Promise<void>) | null = null;
let blobDepsOverride: Partial<RecoveryBlobDeps> | null = null;
let reuploadThreshold = REUPLOAD_THRESHOLD_BYTES;

/** Test seam: intercept the recovery pull-all transport (the `since=0` pages). */
export function _setRecoveryPull(fn: PullTransport | null): void {
  pullOverride = fn;
}
/** Test seam: replace the inter-recovery backoff sleep (defaults to a real timer). */
export function _setRecoverySleep(fn: ((ms: number) => Promise<void>) | null): void {
  sleepOverride = fn;
}
/**
 * Test seam (WS-D §8): intercept the epoch blob re-upload's inventory/seal/put and
 * optionally shrink the per-recovery re-upload threshold so a boundary test needs
 * no half-gigabyte of bytes. Production reads the real transport + `sealBlob`.
 */
export function _setRecoveryBlobDeps(
  deps: Partial<RecoveryBlobDeps> | null,
  thresholdBytes?: number,
): void {
  blobDepsOverride = deps;
  if (thresholdBytes !== undefined) reuploadThreshold = thresholdBytes;
}
/** Test seam: clear the rate-limit history, the paused flag, and every override. */
export function _resetRecoveryForTests(): void {
  pullOverride = null;
  sleepOverride = null;
  blobDepsOverride = null;
  reuploadThreshold = REUPLOAD_THRESHOLD_BYTES;
  recoveryTimes.length = 0;
  enginePaused = false;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultPull(syncUrl: string, sinceRev: number, limit: number): Promise<SyncPullResponse> {
  return apiFetch<SyncPullResponse>({
    baseUrl: syncUrl,
    path: `/api/v1/sync/changes?since=${sinceRev}&limit=${limit}`,
    authMode: 'bearer',
    credentials: 'omit', // the sync service is cookie-free (CORS: no credentials)
    origin: 'background', // §5.2: a refused refresh latches auth-degraded, never logs out
  });
}

// ===== Flap containment (Larissa M-4) =====

/** Timestamps of recent recovery starts, pruned to the last hour. */
const recoveryTimes: number[] = [];
/** Set when the rate limit trips; only `retryRecovery()` clears it. */
let enginePaused = false;

// ===== The procedure =====

/**
 * Run epoch recovery (spec §8). Registered with the worker via `_setRecovery`;
 * the worker invokes it (no args) on an authenticated epoch mismatch. Clears the
 * recovering flag on every exit path — success, rate-limit stop, or a thrown
 * step (the finally). A thrown step leaves the new epoch unpersisted, so the
 * next authenticated mismatch re-runs the whole recovery.
 */
export async function runRecovery(): Promise<void> {
  // Paused by a prior flap: only a manual retry re-arms the engine (M-4).
  if (enginePaused) return;

  const now = Date.now();
  while (recoveryTimes.length > 0 && now - (recoveryTimes[0] ?? now) > HOUR_MS) {
    recoveryTimes.shift();
  }
  recoveryTimes.push(now);

  if (recoveryTimes.length > MAX_RECOVERIES_PER_HOUR) {
    // Third recovery within the hour → an epoch-flapping server; stop the engine.
    enginePaused = true;
    await setAttention({ kind: 'recovery_paused' });
    setRecovering(false);
    return;
  }

  // Exponential backoff between consecutive recoveries (none before the first).
  const consecutive = recoveryTimes.length;
  if (consecutive > 1) {
    const sleep = sleepOverride ?? defaultSleep;
    await sleep(BACKOFF_BASE_MS * 2 ** (consecutive - 2));
  }

  setRecovering(true);
  try {
    await performRecovery();
  } finally {
    setRecovering(false);
  }
}

/**
 * Clear the paused state and re-run recovery (the manual affordance behind the
 * `recovery_paused` attention state, §8). Resets the rate-limit history so the
 * user's explicit retry starts from a clean slate.
 */
export async function retryRecovery(): Promise<void> {
  enginePaused = false;
  recoveryTimes.length = 0;
  await setAttention(null);
  await runRecovery();
}

/** Whether the engine is currently paused by the flap rate limit (§8). */
export function isEnginePaused(): boolean {
  return enginePaused;
}

/**
 * The answer path for the `blob_reupload_threshold` ask (audit #7): re-run the
 * inventory diff and upload regardless of size, under the sync Web Lock so it
 * never interleaves with a drain's blob phases. Clears the attention only after
 * `recoverBlobs` reports every candidate actually landed (review B7 #2) — a
 * failed upload (thrown) rejects and leaves the attention in place, and a
 * still-failing TYPED verdict (quota/too-large/disabled: `landed === false`,
 * no throw) must leave it in place too. Discarding that boolean was exactly
 * the same bug class as #6b: a typed verdict is not an exception, so it was
 * silently read as success.
 */
export async function confirmBlobReupload(): Promise<void> {
  await withSyncLock(async () => {
    const landed = await recoverBlobs({ force: true });
    const { attention } = await getSyncState();
    if (landed && attention?.kind === 'blob_reupload_threshold') await setAttention(null);
  });
}

/** Steps 2–5 of §8, in order. The epoch persist is unconditionally last. */
async function performRecovery(): Promise<void> {
  const db = getClientDataDb();

  // Step 2 — the CAS bases (and thus every derived baseRev) are meaningless
  // against the new epoch. Clearing `syncRows` invalidates the revs AND the
  // stored ciphertext hashes, so the pull-all decrypts and MERGES every record
  // (§7) rather than short-circuiting on a stale echo hash. Reset the watermark
  // so the pull starts from `since=0`.
  await db.syncRows.clear();
  await getSyncState();
  await db.syncState.update(STATE_ID, { watermarkRev: 0, suppressedRevs: {} });

  // Step 3 — pull-all from 0 under §7's rules. Captures the new epoch from the
  // authenticated responses but does NOT compare/persist it (that is step 5).
  const pulledEpoch = await pullAllFromZero();

  // Step 4 — re-push the entire handled-collection local state, then drain so
  // the baseRevs derive from the post-pull `syncRows`. A drain failure throws
  // out of here before the epoch persist, re-running recovery next time.
  await enqueueFullRepush();
  const drain = await drainOutbox();

  // Step 4b (WS-D §8) — reconcile the blob channel: diff this device's local
  // refs against the server inventory and re-PUT what it lost (idempotent
  // deterministic re-seals). Bounded by the recovery rate limit (a lying/
  // flapping inventory is stopped by M-4's flap-stop, which caps re-upload
  // rounds); above the per-recovery threshold it ASKS before uploading.
  // Returns false when at least one re-upload did NOT land server-side
  // (#6b) — the step-5 persist below is withheld in that case, so recovery
  // re-runs rather than declaring false convergence.
  const blobsLanded = await recoverBlobs();

  // Step 4c (#6a) — NOW that the bytes are back server-side, re-push the
  // blob-collection records naming them. Ordered strictly after step 4b so
  // §11.5 holds; step 4's general re-push deliberately skipped this set
  // (comment on `BLOB_COLLECTIONS`) to avoid the reverse ordering.
  await enqueueFullRepush(Array.from(BLOB_COLLECTIONS));
  const blobRecordDrain = await drainOutbox();

  // Step 5 — persist the new epoch LAST (load-bearing crash boundary), and
  // ONLY when every blob re-upload actually landed (#6b): persisting here
  // while local bytes still don't exist server-side would be false
  // convergence — the next authenticated mismatch is the only other trigger,
  // so a withheld persist means recovery genuinely re-runs.
  const newEpoch = pulledEpoch ?? blobRecordDrain.epoch ?? drain.epoch;
  if (blobsLanded && newEpoch !== null) await db.syncState.update(STATE_ID, { epoch: newEpoch });
}

/** A present, well-formed `BlobRef` (a `null`/absent ref carries no bytes to re-PUT). */
function isBlobRef(value: unknown): value is BlobRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { blobId?: unknown }).blobId === 'string' &&
    typeof (value as { bytes?: unknown }).bytes === 'number'
  );
}

/**
 * Epoch blob re-upload (spec §8), inside the rate-limited recovery cycle. Scans
 * this device's blob-bearing rows for refs whose bytes it still holds, diffs them
 * against the server inventory, and re-PUTs the ones the server lost — plain
 * idempotent re-PUTs (deterministic re-seal), skipping oversize-sentinel refs.
 *
 * The inventory round-trip is skipped entirely when this device holds no
 * re-uploadable bytes, so a record-only recovery stays network-free. A lying or
 * flapping inventory (claiming to lack blobs the client holds) is bounded to ~2
 * re-upload rounds by M-4's recovery flap-stop — `runRecovery` halts the engine
 * with `recovery_paused` on the third recovery within the hour, so this never
 * becomes an unbounded re-upload loop (Larissa L-5). Above the per-recovery
 * threshold the attention state asks before uploading — unless `force` is set,
 * the answer path (`confirmBlobReupload`) which uploads regardless of size.
 *
 * Returns whether every candidate re-upload landed server-side (#6b), MINUS the
 * ones this call durably excludes as terminally oversized (see the 413 case
 * below — a terminal exclusion is not a "did not land" failure, so it never
 * withholds the caller's epoch persist): `putBlob` never throws on a typed
 * server verdict (409/413/507/501), so each result MUST be inspected rather
 * than discarded — a `blob_exists` verdict is cryptographic evidence of a
 * divergent stored body (§7.2) and raises the same tamper attention the
 * drain-path matrix (`blob-repair.ts`) raises on a 409; a quota/disabled
 * verdict means the bytes genuinely did not land (transient, retried next
 * cycle), so the caller must not persist the new epoch on their account. A
 * path that uploads nothing (no candidates, nothing missing, or the threshold
 * ask) is vacuously "landed" — there was nothing this cycle could fail to land.
 *
 * Review B7 #1 (quota only) — a withheld epoch persist alone left the user with
 * no clue why sync stopped converging, unlike the drain path which raises a
 * persistent attention for the same verdict. `quota_exceeded` now raises the
 * SAME user-visible banner the drain-path matrix would. `blobs_disabled` stays
 * silent here — genuine parity: the drain path's own PUT matrix
 * (`putFailureFor` in worker.ts) folds a PUT-time 501 into the generic
 * `put-error` case, which raises no banner either, and inventing one risks
 * mis-describing an administrative/transient condition as a size or quota
 * problem. `blob_exists` is unchanged (tamper attention only, no withhold).
 *
 * Re-review B7 (this fix) — `blob_too_large` (413) is NOT a transient failure
 * like quota/disabled: it is a durable, per-blob verdict identical to the
 * drain path's own 413 handling (`oversizeSentinel`, `blob-repair.ts`), which
 * this function mirrors exactly rather than inventing a parallel mechanism.
 * `oversizeSentinel` sets the row's `oversizedField` and returns `'terminal'`
 * — no banner, permanent exclusion — and this loop's own skip-check (below,
 * `record[spec.oversizedField] === true`) already honours that field. The
 * PREVIOUS version of this branch raised a `record_too_large` attention and
 * withheld the epoch, which was wrong on three counts: (1) that attention is
 * only ever cleared by the terminal-sentinel sweep in `applyOk`
 * (`watermark.ts` CYCLE_CLEARABLE comment), keyed to a `syncOutbox` row this
 * re-upload path never creates — the banner stuck forever, or was cleared by
 * an unrelated oversized record elsewhere; (2) the drain path raises NO
 * banner for its own 413 — this branch owes it genuine parity, not an
 * invented one; (3) withholding the epoch for a genuinely oversized blob
 * means the same unfittable candidate is retried and withheld every recovery
 * cycle forever. So: set the sentinel, raise nothing, and do NOT clear
 * `allLanded` — the blob is terminally excluded, not pending.
 */
async function recoverBlobs(opts: { force?: boolean } = {}): Promise<boolean> {
  const mk = useSessionStore.getState().mk;
  if (!mk) return true;
  const db = getClientDataDb();

  // Gather local refs with bytes FIRST — no inventory fetch when there is
  // nothing this device could re-upload (keeps record-only recovery IO-free).
  // `collection`/`key`/`oversizedField` ride along so a `blob_too_large`
  // verdict below can set the durable sentinel on the OWNING row (mirroring
  // `oversizeSentinel` in blob-repair.ts).
  const candidates: {
    blobId: string;
    bytes: Blob;
    collection: SyncCollection;
    key: string;
    oversizedField: string;
  }[] = [];
  for (const collection of BLOB_COLLECTIONS) {
    const rows = await db.table(collection).toArray();
    for (const row of rows) {
      const record = row as Record<string, unknown>;
      for (const spec of blobFieldsOf(collection)) {
        if (record[spec.oversizedField] === true) continue; // server-terminal — never re-PUT (§8)
        const ref = record[spec.refField];
        if (!isBlobRef(ref)) continue;
        const bytes = record[spec.bytesField];
        if (!(bytes instanceof Blob) || bytes.size === 0) continue; // no local bytes to re-upload
        candidates.push({
          blobId: ref.blobId,
          bytes,
          collection,
          key: syncKeyOfRow(collection, row),
          oversizedField: spec.oversizedField,
        });
      }
    }
  }
  if (candidates.length === 0) return true;

  const deps: RecoveryBlobDeps = { listBlobs, putBlob, sealBlob, ...blobDepsOverride };
  let inventory: BlobListResponse;
  try {
    inventory = await deps.listBlobs();
  } catch {
    // Disabled (501) or unreachable — nothing to reconcile this cycle.
    return true;
  }
  const present = new Set(inventory.blobs.map((b) => b.blobId));
  const missing = candidates.filter((c) => !present.has(c.blobId));
  if (missing.length === 0) return true;

  const totalBytes = missing.reduce((sum, m) => sum + m.bytes.size, 0);
  if (!opts.force && totalBytes > reuploadThreshold) {
    // Above the per-recovery threshold — ASK before uploading (§8), upload nothing.
    await setAttention({
      kind: 'blob_reupload_threshold',
      bytes: totalBytes,
      count: missing.length,
    });
    return true;
  }

  let allLanded = true;
  for (const item of missing) {
    const buf = new Uint8Array(await item.bytes.arrayBuffer());
    const sealed = await deps.sealBlob(mk, item.blobId, buf);
    const result = await deps.putBlob(item.blobId, sealed.body, toBase64Url(sealed.hash)); // idempotent re-PUT
    if (result.status === 'created' || result.status === 'ok') continue;
    if (result.status === 'blob_exists') {
      // §7.2 tamper signal: this device is re-uploading bytes the inventory
      // claims are missing, yet the server reports a DIVERGENT body already
      // stored under this id — cryptographic evidence of server misbehaviour,
      // never silent churn. Mirrors the drain-path matrix's own 409 handling
      // (`resolveBlobFailure` in blob-repair.ts), which raises the identical
      // attention kind.
      await setAttention({ kind: 'tamper' });
      continue;
    }
    if (result.status === 'blob_too_large') {
      // Durable, TERMINAL exclusion — exact mirror of the drain path's own
      // 413 handling (`oversizeSentinel`, blob-repair.ts): set the sentinel
      // this loop's own skip-check above already honours, raise NO banner
      // (genuine parity — the drain path raises none for 413 either), and do
      // NOT clear `allLanded`. This is not a transient failure to retry; it
      // is a permanent fact about this blob, so withholding the epoch for it
      // would retry an unfittable candidate forever (re-review B7).
      // biome-ignore lint/suspicious/noExplicitAny: Dexie's per-table patch type is opaque here.
      await db.table(item.collection).update(item.key, { [item.oversizedField]: true } as any);
      continue;
    }
    // quota_exceeded / blobs_disabled / a transport error: this re-upload did
    // NOT land server-side and is a TRANSIENT condition. Recovery must not
    // declare convergence while local bytes remain unrepresented (#6b) — the
    // caller withholds the step-5 epoch persist so the next mismatch re-runs
    // recovery and retries the PUT.
    if (result.status === 'quota_exceeded') {
      // Exact parity with the drain-path matrix's `put-quota` handling.
      await setAttention({
        kind: 'quota_exceeded',
        usedBytes: result.usedBytes ?? 0,
        quotaBytes: result.quotaBytes ?? 0,
      });
    }
    // blobs_disabled and a plain transport error stay silent (see the
    // function doc) — withholding the epoch persist below already retries
    // this on the next authenticated mismatch.
    allLanded = false;
  }
  return allLanded;
}

/**
 * Pull every page from `since=0`, applying each record under §7 (local data
 * merged, settings server-wins-with-replay-guard). Advances the watermark page
 * by page (monotone from 0) and flushes invalidations once per page (§7.6).
 * Deliberately does NOT run the epoch check — the persisted epoch still
 * mismatches during recovery, so `checkEpoch` here would recurse (M-4). Returns
 * the epoch the server reported, or null when no page was fetched.
 */
async function pullAllFromZero(): Promise<string | null> {
  const syncUrl = effectiveSyncUrl();
  if (!syncUrl) return null;
  const pull =
    pullOverride ?? ((since: number, limit: number) => defaultPull(syncUrl, since, limit));

  resetTombstoneCounter();
  const startedAt = Date.now();
  let pages = 0;
  let epoch: string | null = null;
  await setPulling({ pages, startedAt });
  try {
    let more = true;
    while (more && pages < PULL_PAGE_CAP) {
      const { watermarkRev } = await getSyncState();
      const response = await pull(watermarkRev, PULL_PAGE_LIMIT);
      pages += 1;
      epoch = response.epoch;
      await setPulling({ pages, startedAt });

      let highestRev = watermarkRev;
      for (const record of response.records) {
        const outcome = await applyRecord(record);
        // Engine loss (locked/forgotten session) mid-pull-all: abort BEFORE the
        // step-5 epoch persist so the new epoch is never written over an unapplied
        // corpus (audit finding #1). The persisted epoch still mismatches, so the
        // next authenticated cycle re-runs the whole recovery.
        if (outcome.kind === 'unavailable') throw new RecoveryAbortedError();
        if (record.rev > highestRev) highestRev = record.rev;
      }
      await advanceWatermark(Math.max(watermarkRev, highestRev));
      flushInvalidations();

      more = response.more;
    }
  } finally {
    await setPulling(null);
  }
  return epoch;
}

/**
 * Enqueue a fresh `upsert` outbox entry for every local row of `collections`
 * (spec §8 step 4, and its step-4c blob-collection follow-up, #6a). The
 * subsequent drain seals them with baseRevs re-derived from the post-pull
 * `syncRows` — records the server already has (via the pull-all) push against
 * their current rev; records it lost push as inserts. Defaults to the general
 * `REPUSH_COLLECTIONS` set; step 4c passes `BLOB_COLLECTIONS` instead.
 */
async function enqueueFullRepush(
  collections: readonly SyncCollection[] = REPUSH_COLLECTIONS,
): Promise<void> {
  const db = getClientDataDb();
  const now = Date.now();
  for (const collection of collections) {
    if (collection === 'settings') {
      const singleton = await db.settings.get(1);
      if (singleton) {
        await db.syncOutbox.add({ collection, key: '1', op: 'upsert', enqueuedAt: now });
      }
      continue;
    }
    const rows = await db.table(collection).toArray();
    for (const row of rows) {
      // Built-in mindspaces never sync (engine spec §12.5): every device seeds
      // the same slug-keyed seven, so pushing them is redundant.
      if (collection === 'mindspaces' && (row as { builtIn?: boolean }).builtIn === true) continue;
      const key = syncKeyOfRow(collection, row);
      await db.syncOutbox.add({ collection, key, op: 'upsert', enqueuedAt: now });
    }
  }
}
