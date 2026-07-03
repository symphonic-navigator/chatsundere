// SPDX-License-Identifier: AGPL-3.0-only
import { mintBlobId, toBase64Url } from '@chatsundere/crypto';
import type { MasterKey } from '@chatsundere/crypto';
import type { BlobRef, SyncCollection } from '@chatsundere/shared-types';
import { getClientDataDb } from '../boot/client-data-db.js';
import type { PutBlobResult } from './blob-transport.js';
import { enqueueBlobDelete, enqueueSync } from './enqueue.js';
import { setAttention } from './watermark.js';

/**
 * Bounded blob repair (WS-D §7) — LARISSA-AUDITED. The residual failure matrix
 * behind a single {@link resolveBlobFailure} entry point, plus the proactive
 * heal (§7.2 M-2b). Every repair PUT rides `sealBlob`'s deterministic idempotency
 * (`packages/crypto` sync-blob): a re-seal of `(mk, blobId, bytes)` is byte
 * identical, so `201` (row lost) and `200` (object present) both heal.
 *
 * SECURITY (spec §11) `[L]`:
 *  - `x-ciphertext-hash` is the LOCAL seal output on every repair PUT (§11.2);
 *    the server hash is never read.
 *  - 409 / open-fail are cryptographic evidence of server misbehaviour → they
 *    raise the WS-C tamper attention, never silent churn (§7.2 / M-1).
 *  - the fresh-id repair is the NAMED, capped exception to WS-C §12.3's
 *    no-server-induced-mutation posture (§7.2): one attempt per blobId, a
 *    per-cycle repair budget, then 3 failed generations → a permanent
 *    placeholder + persistent attention. Nothing here is uncapped.
 *  - blobIds are always `mintBlobId()` random (§11.3); a fresh id is never
 *    content-derived and never shares a ref.
 */

/** Per-cycle GET retry budget shared across all dangling refs (§7.1, default 16). */
const DEFAULT_GET_BUDGET = 16;
/** Per-cycle fresh-id repair budget (§7.2, default 2). */
const DEFAULT_REPAIR_BUDGET = 2;
/** Consecutive 404s before a dangling ref rests until next session (§7.1, default 8). */
const REST_AFTER_CONSECUTIVE_404 = 8;
/** Failed fresh-id generations before a permanent placeholder (§7.2, default 3). */
const MAX_FRESH_ID_GENERATIONS = 3;

/** The seal + transport the repair paths consume (injected so tests need no network). */
export interface BlobRepairDeps {
  sealBlob: (
    mk: MasterKey,
    blobId: string,
    bytes: Uint8Array,
  ) => Promise<{
    body: Uint8Array;
    hash: Uint8Array;
  }>;
  putBlob: (blobId: string, body: Uint8Array, hash: string) => Promise<PutBlobResult>;
}

/** The failure that triggered a repair, tagged by its origin (§7 matrix). */
export type BlobFailure =
  | { kind: 'put-too-large'; maxBlobBytes?: number } // PUT 413 (§7.3)
  | { kind: 'put-quota'; usedBytes?: number; quotaBytes?: number } // PUT 507 (§7.3)
  | { kind: 'put-exists' } // PUT 409 — tamper (§7.2)
  | { kind: 'put-error'; httpStatus?: number } // PUT other/network
  | { kind: 'get-not-found' } // GET 404 — dangling ref (§7.1)
  | { kind: 'get-disabled' } // GET 501 (§7.3)
  | { kind: 'get-corrupt' }; // size-gate abort OR openBlob fail — tamper (§7.2)

/** Where the failure lives, and whether this device still holds the bytes. */
export interface BlobFailureContext {
  collection: SyncCollection;
  key: string;
  blobId: string;
  /** The persisted `BlobRef` field the blob belongs to (e.g. `blobRef`). */
  refField: string;
  /** The durable §7.3 oversize sentinel field (e.g. `blobOversized`). */
  oversizedField: string;
  /** Local plaintext bytes when this device holds them — drives repair vs placeholder. */
  bytes?: Uint8Array;
  mk: MasterKey;
}

/**
 * The disposition the caller (drain phase 1, or the fetch layer) acts on:
 *  - `clear`     — nothing more to do (unused for failures; symmetry only).
 *  - `terminal`  — permanent placeholder; retry is suppressed forever (413,
 *                  the §7.1 rest state, or 3-generation cap exhaustion).
 *  - `keep-block`— PUT path: keep the outbox entry and BLOCK the owning record's
 *                  upsert this cycle (ordering §5); retry next cycle.
 *  - `repaired`  — a same-id re-PUT healed a dangling ref (§7.1).
 *  - `reissued`  — a fresh-id repair replaced a corrupt/foreign blob (§7.2);
 *                  a Class-2 record update + deferred old-id delete were queued.
 *  - `placeholder` — pending placeholder; a scheduled retry is owed (§7.1).
 *  - `suppressed`— disabled, not missing; retry suppressed until config changes.
 */
export type BlobFailureDisposition =
  | 'clear'
  | 'terminal'
  | 'keep-block'
  | 'repaired'
  | 'reissued'
  | 'placeholder'
  | 'suppressed';

// ===== Per-cycle + cross-cycle bounded state (§7.1/§7.2 caps) =====

let getBudget = DEFAULT_GET_BUDGET;
let repairBudget = DEFAULT_REPAIR_BUDGET;
/** Consecutive-404 tally per blobId (rests the ref at the threshold, §7.1). */
const consecutive404 = new Map<string, number>();
/** Failed fresh-id generations per logical blob `${collection}:${key}:${refField}` (§7.2). */
const generations = new Map<string, number>();
/** Blobs already given their one fresh-id attempt this cycle (§7.2 "one per blobId"). */
const reissuedThisCycle = new Set<string>();
/** 501 suppression, keyed to the config signature it was observed under (§7.3). */
let disabledSignature: string | null = null;
/** blobIds this device deleted or replaced — the proactive-heal trigger set (§7.2 M-2b). */
const locallyRemoved = new Set<string>();

/** Reset the per-cycle budgets/attempt set (the drain/pull loop calls this at cycle start). */
export function resetBlobRepairCycle(): void {
  getBudget = DEFAULT_GET_BUDGET;
  repairBudget = DEFAULT_REPAIR_BUDGET;
  reissuedThisCycle.clear();
}

/** Test seam: restore every counter, budget, and cross-cycle set to its default. */
export function _resetBlobRepairForTests(): void {
  getBudget = DEFAULT_GET_BUDGET;
  repairBudget = DEFAULT_REPAIR_BUDGET;
  consecutive404.clear();
  generations.clear();
  reissuedThisCycle.clear();
  disabledSignature = null;
  locallyRemoved.clear();
}

/** Note a blobId this device just deleted or replaced — arms the §7.2 proactive heal. */
export function noteBlobLocallyRemoved(blobId: string): void {
  locallyRemoved.add(blobId);
}

/**
 * Re-probe suppression after a `/api/v1/config` change (§7.3): a 501 suppression
 * is cleared when the current config signature differs from the one it was set
 * under, so a re-enabled instance resumes fetching without a reload.
 */
export function reprobeDisabled(configSignature: string): void {
  if (disabledSignature !== null && disabledSignature !== configSignature) {
    disabledSignature = null;
  }
}

// ===== The single entry point (§7 matrix) =====

/**
 * Resolve one blob failure per the §7 matrix, performing the side effects
 * (sentinel set, tamper/quota attention, fresh-id repair) and returning the
 * caller's disposition. All caps are enforced here — no path loops unbounded.
 */
export async function resolveBlobFailure(
  failure: BlobFailure,
  ctx: BlobFailureContext,
  deps: BlobRepairDeps,
): Promise<BlobFailureDisposition> {
  switch (failure.kind) {
    case 'put-too-large':
      return oversizeSentinel(ctx, failure.maxBlobBytes);
    case 'put-quota':
      await setAttention({
        kind: 'quota_exceeded',
        usedBytes: failure.usedBytes ?? 0,
        quotaBytes: failure.quotaBytes ?? 0,
      });
      return 'keep-block';
    case 'put-error':
      // A transient network/other error: keep the entry and block the record
      // upsert this cycle; no attention noise for a plain network blip.
      return 'keep-block';
    case 'put-exists':
    case 'get-corrupt':
      // Both are cryptographic evidence of server/storage misbehaviour (§7.2).
      return reissue(ctx, deps);
    case 'get-not-found':
      return dangling(ctx, deps);
    case 'get-disabled':
      return 'suppressed';
  }
}

/**
 * PUT 413 (§7.3): set the durable oversize sentinel on the row (a Class-2 record
 * update, so every device learns it), re-enqueue the record upsert to carry it,
 * and drop the failed put. The record then syncs WITHOUT server bytes and remote
 * devices render the terminal placeholder — never a retry loop (Laura hard).
 */
async function oversizeSentinel(
  ctx: BlobFailureContext,
  _maxBlobBytes: number | undefined,
): Promise<BlobFailureDisposition> {
  const db = getClientDataDb();
  await db.transaction('rw', db.table(ctx.collection), db.syncOutbox, async (tx) => {
    // biome-ignore lint/suspicious/noExplicitAny: Dexie's per-table patch type is opaque here.
    await tx.table(ctx.collection).update(ctx.key, { [ctx.oversizedField]: true } as any);
    enqueueSync(tx, ctx.collection, ctx.key, 'upsert');
  });
  return 'terminal';
}

/**
 * GET 404 (§7.1): a dangling ref. With local bytes → an idempotent repair PUT
 * (same id), drawing from the shared per-cycle GET budget; without → a scheduled
 * placeholder retry. After {@link REST_AFTER_CONSECUTIVE_404} consecutive
 * failures the ref rests until next session (terminal placeholder + manual retry).
 */
async function dangling(
  ctx: BlobFailureContext,
  deps: BlobRepairDeps,
): Promise<BlobFailureDisposition> {
  if ((consecutive404.get(ctx.blobId) ?? 0) >= REST_AFTER_CONSECUTIVE_404) return 'terminal';
  if (getBudget <= 0) return 'placeholder'; // budget spent this cycle — retry next
  getBudget -= 1;

  if (ctx.bytes) {
    const { body, hash } = await deps.sealBlob(ctx.mk, ctx.blobId, ctx.bytes);
    const result = await deps.putBlob(ctx.blobId, body, toBase64Url(hash));
    if (result.status === 'created' || result.status === 'ok') {
      consecutive404.delete(ctx.blobId);
      return 'repaired';
    }
    // A repair PUT that returns 409 is corrupt/foreign state → escalate to §7.2.
    if (result.status === 'blob_exists') return reissue(ctx, deps);
  }

  consecutive404.set(ctx.blobId, (consecutive404.get(ctx.blobId) ?? 0) + 1);
  return 'placeholder';
}

/**
 * §7.2 corrupt/foreign stored state → fresh-id repair under the cap. Raises the
 * tamper attention on every occurrence (cryptographic evidence), then — with
 * local bytes and budget — mints a fresh blobId, PUTs it, and queues a Class-2
 * record update carrying the new ref plus a deferred delete of the old id. One
 * attempt per blobId per cycle; 3 failed generations → permanent placeholder.
 */
async function reissue(
  ctx: BlobFailureContext,
  deps: BlobRepairDeps,
): Promise<BlobFailureDisposition> {
  await setAttention({ kind: 'tamper' });

  const logical = `${ctx.collection}:${ctx.key}:${ctx.refField}`;
  if ((generations.get(logical) ?? 0) >= MAX_FRESH_ID_GENERATIONS) return 'terminal';
  if (!ctx.bytes) return 'placeholder'; // no local bytes → placeholder + diagnostic
  if (reissuedThisCycle.has(ctx.blobId)) return 'keep-block'; // one attempt per blobId
  if (repairBudget <= 0) return 'keep-block'; // per-cycle budget spent — retry next
  reissuedThisCycle.add(ctx.blobId);
  repairBudget -= 1;

  const newId = mintBlobId();
  const { body, hash } = await deps.sealBlob(ctx.mk, newId, ctx.bytes);
  const result = await deps.putBlob(newId, body, toBase64Url(hash));

  if (result.status === 'created' || result.status === 'ok') {
    await applyFreshRef(ctx, newId, body.length);
    generations.delete(logical);
    return 'reissued';
  }

  const failed = (generations.get(logical) ?? 0) + 1;
  generations.set(logical, failed);
  return failed >= MAX_FRESH_ID_GENERATIONS ? 'terminal' : 'keep-block';
}

/**
 * Commit a fresh-id repair (§7.2): swap the row's ref to the new blob, enqueue
 * the Class-2 record upsert that carries it, and enqueue the DEFERRED delete of
 * the old id (drain phase 3 gates it on the record's `ok` ack, Larissa M-2). The
 * old id joins the proactive-heal set so a byte-holding device closes the race.
 */
async function applyFreshRef(
  ctx: BlobFailureContext,
  newBlobId: string,
  newBytes: number,
): Promise<void> {
  const db = getClientDataDb();
  const newRef: BlobRef = { blobId: newBlobId, bytes: newBytes };
  await db.transaction('rw', db.table(ctx.collection), db.syncOutbox, async (tx) => {
    // biome-ignore lint/suspicious/noExplicitAny: Dexie's per-table patch type is opaque here.
    await tx.table(ctx.collection).update(ctx.key, { [ctx.refField]: newRef } as any);
    enqueueSync(tx, ctx.collection, ctx.key, 'upsert');
    enqueueBlobDelete(tx, ctx.collection, ctx.key, ctx.blobId);
  });
  noteBlobLocallyRemoved(ctx.blobId);
}

/**
 * Proactive heal (§7.2 M-2b): on pulling a record whose ref points at a blob
 * this device holds bytes for AND whose id this device previously deleted or
 * replaced, schedule an idempotent repair-PUT — closing the LWW-vs-delete race
 * for the byte-holder. A no-op otherwise. Returns whether it healed.
 */
export async function maybeProactiveHeal(
  ctx: { blobId: string; bytes: Uint8Array; mk: MasterKey },
  deps: BlobRepairDeps,
): Promise<boolean> {
  if (!locallyRemoved.has(ctx.blobId)) return false;
  const { body, hash } = await deps.sealBlob(ctx.mk, ctx.blobId, ctx.bytes);
  const result = await deps.putBlob(ctx.blobId, body, toBase64Url(hash));
  if (result.status === 'created' || result.status === 'ok') {
    locallyRemoved.delete(ctx.blobId);
    return true;
  }
  return false;
}
