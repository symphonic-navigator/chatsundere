// SPDX-License-Identifier: AGPL-3.0-only
import { useSyncExternalStore } from 'react';
import { useCurrentChatStore } from './current-chat.store.js';

/** The Tailwind `lg` breakpoint — the project's single breakpoint (CLAUDE.md §3.4). */
export const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

/** True at and above the `lg` breakpoint (1024 px); reactive to window resizes. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export interface EffectiveChatMode {
  isInteractionMode: boolean;
  isPinned: boolean;
}

/**
 * The chat's effective mode flags. Desktop has a single chat mode — always
 * interaction, always pinned semantics (spec 2026-07-18 §5) — derived at read
 * time so the store stays the mobile source of truth and a resize across the
 * breakpoint needs no state migration.
 */
export function useEffectiveChatMode(): EffectiveChatMode {
  const isDesktop = useIsDesktop();
  const isInteractionMode = useCurrentChatStore((s) => s.isInteractionMode);
  const isPinned = useCurrentChatStore((s) => s.isPinned);
  return {
    isInteractionMode: isDesktop || isInteractionMode,
    isPinned: isDesktop || isPinned,
  };
}
