// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  claimTraversal,
  currentKey,
  idxOf,
  releaseTraversal,
  trailOf,
  useNavResetStore,
} from '../state/nav-trail.store.js';
import { useNavTransitionStore } from '../state/nav-transition.store.js';
import { type Trail, findReturnDepth, pathnameOf } from './nav-trail.js';

/** How long `resetTo` waits for its unwind to land before replacing where it is. */
export const RESET_TIMEOUT_MS = 400;

/** The Hall is the root: a Home that misses it clears the way back. */
const HALL = '/app';

let resetTimer: ReturnType<typeof setTimeout> | null = null;

// After a reset gave up waiting, its unwind may still arrive; for a short while a
// landing on the first entry is still replaced with the target.
const LATE_RESET_WINDOW_MS = 2000;
let lateReset: { target: string; until: number } | null = null;

/** Called by the tracker on every POP: put a late reset's target in place. */
export function finishLateReset(
  idx: number | null,
  navigate: (to: string, opts: { replace: true }) => void,
): void {
  if (!lateReset || idx !== 0) return;
  const { target, until } = lateReset;
  lateReset = null;
  if (Date.now() <= until) navigate(target, { replace: true });
}

/** Called by the tracker when a traversal lands while a reset runs, and by the bound. */
export function finishReset(
  navigate: (to: string, opts: { replace: true }) => void,
  timedOut = false,
): void {
  const { resetting, target, end } = useNavResetStore.getState();
  if (!resetting || target === null) return;
  if (resetTimer !== null) clearTimeout(resetTimer);
  resetTimer = null;
  lateReset = timedOut ? { target, until: Date.now() + LATE_RESET_WINDOW_MS } : null;
  end();
  navigate(target, { replace: true });
}

/** The app's ways of going back (spec "Back means one thing", "Three moves"). */
export interface AppNav {
  /** One step back when an in-app entry is behind; else replace with `fallback`. */
  back: (fallback: string) => void;
  /** Unwind to the nearest entry behind with `to`'s pathname; else replace with `to`. */
  returnTo: (to: string) => void;
  /** Clear the whole way back: unwind to the first entry and replace it with `to`.
   *  False when a move from this page is already under way. */
  resetTo: (to: string) => boolean;
  /** The pathnames behind the current entry, oldest first. */
  trail: () => Trail;
}

/** `‹`, crumbs, save-then-leave and returns all go through here, so they agree. */
export function useAppNav(): AppNav {
  const navigate = useNavigate();
  const { key } = useLocation();
  return useMemo(() => {
    const resetTo = (to: string): boolean => {
      // By React Router's idx, exact within this document and blind to stamps, so
      // entries from an older build are cleared too; the trail only where idx is
      // unknown (a memory router).
      const steps = idxOf(key) ?? trailOf(key).length;
      if (!claimTraversal(key)) return false;
      if (steps <= 0) {
        navigate(to, { replace: true });
        return true;
      }
      useNavResetStore.getState().begin(to);
      // No zoom-out on the way: the exit layer would repaint the page being cleared.
      useNavTransitionStore.getState().clearLast();
      useNavTransitionStore.getState().consume();
      if (resetTimer !== null) clearTimeout(resetTimer);
      // A traversal can fail to arrive (an installed iOS app, a bfcache restore):
      // then replace where we are and lift the curtain. What stays behind re-checks
      // the session and the adult mode on arrival.
      resetTimer = setTimeout(() => finishReset(navigate, true), RESET_TIMEOUT_MS);
      navigate(-steps);
      return true;
    };
    // A step back is bounded like a reset: if no new page shows in time (a lost
    // traversal, or iOS reopening a URL with its state but not its history), go to
    // `fallback` instead, so ‹ is never dead.
    const stepBack = (steps: number, fallback: string): void => {
      if (!claimTraversal(key)) return;
      setTimeout(() => {
        if (currentKey() !== key) return;
        releaseTraversal(key);
        navigate(fallback, { replace: true });
      }, RESET_TIMEOUT_MS);
      navigate(-steps);
    };
    return {
      back(fallback) {
        if (trailOf(key).length === 0) navigate(fallback, { replace: true });
        else stepBack(1, fallback);
      },
      returnTo(to) {
        const depth = findReturnDepth(trailOf(key), to);
        if (depth !== null) stepBack(depth, to);
        else if (pathnameOf(to) === HALL) resetTo(to);
        else navigate(to, { replace: true });
      },
      resetTo,
      trail: () => trailOf(key),
    };
  }, [navigate, key]);
}
