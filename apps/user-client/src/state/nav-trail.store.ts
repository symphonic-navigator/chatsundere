// SPDX-License-Identifier: AGPL-3.0-only
import type { NavigationType } from 'react-router-dom';
import { create } from 'zustand';
import { type Trail, nextTrail } from '../lib/nav-trail.js';

/**
 * In-memory record of each history entry's trail, keyed by React Router's
 * `location.key`, plus the entry currently shown. The durable copy lives in the
 * entry's `history.state.csTrail` (written by `NavTrailTracker`), so a reload can
 * rebuild it; this map only spares re-reading it.
 */
const trails = new Map<string, { trail: string[]; idx: number | null }>();
let current: { key: string; pathname: string } | null = null;

interface HistoryStateShape {
  key?: unknown;
  idx?: unknown;
  csTrail?: unknown;
}

/** `window.history.state` when it belongs to the entry `key` (BrowserRouter), else null. */
export function historyStateFor(key: string): HistoryStateShape | null {
  try {
    const s = window.history.state as HistoryStateShape | null;
    if (!s || typeof s !== 'object') return null;
    // React Router leaves the first entry of a document without a key ("default").
    const stateKey = typeof s.key === 'string' ? s.key : 'default';
    return stateKey === key ? s : null;
  } catch {
    return null;
  }
}

/**
 * Record the location now shown. Idempotent per `location.key`, so it may run
 * during render (and twice under StrictMode).
 */
export function recordLocation(
  location: { key: string; pathname: string },
  type: NavigationType,
): void {
  if (current?.key === location.key) return;
  const known = trails.get(location.key);
  if (!known) {
    const state = historyStateFor(location.key);
    const idx = typeof state?.idx === 'number' ? state.idx : null;
    const prevEntry = current ? trails.get(current.key) : undefined;
    const prev = prevEntry?.trail ?? [];
    // Two navigations in one batch skip rendering the entry between them; then the
    // trail would miss it and a later `go(-k)` would land one page off. Where the
    // router's idx shows that, the trail is dropped (empty only ever means "go up").
    const prevIdx = prevEntry?.idx ?? null;
    const skipped =
      idx !== null &&
      prevIdx !== null &&
      ((type === 'PUSH' && idx !== prevIdx + 1) || (type === 'REPLACE' && idx !== prevIdx));
    const trail =
      type === 'POP' || !current
        ? nextTrail({ type: 'POP', stamp: state?.csTrail, idx })
        : skipped
          ? []
          : nextTrail({ type, prevTrail: prev, prevPathname: current.pathname, idx });
    trails.set(location.key, { trail, idx });
  }
  current = { key: location.key, pathname: location.pathname };
  movingFrom = null;
}

// The entry a move last left from, and when: a second move from the same entry
// soon after (a double tap, an effect run twice under StrictMode) is ignored, so
// one tap never skips a page. Cleared when the next entry is shown, and expiring
// on its own so it can never block a later, deliberate move.
let movingFrom: { key: string; at: number } | null = null;
const DUPLICATE_WINDOW_MS = 1000;

/** Claim a move from the entry `key`; false when one just left from it. */
export function claimTraversal(key: string): boolean {
  const now = Date.now();
  if (movingFrom?.key === key && now - movingFrom.at < DUPLICATE_WINDOW_MS) return false;
  movingFrom = { key, at: now };
  return true;
}

/** Give up a claim whose move never arrived, so the next tap can act. */
export function releaseTraversal(key: string): void {
  if (movingFrom?.key === key) movingFrom = null;
}

/** The key of the entry shown now, when one has been recorded. */
export function currentKey(): string | null {
  return current?.key ?? null;
}

/** The trail of the entry `key`, empty when unknown. */
export function trailOf(key: string): Trail {
  return trails.get(key)?.trail ?? [];
}

/** React Router's index of the entry `key` in this document, when known. */
export function idxOf(key: string): number | null {
  return trails.get(key)?.idx ?? null;
}

interface NavResetState {
  /** True while `resetTo` unwinds: the route outlet shows nothing (the curtain). */
  resetting: boolean;
  /** Where the running reset lands. */
  target: string | null;
  begin: (target: string) => void;
  end: () => void;
}

/** The running `resetTo`, if any (spec "Three moves", the curtain and its bound). */
export const useNavResetStore = create<NavResetState>((set) => ({
  resetting: false,
  target: null,
  begin: (target) => set({ resetting: true, target }),
  end: () => set({ resetting: false, target: null }),
}));

/** Forget everything (tests only: a reload in the app does this by itself). */
export function resetNavTrailForTests(): void {
  trails.clear();
  current = null;
  movingFrom = null;
  useNavResetStore.getState().end();
}
