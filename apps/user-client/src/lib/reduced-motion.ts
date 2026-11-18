// SPDX-License-Identifier: AGPL-3.0-only
import { useSyncExternalStore } from 'react';

/*
 * One signal for reduced motion. The system's `prefers-reduced-motion` and the
 * in-app "Reduce animations" switch both end up asking the same question; the
 * switch answers it by marking the root element `data-motion="reduced"`, which
 * the CSS mirror (build/reduced-motion-mirror.ts) and these helpers read.
 */

const SYSTEM_QUERY = '(prefers-reduced-motion: reduce)';
/** Per-device mirror of the switch, read before Dexie loads. Holds only '1'. */
export const MOTION_STORAGE_KEY = 'chatsundere.reduceMotion';

function systemQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(SYSTEM_QUERY);
}

function rootMarkedReduced(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced';
}

/** True when the operating system asks for reduced motion. */
export function prefersSystemReducedMotion(): boolean {
  return systemQuery()?.matches ?? false;
}

/** True when either the system or the in-app switch asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  return rootMarkedReduced() || prefersSystemReducedMotion();
}

/**
 * Marks or unmarks the root element for reduced motion and mirrors the flag to
 * `localStorage`, so the next cold start can apply it before first paint.
 */
export function applyMotionAttribute(reduced: boolean): void {
  const root = document.documentElement;
  if (reduced) root.dataset.motion = 'reduced';
  else delete root.dataset.motion;
  try {
    if (reduced) localStorage.setItem(MOTION_STORAGE_KEY, '1');
    else localStorage.removeItem(MOTION_STORAGE_KEY);
  } catch {
    // Storage can be blocked (private mode, quota); the settings row stays the
    // source of truth, only the first paint of the next start may move.
  }
}

/** Applies the mirrored flag at start-up, before the settings row is readable. */
export function applyStoredMotionAttribute(): void {
  try {
    if (localStorage.getItem(MOTION_STORAGE_KEY) === '1') {
      document.documentElement.dataset.motion = 'reduced';
    }
  } catch {
    // Unreadable storage: start with motion; the settings effect corrects it.
  }
}

function subscribeSystem(onChange: () => void): () => void {
  const mq = systemQuery();
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
}

function subscribeAll(onChange: () => void): () => void {
  const unsubscribeSystem = subscribeSystem(onChange);
  // A MutationObserver rather than a module store, so any writer of the
  // attribute (the settings effect, the first-paint mirror, a test) is seen.
  const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(onChange);
  observer?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-motion'],
  });
  return () => {
    unsubscribeSystem();
    observer?.disconnect();
  };
}

/** Live reduced-motion state from the system or the switch; re-renders on change. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeAll, prefersReducedMotion, () => true);
}

/** Live system-only reduced-motion state; re-renders when the system setting changes. */
export function useSystemReducedMotion(): boolean {
  return useSyncExternalStore(subscribeSystem, prefersSystemReducedMotion, () => false);
}
