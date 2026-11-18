// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import type { MessageHit, ScanChat, ScanProgress } from './search/scan-messages.js';

/**
 * What My History keeps in its entry's `location.state` (spec §10). `gen`
 * ties it to the current generation; a state from an older one is discarded.
 */
export type HistoryNavState = { q?: string; scrollY?: number; gen: string };

/** A History location as remembered for the way back from a chat. */
export interface HistoryReturnLocation {
  pathname: string;
  search: string;
  state: HistoryNavState;
}

/** One message search held for the return to History, partial results included. */
export interface SearchCacheEntry {
  key: string;
  hits: MessageHit[];
  progress: ScanProgress;
  /** The scan's work list; `progress.nextIndex` points into it. */
  chats: ScanChat[];
}

// The only thing History writes to sessionStorage: an opaque token, no content.
const GEN_KEY = 'cs-history-gen';

let memoryGen: string | null = null;
let returnTarget: (HistoryReturnLocation & { chatId: string }) | null = null;
let searchCache: SearchCacheEntry | null = null;

function newToken(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function readStoredGen(): string | null {
  try {
    return sessionStorage.getItem(GEN_KEY);
  } catch {
    return null;
  }
}

function writeStoredGen(gen: string): void {
  try {
    sessionStorage.setItem(GEN_KEY, gen);
  } catch {
    // Storage unavailable: the in-memory token carries on alone.
  }
}

/**
 * The current History generation token, created on first use. Survives a
 * reload through sessionStorage, else lives in memory.
 */
export function currentHistoryGen(): string {
  const stored = readStoredGen();
  if (stored) {
    memoryGen = stored;
    return stored;
  }
  if (memoryGen === null) memoryGen = newToken();
  writeStoredGen(memoryGen);
  return memoryGen;
}

/**
 * Start a new generation — on sign-out, wipe, decouple and an adult-mode flip.
 * Every History state of an older generation is discarded on arrival, and the
 * return cache and return target are dropped.
 */
export function rotateHistoryGen(): void {
  memoryGen = newToken();
  writeStoredGen(memoryGen);
  returnTarget = null;
  searchCache = null;
}

/** Drops a stray `q` so a remembered address can never carry the query. */
function withoutQuery(search: string): string {
  const params = new URLSearchParams(search);
  if (!params.has('q')) return search;
  params.delete('q');
  const s = params.toString();
  return s === '' ? '' : `?${s}`;
}

/** Remember the History location a chat was opened from by a hit or a bookmark. */
export function rememberHistoryReturn(loc: HistoryReturnLocation, chatId: string): void {
  returnTarget = {
    chatId,
    pathname: loc.pathname,
    search: withoutQuery(loc.search),
    state: { ...loc.state, gen: currentHistoryGen() },
  };
}

/**
 * Where the chat's History entry should go back to: the remembered location,
 * only for the chat opened from it and only within the current generation.
 */
export function historyReturnTarget(chatId: string): { to: string; state: HistoryNavState } | null {
  if (!returnTarget || returnTarget.chatId !== chatId) return null;
  if (returnTarget.state.gen !== currentHistoryGen()) return null;
  return { to: `${returnTarget.pathname}${returnTarget.search}`, state: returnTarget.state };
}

/**
 * Key of a message search for the return cache: query, persona filter, the
 * visible persona set and the generation. Memory only, never stored.
 */
export function searchCacheKey(
  query: string,
  personaFilter: string | null,
  visiblePersonaIds: Iterable<string>,
): string {
  return JSON.stringify([
    query.trim(),
    personaFilter,
    [...visiblePersonaIds].sort(),
    currentHistoryGen(),
  ]);
}

/** The held message search when its key matches, else null. */
export function getSearchCache(key: string): SearchCacheEntry | null {
  return searchCache?.key === key ? searchCache : null;
}

/** Hold one message search (replacing any other) for the return to History. */
export function setSearchCache(entry: SearchCacheEntry): void {
  searchCache = entry;
}

/** Drop the held message search. */
export function clearSearchCache(): void {
  searchCache = null;
}

// Sign-out (and the wipe's `closeAndForget`) ends the session: a new
// generation. Guarded because several tests mock `@chatsundere/ui-shared`
// without a real store.
try {
  if (typeof useSessionStore?.subscribe === 'function') {
    let hadSession = useSessionStore.getState().session !== null;
    useSessionStore.subscribe((s) => {
      const has = s.session !== null;
      if (hadSession && !has) rotateHistoryGen();
      hadSession = has;
    });
  }
} catch {
  // No store in this environment: rotation still runs from the explicit calls.
}
