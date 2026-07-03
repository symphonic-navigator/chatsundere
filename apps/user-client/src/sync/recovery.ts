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
import { drainOutbox } from './worker.js';

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
 * Per-recovery blob re-upload threshold (spec §8, default 512 MiB): above this
 * the recovery ASKS before uploading (a `blob_reupload_threshold` attention),
 * rather than silently pushing a large amount over a possibly-costly link.
 */
const REUPLOAD_THRESHOLD_BYTES = 512 * 1024 * 1024;

/** Blob-bearing collections join in WS-D; recovery never re-pushes them (§3.1). */
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
  await db.syncState.update(STATE_ID, { watermarkRev: 0 });

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
  await recoverBlobs();

  // Step 5 — persist the new epoch LAST (load-bearing crash boundary).
  const newEpoch = pulledEpoch ?? drain.epoch;
  if (newEpoch !== null) await db.syncState.update(STATE_ID, { epoch: newEpoch });
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
 * threshold the attention state asks before uploading.
 */
async function recoverBlobs(): Promise<void> {
  const mk = useSessionStore.getState().mk;
  if (!mk) return;
  const db = getClientDataDb();

  // Gather local refs with bytes FIRST — no inventory fetch when there is
  // nothing this device could re-upload (keeps record-only recovery IO-free).
  const candidates: { blobId: string; bytes: Blob }[] = [];
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
        candidates.push({ blobId: ref.blobId, bytes });
      }
    }
  }
  if (candidates.length === 0) return;

  const deps: RecoveryBlobDeps = { listBlobs, putBlob, sealBlob, ...blobDepsOverride };
  let inventory: BlobListResponse;
  try {
    inventory = await deps.listBlobs();
  } catch {
    // Disabled (501) or unreachable — nothing to reconcile this cycle.
    return;
  }
  const present = new Set(inventory.blobs.map((b) => b.blobId));
  const missing = candidates.filter((c) => !present.has(c.blobId));
  if (missing.length === 0) return;

  const totalBytes = missing.reduce((sum, m) => sum + m.bytes.size, 0);
  if (totalBytes > reuploadThreshold) {
    // Above the per-recovery threshold — ASK before uploading (§8), upload nothing.
    await setAttention({
      kind: 'blob_reupload_threshold',
      bytes: totalBytes,
      count: missing.length,
    });
    return;
  }

  for (const item of missing) {
    const buf = new Uint8Array(await item.bytes.arrayBuffer());
    const sealed = await deps.sealBlob(mk, item.blobId, buf);
    await deps.putBlob(item.blobId, sealed.body, toBase64Url(sealed.hash)); // idempotent re-PUT
  }
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
        await applyRecord(record);
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
 * Enqueue a fresh `upsert` outbox entry for every handled-collection local row
 * (spec §8 step 4). The subsequent drain seals them with baseRevs re-derived
 * from the post-pull `syncRows` — records the server already has (via the
 * pull-all) push against their current rev; records it lost push as inserts.
 */
async function enqueueFullRepush(): Promise<void> {
  const db = getClientDataDb();
  const now = Date.now();
  for (const collection of REPUSH_COLLECTIONS) {
    if (collection === 'settings') {
      const singleton = await db.settings.get(1);
      if (singleton) {
        await db.syncOutbox.add({ collection, key: '1', op: 'upsert', enqueuedAt: now });
      }
      continue;
    }
    const rows = await db.table(collection).toArray();
    for (const row of rows) {
      const key = syncKeyOfRow(collection, row);
      await db.syncOutbox.add({ collection, key, op: 'upsert', enqueuedAt: now });
    }
  }
}
