// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import { currentKey, trailOf } from '../state/nav-trail.store.js';
import type { MessageHit, ScanChat, ScanProgress } from './search/scan-messages.js';

const HISTORY_PATH = '/app/history';

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
  /** Chat ids of the hit groups expanded past their first hits. */
  expandedGroups?: string[];
  /** Whether the title matches were expanded past the preview. */
  titlesExpanded?: boolean;
}

/** What the person had expanded in a held search's results. */
export interface SearchCacheView {
  expandedGroups: string[];
  titlesExpanded: boolean;
}

// The only thing History writes to sessionStorage: an opaque token, no content.
const GEN_KEY = 'cs-history-gen';

let memoryGen: string | null = null;
// `idx` is React Router's index of the History entry in the tab's back stack,
// when known: it tells whether that entry sits directly behind the chat.
let returnTarget: (HistoryReturnLocation & { chatId: string; idx: number | null }) | null = null;
let searchCache: SearchCacheEntry | null = null;
// An expansion made before the search's first flush created its entry; the
// entry takes it over when it lands, and it goes whenever the entry would.
let pendingView: ({ key: string } & Partial<SearchCacheView>) | null = null;
// The state handed to the History visit the quick menu opens forward; the
// menu's navigate takes a path only, so it travels here instead.
let arrival: { to: string; state: HistoryNavState } | null = null;
const genListeners = new Set<() => void>();

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
  pendingView = null;
  arrival = null;
  for (const listener of genListeners) listener();
}

/** Be told when the generation rotates; returns the unsubscribe. */
export function subscribeHistoryGen(listener: () => void): () => void {
  genListeners.add(listener);
  return () => {
    genListeners.delete(listener);
  };
}

/** React Router's index of the current entry, when the browser history carries it. */
function currentEntryIdx(): number | null {
  try {
    const idx = (window.history.state as { idx?: unknown } | null)?.idx;
    return typeof idx === 'number' ? idx : null;
  } catch {
    return null;
  }
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
    idx: currentEntryIdx(),
  };
}

/**
 * Drop the return target. History calls it on mount: arriving there uses the
 * return up, and the next hit or bookmark tap remembers a fresh one.
 */
export function clearHistoryReturn(): void {
  returnTarget = null;
}

/**
 * A chat page was opened. The return target belongs to the chat opened from
 * History only: once another chat is open, the quick menu behaves as before.
 */
export function noteChatOpened(chatId: string | null): void {
  if (returnTarget && returnTarget.chatId !== chatId) returnTarget = null;
}

/**
 * The quick menu's History entry (spec §10.1): back to the remembered History
 * location for the chat opened from it — by a step back when that entry sits
 * directly behind the chat, else by a new visit carrying its state — and to
 * `fallback` otherwise.
 */
export function goHistory(
  chatId: string | null,
  fallback: string,
  navigateTo: (to: string) => void,
  close: () => void,
): void {
  close();
  // History directly behind the chat (by the chat entry's trail, which survives a
  // reload): a step back restores it as left, query and scroll from its own
  // history.state; nothing goes into the URL or storage.
  const key = currentKey();
  if (key !== null && trailOf(key).at(-1) === HISTORY_PATH) {
    window.history.back();
    return;
  }
  const target = chatId ? historyReturnTarget(chatId) : null;
  if (!target) {
    navigateTo(fallback);
    return;
  }
  const idx = returnTarget?.idx ?? null;
  const here = currentEntryIdx();
  if (idx !== null && here === idx + 1) {
    window.history.back();
    return;
  }
  arrival = target;
  navigateTo(target.to);
}

/**
 * The state the quick menu handed to a History visit at `to` (path plus
 * search), within the current generation; null otherwise. Does not consume.
 */
export function historyArrivalState(to: string): HistoryNavState | null {
  if (!arrival || arrival.to !== to) return null;
  if (arrival.state.gen !== currentHistoryGen()) return null;
  return arrival.state;
}

/** Drop the handed-over state once History has taken it. */
export function clearHistoryArrival(): void {
  arrival = null;
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

/**
 * Hold one message search (replacing any other) for the return to History. A
 * flush for the same search keeps what was expanded unless the entry says.
 */
export function setSearchCache(entry: SearchCacheEntry): void {
  const prev =
    searchCache?.key === entry.key
      ? searchCache
      : pendingView?.key === entry.key
        ? pendingView
        : null;
  pendingView = null;
  searchCache = {
    ...entry,
    ...(entry.expandedGroups === undefined && prev?.expandedGroups !== undefined
      ? { expandedGroups: prev.expandedGroups }
      : {}),
    ...(entry.titlesExpanded === undefined && prev?.titlesExpanded !== undefined
      ? { titlesExpanded: prev.titlesExpanded }
      : {}),
  };
}

/** What was expanded in the held search for `key`; nothing expanded when none matches. */
export function getSearchCacheView(key: string): SearchCacheView {
  const src =
    searchCache?.key === key ? searchCache : pendingView?.key === key ? pendingView : null;
  return {
    expandedGroups: src?.expandedGroups ?? [],
    titlesExpanded: src?.titlesExpanded ?? false,
  };
}

/**
 * Record an expansion in the held search for `key`. Memory only, like the
 * entry itself; before the entry exists it waits for the entry's first flush.
 */
export function setSearchCacheView(key: string, patch: Partial<SearchCacheView>): void {
  if (searchCache?.key === key) {
    searchCache = { ...searchCache, ...patch };
    return;
  }
  pendingView = { ...(pendingView?.key === key ? pendingView : { key }), ...patch };
}

/** Drop the held message search. */
export function clearSearchCache(): void {
  searchCache = null;
  pendingView = null;
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
