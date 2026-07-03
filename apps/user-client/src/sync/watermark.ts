// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncAttention, SyncStateRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';

/**
 * The singleton sync-state row and the in-memory recovery flag (spec §4, §6,
 * §8, §11.1). Owns watermark monotonicity (M-7), epoch first-sync/mismatch
 * detection (§8), and the pull-progress / attention state the status line reads.
 */

const STATE_ID = 'state' as const;

/** The lazily-created default singleton (spec §4). */
function defaultState(): SyncStateRow {
  return {
    id: STATE_ID,
    epoch: null,
    watermarkRev: 0,
    lastSyncAt: null,
    pulling: null,
    attention: null,
  };
}

/**
 * Read the sync-state singleton, lazily creating it with defaults on first
 * access so callers never have to special-case its absence.
 */
export async function getSyncState(): Promise<SyncStateRow> {
  const db = getClientDataDb();
  const existing = await db.syncState.get(STATE_ID);
  if (existing) return existing;
  const seed = defaultState();
  // putIfAbsent semantics: a concurrent cycle may have seeded it first.
  await db.syncState.add(seed).catch(() => undefined);
  return (await db.syncState.get(STATE_ID)) ?? seed;
}

/**
 * Advance the pull watermark to `max(current, rev)`. MONOTONE (Larissa M-7):
 * a maliciously ordered or replayed lower rev can never regress it.
 */
export async function advanceWatermark(rev: number): Promise<void> {
  const db = getClientDataDb();
  await db.transaction('rw', db.syncState, async () => {
    const state = await getSyncState();
    const next = Math.max(state.watermarkRev, rev);
    if (next !== state.watermarkRev) {
      await db.syncState.update(STATE_ID, { watermarkRev: next });
    }
  });
}

/** Set (or clear) the multi-page pull-progress state the status line renders. */
export async function setPulling(p: { pages: number; startedAt: number } | null): Promise<void> {
  await getSyncState();
  await getClientDataDb().syncState.update(STATE_ID, { pulling: p });
}

/** Set (or clear) the attention (error) state the status line renders. */
export async function setAttention(a: SyncAttention | null): Promise<void> {
  await getSyncState();
  await getClientDataDb().syncState.update(STATE_ID, { attention: a });
}

// ===== In-memory recovery flag (§8) =====

let recovering = false;
const recoveryListeners = new Set<(recovering: boolean) => void>();

/** Whether an epoch-recovery cycle is in progress (gates Class-2 writes, §5). */
export function isRecovering(): boolean {
  return recovering;
}

/** Toggle the recovery flag and notify subscribers. */
export function setRecovering(value: boolean): void {
  if (recovering === value) return;
  recovering = value;
  for (const listener of recoveryListeners) listener(value);
}

/** Subscribe to recovery-flag changes; returns an unsubscribe function. */
export function subscribeRecovering(listener: (recovering: boolean) => void): () => void {
  recoveryListeners.add(listener);
  return () => recoveryListeners.delete(listener);
}

/**
 * Compare the server-reported epoch against the persisted one (spec §8):
 *  - `'first'`   — no epoch persisted yet; this call persists it.
 *  - `'ok'`      — matches the persisted epoch.
 *  - `'mismatch'` — differs; the caller runs recovery.
 */
export async function checkEpoch(epoch: string): Promise<'ok' | 'first' | 'mismatch'> {
  const state = await getSyncState();
  if (state.epoch === null) {
    await getClientDataDb().syncState.update(STATE_ID, { epoch });
    return 'first';
  }
  return state.epoch === epoch ? 'ok' : 'mismatch';
}
