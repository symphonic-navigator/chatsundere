// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Screen wake lock, held while any voice reason is active.
 *
 * Reasons rather than a boolean: live voice hands over to read-aloud on the
 * persona's floor, and a single flag would drop the lock in between. The
 * platform releases the lock whenever the page is hidden, so it is taken
 * back on the return to visible while a reason is still held. Every API use
 * is feature-detected and wrapped: a missing or refused wake lock must never
 * disturb voice itself.
 */

/** Why the screen is being kept awake. */
export type WakeReason = 'live-voice' | 'read-aloud' | 'monologue';

const reasons = new Set<WakeReason>();
let sentinel: WakeLockSentinel | null = null;
let pending = false;
let listening = false;
// Bumped by the test reset so a request still in flight from an earlier test
// cannot adopt itself into the fresh state.
let generation = 0;

function wakeLockApi(): WakeLock | null {
  try {
    if (typeof navigator === 'undefined') return null;
    const api = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
    return api && typeof api.request === 'function' ? api : null;
  } catch {
    return null;
  }
}

function isVisible(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'visible';
}

function releaseSentinel(s: WakeLockSentinel): void {
  try {
    void s.release().catch((err: unknown) => console.debug('wake lock release failed', err));
  } catch (err) {
    console.debug('wake lock release failed', err);
  }
}

function acquire(): void {
  if (pending || (sentinel && !sentinel.released)) return;
  if (reasons.size === 0 || !isVisible()) return;
  const api = wakeLockApi();
  if (!api) return;
  pending = true;
  const gen = generation;
  let request: Promise<WakeLockSentinel>;
  try {
    request = api.request('screen');
  } catch (err) {
    pending = false;
    console.debug('wake lock request failed', err);
    return;
  }
  request.then(
    (s) => {
      if (gen !== generation) {
        releaseSentinel(s);
        return;
      }
      pending = false;
      // Every reason went while the request was in flight, or the page was
      // hidden meanwhile (the platform would release it anyway).
      if (reasons.size === 0 || !isVisible()) {
        releaseSentinel(s);
        return;
      }
      sentinel = s;
      try {
        s.addEventListener('release', () => {
          if (sentinel === s) sentinel = null;
        });
      } catch {
        // A sentinel without events still releases; `released` covers it.
      }
    },
    (err: unknown) => {
      if (gen === generation) pending = false;
      console.debug('wake lock request failed', err);
    },
  );
}

function onVisibilityChange(): void {
  if (isVisible()) acquire();
}

function ensureListener(): void {
  if (listening || typeof document === 'undefined') return;
  try {
    document.addEventListener('visibilitychange', onVisibilityChange);
    listening = true;
  } catch {
    // No visibility events: the lock is simply not re-taken after hiding.
  }
}

/** Keeps the screen awake for `reason` until {@link letScreen} is called with it. */
export function holdScreen(reason: WakeReason): void {
  reasons.add(reason);
  ensureListener();
  acquire();
}

/** Lets `reason` go; the lock is released once no reason is held. */
export function letScreen(reason: WakeReason): void {
  if (!reasons.delete(reason) || reasons.size > 0) return;
  const s = sentinel;
  sentinel = null;
  if (s) releaseSentinel(s);
}

/** Test-only: forgets every reason, the sentinel, and the visibility listener. */
export function resetScreenWakeLockForTests(): void {
  reasons.clear();
  sentinel = null;
  pending = false;
  generation += 1;
  if (listening && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  listening = false;
}
