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
    backfillPending: false,
    backfillTotal: null,
    backfillDone: null,
    suppressedRevs: {},
    linkGeneration: 0,
  };
}

/**
 * The per-link engine generation (audit #8): bumped by every engine reset so an
 * in-flight drain/pull that started before the reset can be recognised and its
 * write-backs discarded (they belong to the previous account).
 */
export async function getLinkGeneration(): Promise<number> {
  return (await getSyncState()).linkGeneration ?? 0;
}

/** Record a suppressed pulled rev so a fast Undo can rewind below it (audit #5). */
export async function recordSuppressedRev(
  collection: string,
  key: string,
  rev: number,
): Promise<void> {
  const db = getClientDataDb();
  await db.transaction('rw', db.syncState, async () => {
    const state = await getSyncState();
    const map = { ...(state.suppressedRevs ?? {}) };
    const id = `${collection}:${key}`;
    map[id] = Math.max(map[id] ?? 0, rev);
    await db.syncState.update(STATE_ID, { suppressedRevs: map });
  });
}

/**
 * Consume (read + delete) the suppressed revs for the given pairs; returns the
 * minimum, or null when none were recorded.
 */
export async function takeSuppressedRevs(
  pairs: Array<{ collection: string; key: string }>,
): Promise<number | null> {
  const db = getClientDataDb();
  let min: number | null = null;
  await db.transaction('rw', db.syncState, async () => {
    const state = await getSyncState();
    const map = { ...(state.suppressedRevs ?? {}) };
    for (const p of pairs) {
      const id = `${p.collection}:${p.key}`;
      const rev = map[id];
      if (rev !== undefined) {
        min = min === null ? rev : Math.min(min, rev);
        delete map[id];
      }
    }
    await db.syncState.update(STATE_ID, { suppressedRevs: map });
  });
  return min;
}

/**
 * Read the sync-state singleton, lazily creating it with defaults on first
 * access so callers never have to special-case its absence.
 */
export async function getSyncState(): Promise<SyncStateRow> {
  const db = getClientDataDb();
  const existing = await db.syncState.get(STATE_ID);
  if (existing) {
    // Heal a legacy row predating a field (e.g. the backfill trio): merge in
    // defaults for whatever is missing and persist once, so callers never see
    // `undefined` where a default should apply.
    const defaults = defaultState();
    const patch: Partial<SyncStateRow> = {};
    for (const key of Object.keys(defaults) as (keyof SyncStateRow)[]) {
      if (existing[key] === undefined) (patch as Record<string, unknown>)[key] = defaults[key];
    }
    if (Object.keys(patch).length > 0) {
      await db.syncState.update(STATE_ID, patch);
      return { ...existing, ...patch };
    }
    return existing;
  }
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

/**
 * DELIBERATE monotonicity exception (audit #5; the recovery `watermarkRev: 0`
 * reset is the other one): rewind the watermark so a suppressed-then-undone
 * foreign edit is re-delivered. Only ever called with `suppressedRev - 1`,
 * i.e. a rev the server actually served — never attacker-controllable input.
 * Rewinding lower than necessary is safe (re-deliveries are idempotent echoes);
 * rewinding is never allowed to move FORWARD (min clamp).
 */
export async function rewindWatermark(rev: number): Promise<void> {
  const db = getClientDataDb();
  await db.transaction('rw', db.syncState, async () => {
    const state = await getSyncState();
    const next = Math.min(state.watermarkRev, Math.max(0, rev));
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

/**
 * §11.3 — kinds that GENUINELY re-detect their condition on every drain attempt,
 * so a completed cycle that does not re-raise them means the condition has
 * cleared. Only `delete_rate_limited` qualifies: it is a per-delete-attempt
 * server response that resets on its own, so an empty/clean cycle proves the
 * rate-limited deletes have drained. `quota_exceeded` is DELIBERATELY excluded
 * (Larissa round 2): it is an account-global fact persisted across reload, only
 * surfaced when a quota-charged op is actually pushed — absence of a re-raise
 * (e.g. an empty-outbox boot cycle while still over quota) does NOT prove it
 * cleared, so it retires only on the POSITIVE signal in `clearQuotaOnAcceptedWrite`.
 * Every other kind is sticky by design (`tamper`, `auth_degraded`,
 * `recovery_paused`) or clears on its own resolution
 * (`tombstone_threshold` via the pulled-tombstone tally, `record_too_large` via
 * the terminal-sentinel sweep in `applyOk`).
 */
const CYCLE_CLEARABLE: ReadonlySet<SyncAttention['kind']> = new Set(['delete_rate_limited']);

/**
 * Attention kinds raised since the last `beginAttentionCycle`. In-memory and
 * cycle-scoped — the sync cycle is single-flight (Web Lock / `cycleMutex`), so
 * this never races. Lets the settle/clear helpers tell "still failing this cycle"
 * from "stale banner from a past cycle" without a per-kind DB flag.
 */
let raisedThisCycle = new Set<SyncAttention['kind']>();

/** Begin a fresh cycle's attention-raise tracking (the sync cycle calls this before its drain). */
export function beginAttentionCycle(): void {
  raisedThisCycle = new Set();
}

/** Set (or clear) the attention (error) state the status line renders. */
export async function setAttention(a: SyncAttention | null): Promise<void> {
  await getSyncState();
  if (a) raisedThisCycle.add(a.kind);
  await getClientDataDb().syncState.update(STATE_ID, { attention: a });
}

/**
 * §11.3 — retire a stale `delete_rate_limited` banner at the END of a cycle that
 * completed without re-raising it. A one-off mass-delete rate-limit latched the
 * banner; without this it stuck forever, exactly as the tombstone notice did.
 * While deletes are still bouncing the next drain re-raises the kind (recorded in
 * `raisedThisCycle`), so the banner stays; only once a cycle stays clean does it
 * retire. A coexisting sticky or positively-cleared kind is never touched.
 */
export async function settleTransientAttention(): Promise<void> {
  const { attention } = await getSyncState();
  if (attention && CYCLE_CLEARABLE.has(attention.kind) && !raisedThisCycle.has(attention.kind)) {
    await setAttention(null);
  }
}

/**
 * §11.3 — a server-ACCEPTED, quota-charged write (a push `ok` or a stored blob)
 * proves the account is back under quota: retire a `quota_exceeded` banner on
 * that POSITIVE signal. Gated on "no quota rejection raised this same cycle" so a
 * mixed drain — one write accepted, another still bounced for quota — keeps the
 * banner up. Unlike `delete_rate_limited`, quota must NEVER clear on mere absence
 * of a re-raise (Larissa round 2): it is persisted across reload precisely to
 * survive an empty-outbox boot cycle while the account is still full.
 */
export async function clearQuotaOnAcceptedWrite(): Promise<void> {
  if (raisedThisCycle.has('quota_exceeded')) return;
  const { attention } = await getSyncState();
  if (attention?.kind === 'quota_exceeded') await setAttention(null);
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
