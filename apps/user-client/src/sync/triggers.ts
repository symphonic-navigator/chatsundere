// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore, useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
import { setImmediateDrain } from './enqueue.js';
import { drainOutbox, runSyncCycle } from './worker.js';

/**
 * Sync triggers (spec §6 triggers). Every trigger ultimately calls
 * `runSyncCycle()`; the worker's single-flight lock makes overlapping triggers
 * safe. The engine is an accelerant of convergence, not a dependency — each of
 * these is redundant with the coarse timer, so a missed event never wedges sync.
 *
 * The triggers, all guarded on linked + unlocked + not-offline:
 *  - boot after unlock (the reconcile drain) — fires now if already unlocked,
 *    and on the session's lock→unlock transition;
 *  - connectivity regain — the tail of WS-0's `maybeProbeLinkedServer` chain: a
 *    successful probe sets connectivity `linked_online`, and we fire on that
 *    transition (the point at which a cycle can actually reach the server);
 *  - `visibilitychange` → foreground;
 *  - a coarse 10-minute timer (the correctness backstop);
 *  - a 3-second debounced Class-1 kick (`scheduleClass1Sync`) the enqueue sites
 *    and the doorbell poke handler share — many rapid appends collapse to one
 *    cycle.
 */

/** The debounced Class-1 kick window (spec §6). */
const CLASS1_DEBOUNCE_MS = 3_000;
/** The coarse correctness-backstop timer (spec §6). */
const COARSE_TIMER_MS = 10 * 60 * 1_000;

// ===== Injectable cycle (production default; tests override) =====

let cycle: () => Promise<void> = runSyncCycle;

/** Test seam: swap the cycle the triggers invoke (defaults to `runSyncCycle`). */
export function _setTriggerCycle(fn: (() => Promise<void>) | null): void {
  cycle = fn ?? runSyncCycle;
}

// ===== Trigger guard (spec §6 preconditions, coarsened) =====

/**
 * Whether a trigger should fire a cycle at all: linked, unlocked, and not
 * offline. `runSyncCycle` re-checks the full preconditions (incl. `syncUrl` and
 * the `sync` feature), so this is a cheap early-out that also keeps the injected
 * test cycle from firing when the account is local-only or the session locked.
 */
function canTrigger(): boolean {
  if (useAccountLinkStore.getState().linkStatus !== 'linked') return false;
  if (useSessionStore.getState().mk === null) return false;
  if (useConnectivityStore.getState().state.kind === 'local_offline') return false;
  return true;
}

/**
 * Fire a cycle iff the guard passes. The swallow is DELIBERATE and no longer
 * silent (pre-test analysis #8): the worker counts every whole-cycle failure
 * and raises the `transport_failing` attention after N consecutive ones, so a
 * persistently failing sync-service surfaces on the status surfaces instead of
 * dying here as an unhandled rejection.
 */
function fireCycle(): void {
  if (!canTrigger()) return;
  cycle().catch(() => undefined);
}

// ===== The debounced Class-1 kick =====

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule a debounced sync cycle (spec §6). Class-1 enqueue sites (Task 11) and
 * the doorbell poke handler both call this: a burst of appends collapses into a
 * single cycle 3 s after the last one. The guard is re-evaluated when the timer
 * fires, so a burst that ends after going offline never runs a doomed cycle.
 */
export function scheduleClass1Sync(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    fireCycle();
  }, CLASS1_DEBOUNCE_MS);
}

// ===== Boot wiring =====

let coarseTimer: ReturnType<typeof setInterval> | null = null;
let unsubConnectivity: (() => void) | null = null;
let unsubSession: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;
let installed = false;

/**
 * Wire the triggers into boot (called from `server-foundation.ts`, AFTER the
 * WS-0 init). Registers the worker's immediate-drain for `mutateSynced`, runs a
 * boot cycle if the session is already unlocked, and attaches the unlock /
 * regain / foreground / timer triggers. Idempotent.
 */
export function initSyncTriggers(): void {
  if (installed) return;
  installed = true;

  // The worker's whole-outbox drain is the immediate-drain target for the
  // Class-2 write-through (§5). The target key is ignored — draining the whole
  // outbox subsumes the one key, and a rejection propagates to the caller.
  setImmediateDrain(async () => {
    await drainOutbox();
  });

  // Boot cycle after unlock (§6): now if already unlocked, and on every
  // lock→unlock transition.
  if (useSessionStore.getState().mk !== null) fireCycle();
  unsubSession = useSessionStore.subscribe((state, prev) => {
    if (prev.mk === null && state.mk !== null) fireCycle();
  });

  // Connectivity regain (§6): fire when the probe chain establishes reachability.
  unsubConnectivity = useConnectivityStore.subscribe((state, prev) => {
    if (prev.state.kind !== 'linked_online' && state.state.kind === 'linked_online') fireCycle();
  });

  // Foreground (§6): a tab returning to the front re-checks for changes.
  if (typeof document !== 'undefined') {
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') fireCycle();
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }

  // Coarse correctness backstop (§6): the doorbell is an accelerant, this is the
  // floor that guarantees convergence even with the socket permanently dead.
  coarseTimer = setInterval(fireCycle, COARSE_TIMER_MS);
}

/** Remove every listener, subscription, and timer (tests, and a clean re-init). */
export function teardownSyncTriggers(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (coarseTimer !== null) {
    clearInterval(coarseTimer);
    coarseTimer = null;
  }
  unsubConnectivity?.();
  unsubConnectivity = null;
  unsubSession?.();
  unsubSession = null;
  if (visibilityHandler !== null && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityHandler);
  }
  visibilityHandler = null;
  installed = false;
}

/** Test seam: restore the injected cycle and tear down all wiring. */
export function _resetTriggersForTests(): void {
  teardownSyncTriggers();
  cycle = runSyncCycle;
}
