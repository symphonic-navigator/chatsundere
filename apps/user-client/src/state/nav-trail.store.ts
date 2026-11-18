// SPDX-License-Identifier: AGPL-3.0-only
import type { NavigationType } from 'react-router-dom';
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
    const prev = current ? (trails.get(current.key)?.trail ?? []) : [];
    const trail =
      type === 'POP' || !current
        ? nextTrail({ type: 'POP', stamp: state?.csTrail, idx })
        : nextTrail({ type, prevTrail: prev, prevPathname: current.pathname, idx });
    trails.set(location.key, { trail, idx });
  }
  current = { key: location.key, pathname: location.pathname };
}

/** The trail of the entry `key`, empty when unknown. */
export function trailOf(key: string): Trail {
  return trails.get(key)?.trail ?? [];
}

/** React Router's index of the entry `key` in this document, when known. */
export function idxOf(key: string): number | null {
  return trails.get(key)?.idx ?? null;
}

/** Forget everything (tests only: a reload in the app does this by itself). */
export function resetNavTrailForTests(): void {
  trails.clear();
  current = null;
}
