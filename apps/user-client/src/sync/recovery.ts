// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection, SyncPullResponse } from '@chatsundere/shared-types';
import { SYNC_COLLECTIONS } from '@chatsundere/shared-types';
import { useDiscoveryStore } from '@chatsundere/ui-shared';
import { getClientDataDb } from '../boot/client-data-db.js';
import { apiFetch } from '../lib/fetch.js';
import { applyRecord, flushInvalidations, resetTombstoneCounter } from './apply.js';
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

let pullOverride: PullTransport | null = null;
let sleepOverride: ((ms: number) => Promise<void>) | null = null;

/** Test seam: intercept the recovery pull-all transport (the `since=0` pages). */
export function _setRecoveryPull(fn: PullTransport | null): void {
  pullOverride = fn;
}
/** Test seam: replace the inter-recovery backoff sleep (defaults to a real timer). */
export function _setRecoverySleep(fn: ((ms: number) => Promise<void>) | null): void {
  sleepOverride = fn;
}
/** Test seam: clear the rate-limit history, the paused flag, and every override. */
export function _resetRecoveryForTests(): void {
  pullOverride = null;
  sleepOverride = null;
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

  // Step 5 — persist the new epoch LAST (load-bearing crash boundary).
  const newEpoch = pulledEpoch ?? drain.epoch;
  if (newEpoch !== null) await db.syncState.update(STATE_ID, { epoch: newEpoch });
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
  const syncUrl = useDiscoveryStore.getState().config?.syncUrl;
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
