// SPDX-License-Identifier: AGPL-3.0-only
import { computeBlindId, fromBase64Url, openRecord, sealRecord } from '@chatsundere/crypto';
import type { MasterKey } from '@chatsundere/crypto';
import type {
  SyncCollection,
  SyncPullResponse,
  SyncPushRecord,
  SyncPushResponse,
} from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import type { SyncAttention, SyncRowMeta, TrashRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { apiFetch } from '../lib/fetch.js';
import { applyRecord, flushInvalidations, resetTombstoneCounter } from './apply.js';
import {
  type CoalescedEntry,
  DEFAULT_MAX_BATCH_BYTES,
  type PreparedRecord,
  type SealCryptoDeps,
  batchByBytes,
  prepareRecord,
} from './seal-batch.js';
import { extractKeyFor } from './sync-keys.js';
import {
  advanceWatermark,
  checkEpoch,
  getSyncState,
  setAttention,
  setPulling,
} from './watermark.js';

/**
 * The single-flight sync worker — DRAIN/PUSH half (spec §6 drain, §7.0 hashes).
 * `runSyncCycle` gates preconditions, purges trash, drains the outbox, and then
 * hands off to the pull loop (Task 7). `drainOutbox` seals every coalesced
 * outbox entry, pushes byte-batched, applies each result, and reports whether a
 * piggyback pull or epoch recovery is needed — WITHOUT ever advancing the
 * watermark (own revs interleave with other devices', spec §6.6).
 */

/** The 30-day pulled-tombstone grace window (§7.3). */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Blob-bearing collections deferred to WS-D; the drain never seals them (§3.1). */
const BLOB_COLLECTIONS: ReadonlySet<SyncCollection> = new Set<SyncCollection>([
  'personaAvatars',
  'artefacts',
  'attachments',
]);

/** The outcome of one drain, consumed by the cycle and by `mutateSynced`. */
export interface DrainResult {
  /** Highest rev across THIS drain's `ok` results — the piggyback ceiling (L-1). */
  pushedHighestRev: number;
  /** The last push response's `head`, or null when nothing was pushed. */
  head: number | null;
  /** The last push response's `epoch`, or null when nothing was pushed. */
  epoch: string | null;
  /** An authenticated epoch mismatch was seen — Task 9 runs recovery. */
  needsRecovery: boolean;
  /** A piggyback pull (or conflict resolution) is owed — Task 7 pulls. */
  needsPull: boolean;
}

function emptyDrain(): DrainResult {
  return { pushedHighestRev: 0, head: null, epoch: null, needsRecovery: false, needsPull: false };
}

// ===== Injectable seams (production defaults; tests override) =====

type PushTransport = (records: SyncPushRecord[]) => Promise<SyncPushResponse>;
type PullTransport = (sinceRev: number, limit: number) => Promise<SyncPullResponse>;
type OpenRecordFn = (
  mk: MasterKey,
  collection: string,
  blindId: Uint8Array,
  sealed: { nonce: Uint8Array; ciphertext: Uint8Array },
  extractKey: (row: unknown) => string,
) => Promise<unknown>;

const defaultCrypto: SealCryptoDeps = { computeBlindId, sealRecord };
let cryptoOverride: Partial<SealCryptoDeps> | null = null;
let openRecordOverride: OpenRecordFn | null = null;
let pushOverride: PushTransport | null = null;
let pullOverride: PullTransport | null = null;
let maxBatchBytes = DEFAULT_MAX_BATCH_BYTES;

/** Task 7 registers the pull loop here; defaults to a no-op until then. */
let pullLoop: () => Promise<void> = async () => undefined;
/** Task 9 registers epoch recovery here; defaults to a no-op until then. */
let recovery: () => Promise<void> = async () => undefined;

/** Test seam: override the crypto used for sealing/blind-id derivation. */
export function _setCryptoDeps(deps: Partial<SealCryptoDeps> | null): void {
  cryptoOverride = deps;
}
/** Test seam: override `openRecord` (poison-conflict decryptability check). */
export function _setOpenRecord(fn: OpenRecordFn | null): void {
  openRecordOverride = fn;
}
/** Test seam: intercept the HTTP push transport. */
export function _setPushTransport(fn: PushTransport | null): void {
  pushOverride = fn;
}
/** Test seam: intercept the HTTP pull transport (the `GET changes` pages). */
export function _setPullTransport(fn: PullTransport | null): void {
  pullOverride = fn;
}
/** Test seam: shrink the byte-batch ceiling so boundary tests need no megabytes. */
export function _setMaxBatchBytes(n: number): void {
  maxBatchBytes = n;
}
/** Task 7 seam: register the pull loop the cycle runs after a drain requests it. */
export function _setPullLoop(fn: () => Promise<void>): void {
  pullLoop = fn;
}
/** Task 9 seam: register epoch recovery the cycle runs on an authenticated mismatch. */
export function _setRecovery(fn: () => Promise<void>): void {
  recovery = fn;
}
/** Test seam: restore every override to its production default. */
export function _resetWorkerForTests(): void {
  cryptoOverride = null;
  openRecordOverride = null;
  pushOverride = null;
  pullOverride = null;
  maxBatchBytes = DEFAULT_MAX_BATCH_BYTES;
  pullLoop = async () => undefined;
  recovery = async () => undefined;
  cycleMutex = false;
}

function activeCrypto(): SealCryptoDeps {
  return { ...defaultCrypto, ...cryptoOverride };
}
function activeOpenRecord(): OpenRecordFn {
  return openRecordOverride ?? openRecord;
}

// ===== Local row reads =====

/**
 * Read the live local row for a collection+key. `settings` is the numeric
 * singleton `1`; `vectors` live in the separate knowledge database; everything
 * else keys by the sync key on its own table.
 */
async function readLocalRow(collection: SyncCollection, key: string): Promise<unknown> {
  const db = getClientDataDb();
  if (collection === 'settings') return db.settings.get(1);
  if (collection === 'vectors') {
    // Lazy import: the vectors database drags the embeddings engine, which the
    // drain must not eagerly load on the far more common non-vector path.
    const { getKnowledgeVectorRow } = await import('../boot/knowledge-vectors-db.js');
    return getKnowledgeVectorRow(key);
  }
  return db.table(collection).get(key);
}

// ===== Coalescing (spec §6.1) =====

interface OutboxGroup {
  collection: SyncCollection;
  key: string;
  op: 'upsert' | 'delete';
  seqs: number[];
}

/**
 * Coalesce the outbox by `[collection+key]` (spec §6.1): the latest op wins by
 * construction (sealing reads the live row), a delete supersedes queued
 * upserts, and the covered `seq`s are deleted together on success.
 */
function coalesce(
  rows: { seq?: number; collection: SyncCollection; key: string; op: 'upsert' | 'delete' }[],
): OutboxGroup[] {
  const groups = new Map<string, OutboxGroup>();
  for (const row of rows) {
    if (row.seq === undefined) continue;
    const id = `${row.collection}${row.key}`;
    const existing = groups.get(id);
    if (existing) {
      existing.seqs.push(row.seq);
      existing.op = row.op; // latest op wins (delete-after-upsert → delete)
    } else {
      groups.set(id, { collection: row.collection, key: row.key, op: row.op, seqs: [row.seq] });
    }
  }
  return [...groups.values()];
}

// ===== Drain (spec §6) =====

/**
 * Drain the outbox once: coalesce, seal, byte-batch, push, and apply each
 * per-record result (spec §6). Never advances the watermark. Safe to call
 * standalone — it no-ops when the MK or `syncUrl` is unavailable, so the
 * gate-checked immediate path and the cycle share one implementation.
 */
export async function drainOutbox(): Promise<DrainResult> {
  const db = getClientDataDb();
  const mk = useSessionStore.getState().mk;
  const syncUrl = useDiscoveryStore.getState().config?.syncUrl;
  if (!mk || !syncUrl) return emptyDrain();

  const outbox = await db.syncOutbox.orderBy('seq').toArray();
  if (outbox.length === 0) return emptyDrain();

  const groups = coalesce(outbox);

  // Build wire records; short-circuit the never-pushed create+delete (L-4) and
  // any entry whose row vanished — those seqs are dropped without a push.
  const prepared: PreparedRecord[] = [];
  const seqsToDrop: number[] = [];
  const crypto = activeCrypto();
  for (const group of groups) {
    if (BLOB_COLLECTIONS.has(group.collection)) continue; // deferred to WS-D (§3.1)

    const meta = await db.syncRows.get([group.collection, group.key]);
    const baseRev = meta?.rev ?? 0;

    if (group.op === 'delete') {
      // Never mint a server tombstone for a row the server never knew (L-4).
      if (!meta) {
        seqsToDrop.push(...group.seqs);
        continue;
      }
      const entry: CoalescedEntry = { ...group, row: undefined, baseRev };
      prepared.push(await prepareRecord(crypto, mk, entry));
      continue;
    }

    const row = await readLocalRow(group.collection, group.key);
    if (row === undefined || row === null) {
      // Upsert of a row that no longer exists locally — nothing to seal.
      seqsToDrop.push(...group.seqs);
      continue;
    }
    const entry: CoalescedEntry = { ...group, row, baseRev };
    prepared.push(await prepareRecord(crypto, mk, entry));
  }

  if (seqsToDrop.length > 0) await db.syncOutbox.bulkDelete(seqsToDrop);
  if (prepared.length === 0) return emptyDrain();

  const push = pushOverride ?? ((records: SyncPushRecord[]) => defaultPush(syncUrl, records));
  const batches = batchByBytes(prepared, maxBatchBytes);

  let head: number | null = null;
  let epoch: string | null = null;
  let pushedHighestRev = 0;
  let needsPull = false;

  for (const batch of batches) {
    const response = await push(batch.map((p) => p.record));
    head = response.head;
    epoch = response.epoch;

    for (let i = 0; i < batch.length; i++) {
      const prep = batch[i];
      const result = response.results[i];
      if (!prep || !result) continue;

      if (result.status === 'ok') {
        pushedHighestRev = Math.max(pushedHighestRev, result.rev);
        await applyOk(prep, result.rev);
      } else if (result.status === 'conflict') {
        needsPull = (await applyConflict(mk, prep, result.current)) || needsPull;
      } else if (result.status === 'tombstoned') {
        await applyTombstoned(prep);
      } else {
        await applyError(result);
      }
    }
  }

  let needsRecovery = false;
  if (epoch !== null && (await checkEpoch(epoch)) === 'mismatch') needsRecovery = true;

  if (!needsRecovery && head !== null) {
    // Piggyback pull iff the server's head outruns both the watermark AND our own
    // just-acked revs (L-1) — the naive `head > watermark` pulls after every push.
    const { watermarkRev } = await getSyncState();
    if (head > Math.max(watermarkRev, pushedHighestRev)) needsPull = true;
  }

  return { pushedHighestRev, head, epoch, needsRecovery, needsPull };
}

/** POST a batch to the sync server (bearer + refresh via `apiFetch`). */
function defaultPush(syncUrl: string, records: SyncPushRecord[]): Promise<SyncPushResponse> {
  return apiFetch<SyncPushResponse>({
    baseUrl: syncUrl,
    path: '/api/v1/sync/changes',
    json: { records },
    authMode: 'bearer',
  });
}

/**
 * `ok`: adopt the server rev. An upsert records the LOCALLY-computed ciphertext
 * hash for the §7.0 echo shortcut; a delete removes the now-dead `syncRows`
 * entry. Either way the covered outbox seqs are cleared.
 */
async function applyOk(prep: PreparedRecord, rev: number): Promise<void> {
  const db = getClientDataDb();
  await db.transaction('rw', db.syncRows, db.syncOutbox, async () => {
    if (prep.op === 'delete') {
      await db.syncRows.delete([prep.collection, prep.key]);
    } else {
      const meta: SyncRowMeta = {
        collection: prep.collection,
        key: prep.key,
        rev,
        ciphertextHash: prep.ciphertextHashB64 ?? '',
      };
      await db.syncRows.put(meta);
    }
    await db.syncOutbox.bulkDelete(prep.seqs);
  });
}

/**
 * `conflict`: if the server's `current` is undecryptable (poison, M-1), adopt
 * its rev as the new CAS base and KEEP the outbox entry so the next drain
 * re-pushes our good copy — the honest client heals the poison. If it decrypts,
 * the local edit lost; leave the entry and signal a pull so Task 7 resolves it.
 * Returns whether a pull is owed.
 */
async function applyConflict(
  mk: MasterKey,
  prep: PreparedRecord,
  current: { rev: number; nonce?: string; ciphertext?: string; blindId: string },
): Promise<boolean> {
  const db = getClientDataDb();

  const decryptable = await isDecryptable(mk, prep.collection, current);
  if (!decryptable) {
    // Poison heal: bump the CAS base, keep our sealed hash and the outbox entry.
    const existing = await db.syncRows.get([prep.collection, prep.key]);
    const meta: SyncRowMeta = {
      collection: prep.collection,
      key: prep.key,
      rev: current.rev,
      ciphertextHash: prep.ciphertextHashB64 ?? existing?.ciphertextHash ?? '',
    };
    await db.syncRows.put(meta);
    return false;
  }

  // Decryptable: mark for pull-resolution (Task 7); keep the outbox entry.
  return true;
}

/** Whether the server's `current` conflict record decrypts under our MK. */
async function isDecryptable(
  mk: MasterKey,
  collection: SyncCollection,
  current: { nonce?: string; ciphertext?: string; blindId: string },
): Promise<boolean> {
  if (!current.nonce || !current.ciphertext) return false;
  try {
    await activeOpenRecord()(
      mk,
      collection,
      fromBase64Url(current.blindId),
      { nonce: fromBase64Url(current.nonce), ciphertext: fromBase64Url(current.ciphertext) },
      extractKeyFor(collection),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * `tombstoned` (the wire's exact status, I-1): the key is dead server-side.
 * Route the local row (if any) to trash with its 30-day grace, remove the
 * `syncRows` entry, and drop the outbox entries — all in one transaction.
 */
async function applyTombstoned(prep: PreparedRecord): Promise<void> {
  const db = getClientDataDb();
  const now = Date.now();

  if (prep.collection === 'vectors') {
    // Vectors live in the separate knowledge database and ride their document's
    // lifecycle — a tombstone here just clears the CAS base and the outbox.
    await db.transaction('rw', db.syncRows, db.syncOutbox, async () => {
      await db.syncRows.delete([prep.collection, prep.key]);
      await db.syncOutbox.bulkDelete(prep.seqs);
    });
    return;
  }

  const local =
    prep.collection === 'settings' ? undefined : await readLocalRow(prep.collection, prep.key);

  await db.transaction(
    'rw',
    db.syncRows,
    db.syncOutbox,
    db.trash,
    db.table(prep.collection),
    async () => {
      if (local !== undefined && local !== null) {
        const trashRow: TrashRow = {
          id: `${prep.collection}:${prep.key}`,
          collection: prep.collection,
          key: prep.key,
          row: local,
          deletedAt: now,
          purgeAt: now + THIRTY_DAYS_MS,
        };
        await db.trash.put(trashRow);
        await db.table(prep.collection).delete(prep.key);
      }
      await db.syncRows.delete([prep.collection, prep.key]);
      await db.syncOutbox.bulkDelete(prep.seqs);
    },
  );
}

/**
 * `error`: raise the matching attention state (spec §11.3) and KEEP the outbox
 * entry with backoff. A permanently-failing entry is skipped this cycle but
 * never blocks the queue behind it — every other record was already applied.
 */
async function applyError(result: {
  code: string;
  usedBytes?: number;
  quotaBytes?: number;
}): Promise<void> {
  const attention = attentionForError(result);
  if (attention) await setAttention(attention);
}

function attentionForError(result: {
  code: string;
  usedBytes?: number;
  quotaBytes?: number;
}): SyncAttention | null {
  if (result.code === 'quota_exceeded') {
    return {
      kind: 'quota_exceeded',
      usedBytes: result.usedBytes ?? 0,
      quotaBytes: result.quotaBytes ?? 0,
    };
  }
  if (result.code === 'record_too_large') return { kind: 'record_too_large' };
  if (result.code === 'delete_rate_limited') return { kind: 'delete_rate_limited' };
  return null;
}

// ===== The cycle (spec §6) =====

/** Process-local single-flight fallback when `navigator.locks` is absent (jsdom). */
let cycleMutex = false;

/**
 * Run one sync cycle under a cross-tab single-flight lock (spec §6). No-ops
 * unless linked with a reachable server, an unlocked session, and the `sync`
 * feature present. Purges expired trash, drains the outbox, then hands off to
 * recovery (Task 9) or the pull loop (Task 7) as the drain reports.
 */
export async function runSyncCycle(): Promise<void> {
  if (!canRunCycle()) return;
  await withSingleFlight(async () => {
    await purgeTrash();
    const result = await drainOutbox();
    if (result.needsRecovery) {
      // Epoch mismatch — Task 9 re-syncs everything; skip the pull this cycle.
      await recovery();
      return;
    }
    if (result.needsPull || result.head === null) {
      // Pull when the drain says so (piggyback L-1 / a conflict owed resolution),
      // OR when nothing was pushed this cycle (`head === null`): a pure-reader
      // device with an empty outbox has no push response to read `head` from, so
      // it cannot rule out being behind — it MUST pull to discover other devices'
      // writes. This is the trigger-driven reader path (boot after unlock, the
      // doorbell poke, foreground, the coarse timer), including a fresh link's
      // "Pulling your data onto this device…" first sync (§6, §11.1).
      // === Task 7 SEAM: the pull loop lands here (registered via _setPullLoop). ===
      await pullLoop();
    }
  });
}

/** Cycle preconditions (spec §6): any miss → no-op. */
function canRunCycle(): boolean {
  if (useAccountLinkStore.getState().linkStatus !== 'linked') return false;
  const config = useDiscoveryStore.getState().config;
  if (!config?.syncUrl || !config.features.includes('sync')) return false;
  if (useSessionStore.getState().mk === null) return false;
  if (useConnectivityStore.getState().state.kind === 'local_offline') return false;
  return true;
}

/**
 * Single-flight via the Web Locks API for cross-tab correctness (a PWA with two
 * tabs); `ifAvailable` skips the cycle when another tab holds the lock. Falls
 * back to a process-local mutex where `navigator.locks` is unavailable (jsdom).
 */
async function withSingleFlight(fn: () => Promise<void>): Promise<void> {
  const locks = globalThis.navigator?.locks;
  if (locks && typeof locks.request === 'function') {
    await locks.request('chatsundere-sync', { ifAvailable: true }, async (lock) => {
      if (!lock) return; // held by another tab — skip this cycle
      await fn();
    });
    return;
  }
  if (cycleMutex) return;
  cycleMutex = true;
  try {
    await fn();
  } finally {
    cycleMutex = false;
  }
}

/** Delete every trash row past its 30-day grace (spec §4, §7.3). */
async function purgeTrash(): Promise<void> {
  const db = getClientDataDb();
  await db.trash.where('purgeAt').belowOrEqual(Date.now()).delete();
}

// ===== The pull loop (spec §6 pull, §7 apply) =====

/** Server page size (spec §6): the `limit` on every `GET changes` request. */
const PULL_PAGE_LIMIT = 200;
/**
 * Per-cycle page cap (spec §6, Larissa M-7): an unbounded `more: true` server
 * must not pin the client. The rest continues next cycle from the watermark.
 */
const PULL_PAGE_CAP = 64;

/** GET one page of changes since `sinceRev` (bearer + refresh via `apiFetch`). */
function defaultPull(syncUrl: string, sinceRev: number, limit: number): Promise<SyncPullResponse> {
  return apiFetch<SyncPullResponse>({
    baseUrl: syncUrl,
    path: `/api/v1/sync/changes?since=${sinceRev}&limit=${limit}`,
    authMode: 'bearer',
  });
}

/**
 * Pull loop (spec §6 pull + §7 apply). Pages from the watermark under a
 * per-cycle cap, applies every record on a page, then advances the watermark to
 * the page's highest rev — MONOTONE (Larissa M-7): a maliciously ordered page
 * whose last rev is below the watermark cannot regress it (`advanceWatermark`
 * clamps to `max`). Invalidations are coalesced and flushed ONCE per page
 * (§7.6). An authenticated epoch mismatch aborts and hands off to recovery
 * (§8). Registered as the default pull loop and re-invoked via `_setPullLoop`.
 */
export async function runPullLoop(): Promise<void> {
  const syncUrl = useDiscoveryStore.getState().config?.syncUrl;
  if (!syncUrl) return;
  const pull =
    pullOverride ?? ((since: number, limit: number) => defaultPull(syncUrl, since, limit));

  // Reset the per-cycle pulled-tombstone tally + panic flag (§7.3a).
  resetTombstoneCounter();

  const startedAt = Date.now();
  let pages = 0;
  await setPulling({ pages, startedAt });
  try {
    let more = true;
    while (more && pages < PULL_PAGE_CAP) {
      const { watermarkRev } = await getSyncState();
      const response = await pull(watermarkRev, PULL_PAGE_LIMIT);
      pages += 1;
      await setPulling({ pages, startedAt });

      // §8 — an authenticated response with a differing epoch aborts the cycle.
      if ((await checkEpoch(response.epoch)) === 'mismatch') {
        await recovery();
        return;
      }

      let highestRev = watermarkRev;
      for (const record of response.records) {
        await applyRecord(record);
        if (record.rev > highestRev) highestRev = record.rev;
      }
      // Advance page by page, never ahead of application; monotone by clamp.
      await advanceWatermark(Math.max(watermarkRev, highestRev));
      flushInvalidations();

      more = response.more;
    }
  } finally {
    await setPulling(null);
  }
}

// Register the real pull loop as the cycle default (tests override via _setPullLoop).
pullLoop = runPullLoop;
