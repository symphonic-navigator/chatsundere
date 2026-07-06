// SPDX-License-Identifier: AGPL-3.0-only
import {
  computeBlindId,
  fromBase64Url,
  getLinkedAccount,
  openRecord,
  sealBlob,
  sealRecord,
  toBase64Url,
} from '@chatsundere/crypto';
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
import type {
  SyncAttention,
  SyncOutboxRow,
  SyncRowMeta,
  TrashRow,
} from '../boot/client-data-db.js';
import { deriveLegacyTrashMeta, getClientDataDb } from '../boot/client-data-db.js';
import { getDb } from '../boot/open-db.js';
import { isAuthDegraded } from '../lib/auth-degrade.js';
import { HttpError, apiFetch } from '../lib/fetch.js';
import { effectiveSyncUrl } from '../lib/server-urls.js';
import {
  TOMBSTONE_CYCLE_CAP,
  applyRecord,
  flushInvalidations,
  resetTombstoneCounter,
  settleTombstoneNotice,
} from './apply.js';
import {
  type BlobFailure,
  type BlobFailureContext,
  type BlobRepairDeps,
  noteBlobLocallyRemoved,
  resetBlobRepairCycle,
  resolveBlobFailure,
} from './blob-repair.js';
import {
  type NewBlob,
  isBlobRef,
  readBlobBytesById,
  resolveBlobFieldById,
} from './blob-transform.js';
import { type PutBlobResult, deleteBlob, putBlob } from './blob-transport.js';
import { markDead } from './dead-keys.js';
import { enqueueBlobPut } from './enqueue.js';
import { resetEngineStateForNewLink } from './link-reset.js';
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
  beginAttentionCycle,
  checkEpoch,
  clearQuotaOnAcceptedWrite,
  getSyncState,
  setAttention,
  setPulling,
  settleTransientAttention,
  takeSuppressedRevs,
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

type SealBlobFn = (
  mk: MasterKey,
  blobId: string,
  bytes: Uint8Array,
) => Promise<{ body: Uint8Array; hash: Uint8Array }>;
type PutBlobFn = (blobId: string, body: Uint8Array, hash: string) => Promise<PutBlobResult>;
type DeleteBlobFn = (blobId: string) => Promise<void>;

const defaultCrypto: SealCryptoDeps = { computeBlindId, sealRecord };
let cryptoOverride: Partial<SealCryptoDeps> | null = null;
let openRecordOverride: OpenRecordFn | null = null;
let pushOverride: PushTransport | null = null;
let pullOverride: PullTransport | null = null;
let sealBlobOverride: SealBlobFn | null = null;
let putBlobOverride: PutBlobFn | null = null;
let deleteBlobOverride: DeleteBlobFn | null = null;
let maxBatchBytes = DEFAULT_MAX_BATCH_BYTES;

/** Task 7 registers the pull loop here; defaults to a no-op until then. */
let pullLoop: () => Promise<void> = async () => undefined;
/** Task 9 registers epoch recovery here; defaults to a no-op until then. */
let recovery: () => Promise<void> = async () => undefined;
/** Boot registers the pending-collection backfill here; no-op until then. */
let backfill: () => Promise<void> = async () => undefined;

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
/** Test seam: intercept the binary blob transport + seal (WS-D §5 drain phases). */
export function _setBlobTransport(deps: {
  sealBlob?: SealBlobFn;
  putBlob?: PutBlobFn;
  deleteBlob?: DeleteBlobFn;
}): void {
  sealBlobOverride = deps.sealBlob ?? null;
  putBlobOverride = deps.putBlob ?? null;
  deleteBlobOverride = deps.deleteBlob ?? null;
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
/** Boot seam: register the backfill the cycle runs at its tail after drain+pull. */
export function _setBackfill(fn: () => Promise<void>): void {
  backfill = fn;
}
/** Test seam: restore every override to its production default. */
export function _resetWorkerForTests(): void {
  cryptoOverride = null;
  openRecordOverride = null;
  pushOverride = null;
  pullOverride = null;
  sealBlobOverride = null;
  putBlobOverride = null;
  deleteBlobOverride = null;
  maxBatchBytes = DEFAULT_MAX_BATCH_BYTES;
  pullLoop = async () => undefined;
  recovery = async () => undefined;
  backfill = async () => undefined;
  cycleMutex = false;
}

function activeCrypto(): SealCryptoDeps {
  return { ...defaultCrypto, ...cryptoOverride };
}
function activeOpenRecord(): OpenRecordFn {
  return openRecordOverride ?? openRecord;
}
function activeSealBlob(): SealBlobFn {
  return sealBlobOverride ?? sealBlob;
}
function activePutBlob(): PutBlobFn {
  return putBlobOverride ?? putBlob;
}
function activeDeleteBlob(): DeleteBlobFn {
  return deleteBlobOverride ?? deleteBlob;
}
/** The repair matrix's injected seal + transport, wired to the drain's seams. */
function blobRepairDeps(): BlobRepairDeps {
  return { sealBlob: activeSealBlob(), putBlob: activePutBlob() };
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

/** Serialise a `[collection, key]` pair for the blocked-key / ack lookup maps. */
function keyId(collection: SyncCollection, key: string): string {
  return `${collection}:${key}`;
}

/**
 * Drain the outbox once under the WS-D §5 phase order (load-bearing integrity,
 * §11.5): blob-puts FIRST (a puller must never resolve a committed record to a
 * blob the server has not seen), then record upserts + tombstones (WS-C's
 * phases), then blob-deletes LAST (an orphan is harmless, a dangling ref is a
 * hole). A failed put blocks only its OWN record's upsert this cycle; a
 * replaced-id delete waits for that record's `ok` ack and is suppressed on a
 * `conflict` (Larissa M-2). Never advances the watermark. No-ops when the MK or
 * `syncUrl` is unavailable, so the immediate path and the cycle share one impl.
 */
export async function drainOutbox(): Promise<DrainResult> {
  const db = getClientDataDb();
  const mk = useSessionStore.getState().mk;
  const syncUrl = effectiveSyncUrl();
  if (!mk || !syncUrl) return emptyDrain();

  // Terminally-refused entries (§3.4) never re-enter a drain phase: excluded
  // right after the read so they can neither hot-loop nor wedge the drain.
  const outbox = (await db.syncOutbox.orderBy('seq').toArray()).filter((r) => r.terminal !== true);
  if (outbox.length === 0) return emptyDrain();

  resetBlobRepairCycle();

  const recordRows = outbox.filter(
    (r): r is SyncOutboxRow & { op: 'upsert' | 'delete' } => r.op === 'upsert' || r.op === 'delete',
  );
  const blobPuts = outbox.filter((r) => r.op === 'blob-put');
  const blobDeletes = outbox.filter((r) => r.op === 'blob-delete');

  const seqsToDrop: number[] = [];

  // Coalescing (§5): a `blob-put` + `blob-delete` for the same never-pushed
  // blobId cancels to nothing (mirror of WS-C's create+delete L-4). Both entries
  // drop without any network op.
  const putIds = new Set(blobPuts.map((r) => r.blobId).filter((b): b is string => Boolean(b)));
  const cancelledIds = new Set<string>();
  for (const del of blobDeletes) {
    if (del.blobId && putIds.has(del.blobId)) cancelledIds.add(del.blobId);
  }
  for (const row of [...blobPuts, ...blobDeletes]) {
    if (row.blobId && cancelledIds.has(row.blobId) && row.seq !== undefined) {
      seqsToDrop.push(row.seq);
    }
  }

  // A server-accepted, quota-charged write this drain (a stored blob or a push
  // `ok`) is the positive signal that retires a `quota_exceeded` banner (§11.3).
  let acceptedWrite = false;

  // ===== Phase 1: blob-puts (§5) =====
  const blockedKeys = new Set<string>();
  for (const put of blobPuts) {
    if (put.blobId && cancelledIds.has(put.blobId)) continue; // coalesced away
    const disposition = await drainBlobPut(mk, put);
    if (disposition.accepted) acceptedWrite = true;
    if (disposition.drop && put.seq !== undefined) seqsToDrop.push(put.seq);
    if (disposition.block) blockedKeys.add(keyId(put.collection, put.key));
  }

  // ===== Phase 2: record upserts + tombstones (WS-C's phases) =====
  const groups = coalesce(recordRows);
  const upsertKeys = new Set<string>();
  const prepared: PreparedRecord[] = [];
  const crypto = activeCrypto();
  for (const group of groups) {
    const kid = keyId(group.collection, group.key);
    // A record whose blob-put failed this cycle is held back (ordering §5): its
    // outbox entry stays, so it re-pushes once the blob lands.
    if (blockedKeys.has(kid)) continue;
    if (group.op === 'upsert') upsertKeys.add(kid);

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
    const prep = await prepareRecord(crypto, mk, entry);
    if (prep.newBlobs.length > 0) {
      // Seal-time mint fallback (WS-D §5, Option A): heal the live row with the
      // minted refs + enqueue their PUTs, then HOLD this record back this cycle
      // (keep its outbox entry). It re-seals next cycle with the now-stable ref
      // (no re-mint), and Phase 1 uploads the blob BEFORE the record is pushed
      // (§11.5). Never push a record carrying a ref whose bytes are not uploaded.
      await healSealMintedBlobs(group.collection, group.key, prep.newBlobs);
      continue;
    }
    prepared.push(prep);
  }

  let head: number | null = null;
  let epoch: string | null = null;
  let pushedHighestRev = 0;
  let needsPull = false;
  /** Per-key record ack, gating the phase-3 replaced-id deletes (M-2). */
  const ackByKey = new Map<string, 'ok' | 'conflict' | 'tombstoned' | 'error'>();

  if (prepared.length > 0) {
    const push = pushOverride ?? ((records: SyncPushRecord[]) => defaultPush(syncUrl, records));
    const batches = batchByBytes(prepared, maxBatchBytes);

    for (const batch of batches) {
      let response: SyncPushResponse;
      try {
        response = await push(batch.map((p) => p.record));
      } catch (err) {
        // A 413 `body_too_large` is a whole-request refusal from the body-limit
        // middleware, not a per-record result. Batches are byte-capped
        // (DEFAULT_MAX_BATCH_BYTES, 4 MiB) well below the server's 24 MiB body
        // limit, so only a SINGLE record whose sealed body exceeds it can trigger
        // this. Mark it terminal — exactly as a per-record `record_too_large`
        // would be — so it stops wedging the drain on every cycle, and raise the
        // same attention. Anything else propagates (transient failure retries).
        if (err instanceof HttpError && err.status === 413 && batch.length === 1) {
          const only = batch[0];
          if (only) {
            await markTerminal(only);
            await applyError({ code: 'record_too_large' });
          }
          continue;
        }
        throw err;
      }
      head = response.head;
      epoch = response.epoch;

      for (let i = 0; i < batch.length; i++) {
        const prep = batch[i];
        const result = response.results[i];
        if (!prep || !result) continue;
        ackByKey.set(keyId(prep.collection, prep.key), result.status);

        if (result.status === 'ok') {
          acceptedWrite = true;
          pushedHighestRev = Math.max(pushedHighestRev, result.rev);
          await applyOk(prep, result.rev);
        } else if (result.status === 'conflict') {
          needsPull = (await applyConflict(mk, prep, result.current)) || needsPull;
        } else if (result.status === 'tombstoned') {
          await applyTombstoned(prep);
        } else {
          if (result.code === 'record_too_large') await markTerminal(prep);
          await applyError(result);
        }
      }
    }
  }

  // ===== Phase 3: blob-deletes LAST (§5) =====
  for (const del of blobDeletes) {
    if (!del.blobId || cancelledIds.has(del.blobId)) continue;
    const kid = keyId(del.collection, del.key);
    // A replaced-id delete (its record was upserted this cycle) waits for the
    // `ok` ack; a `conflict` means the old ref may still be live under LWW, so
    // deleting the old blob would destroy a live object — DEFER it (Larissa M-2).
    if (upsertKeys.has(kid) && ackByKey.get(kid) !== 'ok') continue;
    try {
      await activeDeleteBlob()(del.blobId);
      noteBlobLocallyRemoved(del.blobId);
      if (del.seq !== undefined) seqsToDrop.push(del.seq);
    } catch {
      // A failed delete (rate limit / network) keeps its entry: an orphaned blob
      // is quota-charged but harmless, and the delete retries next cycle.
    }
  }

  if (seqsToDrop.length > 0) await db.syncOutbox.bulkDelete(seqsToDrop);

  // §11.3 — a quota-charged write landed this drain: if no quota rejection was
  // raised alongside it, the account is back under quota — retire the banner.
  if (acceptedWrite) await clearQuotaOnAcceptedWrite();

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

/**
 * Drain one `blob-put` (§5 phase 1): read the bytes from the LIVE row only
 * (Larissa L-1 — no trash-read upload path), seal deterministically, and PUT.
 * Success drops the entry; a typed failure delegates to the §7 repair matrix and
 * maps its disposition to the drain's drop/block bookkeeping. Bytes nowhere
 * locally → drop with a diagnostic.
 */
async function drainBlobPut(
  mk: MasterKey,
  put: SyncOutboxRow,
): Promise<{ drop: boolean; block: boolean; accepted: boolean }> {
  if (!put.blobId) return { drop: true, block: false, accepted: false }; // malformed entry
  const row = await readLocalRow(put.collection, put.key);
  const bytesBlob = row ? readBlobBytesById(put.collection, row, put.blobId) : undefined;
  if (!bytesBlob) return { drop: true, block: false, accepted: false }; // bytes gone — diagnostic drop

  const field = resolveBlobFieldById(put.collection, row, put.blobId);
  const bytes = new Uint8Array(await bytesBlob.arrayBuffer());
  const sealed = await activeSealBlob()(mk, put.blobId, bytes);
  const result = await activePutBlob()(put.blobId, sealed.body, toBase64Url(sealed.hash));

  // A stored blob is a server-accepted, quota-charged write — the positive signal
  // that retires a `quota_exceeded` banner (§11.3).
  if (result.status === 'created' || result.status === 'ok') {
    return { drop: true, block: false, accepted: true };
  }

  const ctx: BlobFailureContext = {
    collection: put.collection,
    key: put.key,
    blobId: put.blobId,
    refField: field?.refField ?? '',
    oversizedField: field?.oversizedField ?? '',
    bytes,
    mk,
  };
  const disposition = await resolveBlobFailure(putFailureFor(result), ctx, blobRepairDeps());
  return { ...dispositionToDrain(disposition), accepted: false };
}

/**
 * Consume the seal-time mint fallback (WS-D §5, Option A): write each minted
 * `BlobRef` back onto the live row and enqueue its `blob-put`, both in ONE
 * transaction. The caller holds the record back this cycle (keeps its outbox
 * entry) so Phase 1 uploads the blob before the record is ever pushed (§11.5),
 * and the stable ref means the next re-seal takes the ref-reuse branch — no id
 * churn. Guarded so a ref a concurrent write-site mint may already have set is
 * never clobbered (and no orphan blob-put is queued for an id the row no longer
 * names).
 */
async function healSealMintedBlobs(
  collection: SyncCollection,
  key: string,
  newBlobs: NewBlob[],
): Promise<void> {
  const db = getClientDataDb();
  await db.transaction('rw', [db.table(collection), db.syncOutbox], async (tx) => {
    const row = await tx.table(collection).get(key);
    if (!row) return; // row gone — the held record drops next cycle
    for (const nb of newBlobs) {
      if (isBlobRef((row as Record<string, unknown>)[nb.refField])) continue;
      await tx.table(collection).update(key, { [nb.refField]: nb.ref });
      enqueueBlobPut(tx, collection, key, nb.blobId);
    }
  });
}

/** Map a non-2xx PUT verdict to the §7 repair matrix's failure descriptor. */
function putFailureFor(result: PutBlobResult): BlobFailure {
  switch (result.status) {
    case 'blob_too_large':
      return { kind: 'put-too-large', maxBlobBytes: result.maxBlobBytes };
    case 'quota_exceeded':
      return { kind: 'put-quota', usedBytes: result.usedBytes, quotaBytes: result.quotaBytes };
    case 'blob_exists':
      return { kind: 'put-exists' };
    default:
      return {
        kind: 'put-error',
        httpStatus: result.status === 'error' ? result.httpStatus : undefined,
      };
  }
}

/** Translate a repair disposition into the drain's drop/block bookkeeping (§5/§7). */
function dispositionToDrain(disposition: string): { drop: boolean; block: boolean } {
  switch (disposition) {
    case 'terminal': // 413 sentinel / cap exhausted: the record syncs regardless
    case 'reissued': // handled via a fresh id + Class-2 update; the live row is safe
    case 'repaired':
    case 'clear':
      return { drop: true, block: false };
    default: // keep-block / placeholder / suppressed: keep the entry, hold the record
      return { drop: false, block: true };
  }
}

/** POST a batch to the sync server (bearer + refresh via `apiFetch`). */
function defaultPush(syncUrl: string, records: SyncPushRecord[]): Promise<SyncPushResponse> {
  return apiFetch<SyncPushResponse>({
    baseUrl: syncUrl,
    path: '/api/v1/sync/changes',
    json: { records },
    authMode: 'bearer',
    credentials: 'omit', // the sync service is cookie-free (CORS: no credentials)
    origin: 'background', // §5.2: a refused refresh latches auth-degraded, never logs out
  });
}

/**
 * §3.4 terminal disposition: a `record_too_large` refusal is permanent for
 * this payload — mark the covered outbox entries so they stop draining. The
 * attention state (raised by `applyError`) names the condition; a later
 * smaller edit enqueues afresh and `applyOk` sweeps the sentinel.
 */
async function markTerminal(prep: PreparedRecord): Promise<void> {
  const db = getClientDataDb();
  for (const seq of prep.seqs) {
    await db.syncOutbox.update(seq, { terminal: true as const });
  }
}

/**
 * `ok`: adopt the server rev. An upsert records the LOCALLY-computed ciphertext
 * hash for the §7.0 echo shortcut; a delete removes the now-dead `syncRows`
 * entry. Either way the covered outbox seqs are cleared.
 */
async function applyOk(prep: PreparedRecord, rev: number): Promise<void> {
  const db = getClientDataDb();
  let sweptTerminal = 0;
  await db.transaction('rw', [db.syncRows, db.syncOutbox, db.deadKeys], async () => {
    if (prep.op === 'delete') {
      await db.syncRows.delete([prep.collection, prep.key]);
      // §3.9: mark the key dead at the server-authoritative ack, never at enqueue —
      // this lets a fast-Undo before the drain stay identity-preserving (Task 8).
      await markDead(prep.collection, prep.key);
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
    // §3.4: a later smaller edit that acks clears any lingering terminal sentinel
    // for this key. Only terminal rows — a racing live-edit's entry must survive.
    sweptTerminal = await db.syncOutbox
      .where('[collection+key]')
      .equals([prep.collection, prep.key])
      .and((r) => r.terminal === true)
      .delete();
  });
  // Audit #5: the server-authoritative delete ack is terminal for this key — clear
  // any suppressed-rev the Undo rewind would have consumed (its own transaction, so
  // called OUTSIDE the scope above, which does not include `syncState`).
  if (prep.op === 'delete') {
    await takeSuppressedRevs([{ collection: prep.collection, key: prep.key }]);
  }
  // §11.3 — a swept terminal sentinel means a previously oversize record just
  // synced under a smaller edit: retire the global `record_too_large` banner (its
  // durable, per-item signal is the §10 item marker, not this status line). Only
  // once NO terminal sentinel remains anywhere in the outbox — `record_too_large`
  // is the sole terminal cause (`markTerminal`), so a leftover means another
  // oversize item is still unsynced and the banner must stay up (Larissa round 2).
  if (sweptTerminal > 0) {
    const remainingTerminal = await db.syncOutbox.filter((r) => r.terminal === true).count();
    if (remainingTerminal === 0) {
      const { attention } = await getSyncState();
      if (attention?.kind === 'record_too_large') await setAttention(null);
    }
  }
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
    [db.syncRows, db.syncOutbox, db.trash, db.deadKeys, db.table(prep.collection)],
    async () => {
      if (local !== undefined && local !== null) {
        const meta = deriveLegacyTrashMeta(prep.collection, prep.key, local);
        const trashRow: TrashRow = {
          id: `${prep.collection}:${prep.key}`,
          collection: prep.collection,
          key: prep.key,
          row: local,
          deletedAt: now,
          purgeAt: now + THIRTY_DAYS_MS,
          entityKind: meta.entityKind,
          rootGroup: meta.rootGroup,
          parentRef: meta.parentRef,
        };
        await db.trash.put(trashRow);
        await db.table(prep.collection).delete(prep.key);
      }
      await db.syncRows.delete([prep.collection, prep.key]);
      // §3.9: the key's identity is terminal even with no local row to snapshot,
      // so mark it dead unconditionally (mirrors apply.ts applyTombstone).
      await markDead(prep.collection, prep.key);
      await db.syncOutbox.bulkDelete(prep.seqs);
    },
  );
  // Audit #5: a server tombstone is terminal for this key — clear any suppressed-rev
  // the Undo rewind would have consumed (its own transaction, called OUTSIDE the
  // scope above, which does not include `syncState`).
  await takeSuppressedRevs([{ collection: prep.collection, key: prep.key }]);
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
 * Cycle-start server-identity guard (Task 4). A relink to a DIFFERENT server
 * account must reset the sync engine deterministically rather than relying
 * solely on the runtime epoch mismatch, which only fires once a push/pull
 * round-trip has actually happened against the new account. Compares the
 * identity stamped at link time (`resetEngineStateForNewLink`) against the
 * account currently linked in the crypto DB and, on a genuine mismatch, runs
 * the same reset a fresh link performs — which also re-stamps the identity,
 * so a repeat cycle is a no-op. Fires ONLY when both sides are known: a
 * first-ever link has nothing stamped yet (`undefined`), which is "unknown",
 * not "different", and must not trigger a reset that would clear a corpus
 * that was never actually synced under a stale identity.
 */
export async function enforceServerIdentity(): Promise<void> {
  const linked = await getLinkedAccount(getDb());
  const current = linked?.server_user_id;
  const stamped = (await getSyncState()).linkedServerUserId;
  if (stamped !== undefined && current !== undefined && stamped !== current) {
    await resetEngineStateForNewLink();
  }
}

/**
 * Run one sync cycle under a cross-tab single-flight lock (spec §6). No-ops
 * unless linked with a reachable server, an unlocked session, and the `sync`
 * feature present. Purges expired trash, enforces the server-identity guard
 * (Task 4), drains the outbox, then hands off to recovery (Task 9) or the
 * pull loop (Task 7) as the drain reports.
 */
export async function runSyncCycle(): Promise<void> {
  if (!canRunCycle()) return;
  await withSingleFlight(async () => {
    await purgeTrash();
    await enforceServerIdentity();
    // §11.3 — start tracking which attention kinds this cycle raises, so a stale
    // transient banner (rate-limit / quota) can retire once the cycle stays clean.
    beginAttentionCycle();
    const result = await drainOutbox();
    if (result.needsRecovery) {
      // Epoch mismatch — Task 9 re-syncs everything; skip the pull this cycle.
      // Recovery owns the attention state, so we do NOT settle transient banners here.
      await recovery();
      return;
    }
    // §11.3 — the drain completed without a recovery handoff: retire a stale
    // `delete_rate_limited` / `quota_exceeded` banner it did not re-raise.
    await settleTransientAttention();
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
    // Backfill handoff (tail of the cycle, inside the single-flight lock, AFTER
    // drain+pull): registered at boot via `_setBackfill`. Deliberately NOT reached
    // on a recovery-handoff cycle — recovery returns early above, and recovery
    // re-syncs everything wholesale, so a backfill on top would be redundant.
    await backfill();
  });
}

/** Cycle preconditions (spec §6): any miss → no-op. */
function canRunCycle(): boolean {
  // §5.2: a degraded engine (the auth service definitively refused a background
  // refresh) does no cycle work at all — no drain, no pull — until a relink
  // clears the latch. Local edits still enqueue; they drain once auth is restored.
  if (isAuthDegraded()) return false;
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
    credentials: 'omit', // the sync service is cookie-free (CORS: no credentials)
    origin: 'background', // §5.2: a refused refresh latches auth-degraded, never logs out
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
  const syncUrl = effectiveSyncUrl();
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
    let applied = 0; // tombstones APPLIED this cycle, across pages — the cap is per-cycle
    while (more && pages < PULL_PAGE_CAP) {
      const { watermarkRev } = await getSyncState();
      let response: SyncPullResponse;
      try {
        response = await pull(watermarkRev, PULL_PAGE_LIMIT);
      } catch (err) {
        // 400 bad_since: the watermark is ahead of this account's head — an
        // authenticated signal of account-level divergence (a relink or a
        // server account reset). Same remedy as an epoch mismatch: full
        // recovery (§3.2, Larissa L-1 defence-in-depth).
        if (err instanceof HttpError && err.code === 'bad_since') {
          await recovery();
          return;
        }
        throw err;
      }
      pages += 1;
      await setPulling({ pages, startedAt });

      // §8 — an authenticated response with a differing epoch aborts the cycle.
      if ((await checkEpoch(response.epoch)) === 'mismatch') {
        await recovery();
        return;
      }

      // Normalise ordering client-side (M-7: never trust the server's order).
      // Ascending rev means deferred tombstones are always the high-rev tail, so
      // the watermark advances through the applied prefix and progress is
      // guaranteed even against an adversarial page (no stall, no re-apply waste).
      const ordered = [...response.records].sort((a, b) => a.rev - b.rev);
      let lowestDeferredRev: number | null = null; // per PAGE
      let highestApplied = watermarkRev; // per PAGE, seeded from this page's since
      let cappedThisCycle = false; // per PAGE (drives this page's `more`)
      let engineUnavailable = false; // the MK vanished mid-page (audit finding #1)
      for (const record of ordered) {
        if (record.rev <= watermarkRev) continue; // L-B: honest servers never send these
        if (record.deleted && applied >= TOMBSTONE_CYCLE_CAP) {
          lowestDeferredRev =
            lowestDeferredRev === null ? record.rev : Math.min(lowestDeferredRev, record.rev);
          cappedThisCycle = true;
          continue; // defer this tombstone; keep scanning the page for the true minimum
        }
        const outcome = await applyRecord(record);
        if (outcome.kind === 'unavailable') {
          // Engine loss (locked/forgotten session): this record and the rest of the
          // page were NOT absorbed, so they are never counted into `highestApplied`.
          // Abort the page and hold the watermark — advancing past the unapplied tail
          // would be permanent loss (the server only serves rev > since).
          engineUnavailable = true;
          break;
        }
        if (record.deleted) applied += 1; // accumulates across pages (cycle-scoped `applied`)
        if (record.rev > highestApplied) highestApplied = record.rev;
      }
      // Watermark: hold below the lowest deferred rev, else advance to highest applied.
      // Everything up to `highestApplied` was durably absorbed, so persisting it is
      // safe even on an engine-loss abort; the deferred-tombstone `min` still wins
      // (holding the lower watermark is always safe).
      const nextWatermark = lowestDeferredRev !== null ? lowestDeferredRev - 1 : highestApplied;
      await advanceWatermark(nextWatermark); // monotone clamp inside
      flushInvalidations();

      // Engine-loss abort: stop the whole loop now (the finally still clears
      // `pulling`), BEFORE deciding `more` — the next unlocked cycle resumes from
      // the held watermark.
      if (engineUnavailable) return;

      // L-A: once the cap trips, stop paging this cycle (the next trigger resumes).
      more = cappedThisCycle ? false : response.more;
    }
    // §7.3a — a completed cycle that stayed below the threshold retires a stale
    // tombstone notice, so a one-off mass deletion no longer sticks forever. The
    // recovery/bad-since early returns above skip this deliberately (they hand
    // off to recovery, which owns the attention state).
    await settleTombstoneNotice();
  } finally {
    await setPulling(null);
  }
}

// Register the real pull loop as the cycle default (tests override via _setPullLoop).
pullLoop = runPullLoop;
