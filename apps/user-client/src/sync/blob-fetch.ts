// SPDX-License-Identifier: AGPL-3.0-only
import { openBlob, sealBlob } from '@chatsundere/crypto';
import type { MasterKey } from '@chatsundere/crypto';
import type { BlobRef, SyncCollection } from '@chatsundere/shared-types';
import { useSessionStore } from '@chatsundere/ui-shared';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getClientDataDb } from '../boot/client-data-db.js';
import { QK } from '../data/queryKeys.js';
import { queryClient } from '../lib/queryClient.js';
import {
  type BlobFailure,
  type BlobFailureContext,
  type BlobRepairDeps,
  resetBlobRepairCycle,
  resolveBlobFailure,
} from './blob-repair.js';
import { resolveBlobFieldByName } from './blob-transform.js';
import {
  BlobCorruptBodyError,
  BlobNotFoundError,
  BlobsDisabledError,
  getBlob,
  putBlob,
} from './blob-transport.js';

/**
 * The fetch strategy (WS-D §6). Two consumers of one core downloader:
 *  - an **eager queue** (concurrency 3, view-priority boost) that thumbnails and
 *    avatars enter at apply, so a fresh link or bulk pull pictures itself without
 *    the user asking (§6, Laura view-priority);
 *  - a **lazy resolver** ({@link useBlobBytes}) that artefact originals and
 *    attachment images use, kicking a single fetch when their surface first
 *    renders the placeholder row.
 *
 * Both write the opened plaintext onto the row's `Blob` field in Dexie — the
 * local store IS the cache, no second layer (§6). A GET failure routes to the
 * §7 repair matrix under the shared per-cycle GET retry budget; an over-ref-size
 * stream (transport size gate) or an `openBlob` failure is a corrupt body (§7.2)
 * and NEVER a partial write to the row.
 *
 * SECURITY (spec §11) `[L]`:
 *  - `openBlob` authenticates the body against `(MK, blobId)` (GCM+AAD); an open
 *    failure fails closed into §7.2's capped, tamper-flagged repair without ever
 *    touching the referencing record (§11.4).
 *  - the ref that drives every GET is the MK-authenticated `BlobRef` from the
 *    sealed record; the transport's §6 size gate bounds the download (§11.4).
 */

/** Eager-queue concurrency (WS-D §6). Overridable in tests for ordering assertions. */
const DEFAULT_CONCURRENCY = 3;

/** The typed state a lazy resolver reports for one row's blob field (§10). */
export type BlobBytesState = 'placeholder' | 'loading' | 'ready' | 'terminal';

/** The outcome of one fetch attempt, mapped from the §7 repair disposition. */
type FetchOutcome =
  | { state: 'ready'; bytes: Blob }
  | { state: 'placeholder' } // pending, retriable
  | { state: 'terminal' }; // suppressed forever (oversize / rest / cap / disabled)

/** One queued eager fetch (§6). `bytesField` names the local `Blob` field to hydrate. */
interface EagerEntry {
  collection: SyncCollection;
  key: string;
  bytesField: string;
  ref: BlobRef;
  /** View-priority (Laura): a boosted entry jumps ahead of plain FIFO entries. */
  boosted: boolean;
}

// ===== Injectable seams (production defaults; tests override) =====

interface BlobFetchDeps {
  getBlob: (ref: BlobRef) => Promise<Uint8Array>;
  openBlob: (mk: MasterKey, blobId: string, body: Uint8Array) => Promise<Uint8Array>;
  getMk: () => MasterKey | null;
  invalidate: (keys: readonly (readonly unknown[])[]) => void;
  resolveBlobFailure: (
    failure: BlobFailure,
    ctx: BlobFailureContext,
    repairDeps: BlobRepairDeps,
  ) => Promise<string>;
  resetBlobRepairCycle: () => void;
  repairDeps: BlobRepairDeps;
}

function defaultInvalidate(keys: readonly (readonly unknown[])[]): void {
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: [...key] });
}

function productionDeps(): BlobFetchDeps {
  return {
    getBlob,
    openBlob,
    getMk: () => useSessionStore.getState().mk,
    invalidate: defaultInvalidate,
    resolveBlobFailure,
    resetBlobRepairCycle,
    repairDeps: { sealBlob, putBlob },
  };
}

let deps: BlobFetchDeps = productionDeps();
let concurrency = DEFAULT_CONCURRENCY;

/** Test seam: override transport/crypto/repair so fetch tests need no network. */
export function _setBlobFetchDeps(overrides: Partial<BlobFetchDeps>): void {
  deps = { ...deps, ...overrides };
}
/** Test seam: shrink the eager concurrency ceiling for ordering assertions. */
export function _setEagerConcurrency(n: number): void {
  concurrency = n;
}
/** Test seam: restore every override + drain the in-memory queues/maps. */
export function _resetBlobFetchForTests(): void {
  deps = productionDeps();
  concurrency = DEFAULT_CONCURRENCY;
  queue.length = 0;
  inflight.clear();
  eagerActive = 0;
  passStarted = false;
  notifyEager();
}

// ===== The shared downloader core =====

/** Serialise a row's blob field to dedupe concurrent fetches of the same target. */
function fetchKey(collection: SyncCollection, key: string, bytesField: string): string {
  return `${collection}:${key}:${bytesField}`;
}

/** In-flight fetches, keyed by `fetchKey` — a second request reuses the first. */
const inflight = new Map<string, Promise<FetchOutcome>>();

/**
 * Run (or join) one fetch for a row's blob field. Deduped by `fetchKey`, so a
 * lazy re-mount or an eager+lazy overlap share a single download that always
 * completes onto the Dexie row (the detach-on-unmount guarantee, §6). The core
 * never throws: a failure resolves to a `placeholder`/`terminal` outcome.
 */
function runFetch(entry: EagerEntry): Promise<FetchOutcome> {
  const fk = fetchKey(entry.collection, entry.key, entry.bytesField);
  const existing = inflight.get(fk);
  if (existing) return existing;
  const p = doFetch(entry).finally(() => {
    inflight.delete(fk);
  });
  inflight.set(fk, p);
  return p;
}

async function doFetch(entry: EagerEntry): Promise<FetchOutcome> {
  const mk = deps.getMk();
  if (!mk) return { state: 'placeholder' }; // no key material yet — retriable

  let body: Uint8Array;
  try {
    body = await deps.getBlob(entry.ref);
  } catch (err) {
    return failureOutcome(entry, mk, classifyGetError(err));
  }

  let plain: Uint8Array;
  try {
    plain = await deps.openBlob(mk, entry.ref.blobId, body);
  } catch {
    // An open failure is a corrupt body (§7.2) — NEVER a partial write to the row.
    return failureOutcome(entry, mk, { kind: 'get-corrupt' });
  }

  const stored = await writeBytesOntoRow(entry, plain);
  if (!stored) return { state: 'placeholder' }; // row gone / ref moved — nothing hydrated
  deps.invalidate(invalidationKeysFor(entry, stored.row));
  return { state: 'ready', bytes: stored.blob };
}

/** Map a transport throw to the §7 failure descriptor the repair matrix consumes. */
function classifyGetError(err: unknown): BlobFailure {
  if (err instanceof BlobNotFoundError) return { kind: 'get-not-found' };
  if (err instanceof BlobsDisabledError) return { kind: 'get-disabled' };
  if (err instanceof BlobCorruptBodyError) return { kind: 'get-corrupt' };
  // A generic transport/network blip: retriable placeholder, no repair, no
  // tamper noise — modelled as a dangling ref so it draws the same GET budget.
  return { kind: 'get-not-found' };
}

/**
 * Route a fetch failure through the §7 repair matrix (this device holds no bytes
 * on the download path, so the matrix never PUTs — it only schedules the
 * placeholder/rest/suppress disposition and consumes the shared GET budget).
 */
async function failureOutcome(
  entry: EagerEntry,
  mk: MasterKey,
  failure: BlobFailure,
): Promise<FetchOutcome> {
  const spec = resolveBlobFieldByName(entry.collection, entry.bytesField);
  const ctx: BlobFailureContext = {
    collection: entry.collection,
    key: entry.key,
    blobId: entry.ref.blobId,
    refField: spec?.refField ?? '',
    oversizedField: spec?.oversizedField ?? '',
    // No local bytes on the download path — the matrix stays PUT-free.
    bytes: undefined,
    mk,
  };
  const disposition = await deps.resolveBlobFailure(failure, ctx, deps.repairDeps);
  if (disposition === 'terminal' || disposition === 'suppressed') return { state: 'terminal' };
  return { state: 'placeholder' };
}

/**
 * Write the opened plaintext onto the row's `Blob` field, but ONLY when the row
 * still carries the same ref (a newer local write may have moved it). Returns the
 * stored `Blob` + the row, or `undefined` when nothing was hydrated.
 */
async function writeBytesOntoRow(
  entry: EagerEntry,
  plain: Uint8Array,
): Promise<{ blob: Blob; row: Record<string, unknown> } | undefined> {
  const db = getClientDataDb();
  const table = db.table(entry.collection);
  const row = (await table.get(entry.key)) as Record<string, unknown> | undefined;
  if (!row) return undefined;

  const spec = resolveBlobFieldByName(entry.collection, entry.bytesField);
  const currentRef = spec ? row[spec.refField] : undefined;
  if (!isBlobRef(currentRef) || currentRef.blobId !== entry.ref.blobId) return undefined;

  const blob = new Blob([plain as BlobPart], { type: mimeForField(entry.bytesField, row) });
  const patch: Record<string, unknown> = { [entry.bytesField]: blob };
  // biome-ignore lint/suspicious/noExplicitAny: Dexie's per-table patch type is opaque here.
  await table.update(entry.key, patch as any);
  return { blob, row: { ...row, [entry.bytesField]: blob } };
}

/** The stored `Blob`'s MIME: thumbnails are the downscaled JPEG; else the row's. */
function mimeForField(bytesField: string, row: Record<string, unknown>): string {
  if (bytesField === 'thumbBlob') return 'image/jpeg';
  return typeof row.mime === 'string' ? row.mime : '';
}

/** The TanStack keys a hydrated row invalidates (§6 — the local store is the cache). */
function invalidationKeysFor(
  entry: EagerEntry,
  row: Record<string, unknown>,
): readonly (readonly unknown[])[] {
  switch (entry.collection) {
    case 'artefacts': {
      const keys: (readonly unknown[])[] = [QK.artefact(entry.key), QK.allArtefacts];
      if (typeof row.chatId === 'string') keys.push(QK.chatArtefacts(row.chatId));
      return keys;
    }
    case 'personaAvatars':
      return [QK.personaAvatar(entry.key)];
    case 'attachments': {
      const keys: (readonly unknown[])[] = [];
      if (typeof row.messageId === 'string') keys.push(QK.attachmentsForMessage(row.messageId));
      if (typeof row.chatId === 'string') keys.push(QK.attachmentsPending(row.chatId));
      return keys;
    }
    default:
      return [];
  }
}

function isBlobRef(value: unknown): value is BlobRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { blobId?: unknown }).blobId === 'string' &&
    typeof (value as { bytes?: unknown }).bytes === 'number'
  );
}

/**
 * Fetch one row's blob field, returning the resulting UI state (§6). The public
 * fetch primitive shared by the lazy hook and the eager queue: deduped by
 * `fetchKey` and always completing onto the Dexie row, so a detach-then-reopen
 * hydrates instantly. Never throws — a failure resolves to `placeholder`
 * (retriable) or `terminal` (suppressed forever).
 */
export async function fetchRowBlob(
  collection: SyncCollection,
  key: string,
  bytesField: string,
  ref: BlobRef,
): Promise<UseBlobBytesResult> {
  const outcome = await runFetch({ collection, key, bytesField, ref, boosted: false });
  if (outcome.state === 'ready') return { state: 'ready', bytes: outcome.bytes };
  if (outcome.state === 'terminal') return { state: 'terminal' };
  return { state: 'placeholder' };
}

// ===== The eager queue (concurrency 3, view-priority) =====

const queue: EagerEntry[] = [];
let eagerActive = 0;
/** Whether the current drain pass has already reset the per-cycle repair budget. */
let passStarted = false;

/**
 * Enqueue a row's eager blob ref (thumbnails, avatars — §6). FIFO except for the
 * view-priority boost. A no-op when the target is already queued or in flight, so
 * a re-apply of the same row never double-fetches.
 */
export function enqueueEager(
  collection: SyncCollection,
  key: string,
  bytesField: string,
  ref: BlobRef,
): void {
  const fk = fetchKey(collection, key, bytesField);
  if (inflight.has(fk)) return;
  if (queue.some((e) => fetchKey(e.collection, e.key, e.bytesField) === fk)) return;
  queue.push({ collection, key, bytesField, ref, boosted: false });
  notifyEager();
  pump();
}

/**
 * View-priority (Laura): move the currently-mounted surface's refs to the front
 * of the eager queue so the in-focus chat pictures itself first. Matches queued
 * (not-yet-started) entries by blobId; already-running fetches are unaffected.
 */
export function boostSurface(refs: readonly BlobRef[]): void {
  const ids = new Set(refs.map((r) => r.blobId));
  let changed = false;
  for (const entry of queue) {
    if (!entry.boosted && ids.has(entry.ref.blobId)) {
      entry.boosted = true;
      changed = true;
    }
  }
  if (changed) pump();
}

/** View-priority by owning record key (§6) — the surface boosts its rows' blobs. */
export function boostForKeys(keys: readonly string[]): void {
  const set = new Set(keys);
  let changed = false;
  for (const entry of queue) {
    if (!entry.boosted && set.has(entry.key)) {
      entry.boosted = true;
      changed = true;
    }
  }
  if (changed) pump();
}

/** Take the next entry: boosted (FIFO among boosted) first, else plain FIFO. */
function takeNext(): EagerEntry | undefined {
  const boostedIdx = queue.findIndex((e) => e.boosted);
  const idx = boostedIdx === -1 ? (queue.length > 0 ? 0 : -1) : boostedIdx;
  if (idx === -1) return undefined;
  return queue.splice(idx, 1)[0];
}

/** Drive the eager queue under the concurrency ceiling. */
function pump(): void {
  // Start-of-pass: reset the shared per-cycle GET/repair budget (§7.1) once when
  // an idle queue begins draining, so a fresh pass gets its full retry budget.
  if (eagerActive === 0 && queue.length > 0 && !passStarted) {
    passStarted = true;
    deps.resetBlobRepairCycle();
  }
  while (eagerActive < concurrency && queue.length > 0) {
    const entry = takeNext();
    if (!entry) break;
    eagerActive += 1;
    notifyEager();
    void runFetch(entry).finally(() => {
      eagerActive -= 1;
      if (eagerActive === 0 && queue.length === 0) passStarted = false;
      notifyEager();
      pump();
    });
  }
}

// ===== "Fetching images…" observable (Task 8 gates "Synced" on this, §6) =====

const eagerSubscribers = new Set<() => void>();

/** Whether the eager queue has work in flight or queued (§6 — gates "Synced"). */
export function isEagerQueueActive(): boolean {
  return queue.length > 0 || eagerActive > 0;
}

function notifyEager(): void {
  for (const cb of eagerSubscribers) cb();
}

/** Subscribe to eager-queue activity transitions (the store Task 8's line reads). */
export function subscribeEagerQueue(cb: () => void): () => void {
  eagerSubscribers.add(cb);
  return () => {
    eagerSubscribers.delete(cb);
  };
}

/** React binding: `true` while the eager queue drains (Task 8's status sub-state). */
export function useEagerQueueActive(): boolean {
  return useSyncExternalStore(subscribeEagerQueue, isEagerQueueActive, isEagerQueueActive);
}

// ===== The lazy resolver hook (§6 lazy-on-view) =====

/** What {@link useBlobBytes} exposes to a surface rendering a blob-bearing row. */
export interface UseBlobBytesResult {
  state: BlobBytesState;
  bytes?: Blob;
  /** Present only for a pending (retriable) failure — a quiet retry, never a nag. */
  retry?: () => void;
}

/**
 * Read a row's blob bytes for the given field, kicking a single lazy fetch the
 * first time a present-ref-but-absent-bytes row renders (§6). Detaches on
 * unmount — the component stops updating — but the underlying fetch COMPLETES
 * onto the Dexie row, so the next open hydrates instantly (§6). A terminal state
 * (oversize sentinel, §7.1 rest, cap exhaustion, disabled) yields
 * `state: 'terminal'` with no retry nag; a pending failure yields a quiet retry.
 */
export function useBlobBytes(
  collection: SyncCollection,
  key: string,
  field: string,
): UseBlobBytesResult {
  const [result, setResult] = useState<UseBlobBytesResult>({ state: 'placeholder' });
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const resolved = await resolveBlobBytes(collection, key, field);
    if (resolved.kind === 'ready') {
      if (mounted.current) setResult({ state: 'ready', bytes: resolved.bytes });
      return;
    }
    if (resolved.kind === 'terminal') {
      if (mounted.current) setResult({ state: 'terminal' });
      return;
    }
    // Missing: kick the fetch. Reflect `loading` while it runs; the fetch itself
    // always completes onto the Dexie row regardless of this component's life.
    if (mounted.current) setResult({ state: 'loading' });
    const outcome = await runFetch({
      collection,
      key,
      bytesField: field,
      ref: resolved.ref,
      boosted: false,
    });
    if (!mounted.current) return; // detached — the row was hydrated anyway
    if (outcome.state === 'ready') setResult({ state: 'ready', bytes: outcome.bytes });
    else if (outcome.state === 'terminal') setResult({ state: 'terminal' });
    else setResult({ state: 'placeholder', retry: () => void load() });
  }, [collection, key, field]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  return result;
}

/** The non-React core of {@link useBlobBytes}, so it is testable in the node env. */
type ResolveState =
  | { kind: 'ready'; bytes: Blob }
  | { kind: 'terminal' }
  | { kind: 'missing'; ref: BlobRef };

/**
 * Resolve the current state of a row's blob field WITHOUT starting a fetch:
 * `ready` when the bytes are present, `terminal` when the oversize sentinel is
 * set or the ref is absent/null, else `missing` with the ref that drives a fetch.
 */
export async function resolveBlobBytes(
  collection: SyncCollection,
  key: string,
  field: string,
): Promise<ResolveState> {
  const db = getClientDataDb();
  const row = (await db.table(collection).get(key)) as Record<string, unknown> | undefined;
  const spec = resolveBlobFieldByName(collection, field);
  if (!row || !spec) return { kind: 'terminal' };

  const bytes = row[spec.bytesField];
  if (bytes instanceof Blob && bytes.size > 0) return { kind: 'ready', bytes };

  if (row[spec.oversizedField] === true) return { kind: 'terminal' }; // §7.3 oversize sentinel

  const ref = row[spec.refField];
  if (!isBlobRef(ref)) return { kind: 'terminal' }; // no ref (null / absent) — nothing to fetch
  return { kind: 'missing', ref };
}
