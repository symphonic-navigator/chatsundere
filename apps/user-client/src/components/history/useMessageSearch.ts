// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { getSearchCache, searchCacheKey, setSearchCache } from '../../lib/history-return.js';
import {
  type MessageHit,
  type ScanChat,
  type ScanProgress,
  scanMessages,
} from '../../lib/search/scan-messages.js';

/** Quiet time after the last change before a scan starts (spec §8.2). */
export const SEARCH_DEBOUNCE_MS = 250;
/** Shortest query, in characters, that searches inside messages. */
export const MIN_MESSAGE_QUERY = 2;

export interface MessageSearchInput {
  query: string;
  /** Already gated by adult mode and narrowed by the persona filter, newest chat first. */
  chats: readonly ScanChat[];
  personaFilter: string | null;
  visiblePersonaIds: Iterable<string>;
  /**
   * False while the chat list or the visible persona set is still loading, so
   * a half-loaded set neither scans nor replaces the held return cache.
   */
  enabled?: boolean;
}

export type MessageSearchStatus = 'idle' | 'short' | 'scanning' | 'done';

export interface MessageSearchResult {
  status: MessageSearchStatus;
  hits: MessageHit[];
  /** Null while idle, short or not yet enabled. */
  progress: ScanProgress | null;
  capped: boolean;
  /** The search's return-cache key; null while idle, short or not yet enabled. */
  cacheKey: string | null;
}

interface Held {
  key: string;
  hits: MessageHit[];
  progress: ScanProgress;
}

function startProgress(totalChats: number): ScanProgress {
  return { scannedChats: 0, totalChats, hits: 0, capped: false, done: false, nextIndex: 0 };
}

/** The cached search for `key`, or a fresh empty one over `chats`. */
function heldFor(key: string, chats: readonly ScanChat[]): Held {
  const cached = getSearchCache(key);
  if (cached) return { key, hits: cached.hits, progress: cached.progress };
  return { key, hits: [], progress: startProgress(chats.length) };
}

/**
 * Search inside the given chats' messages for `query`, streaming hits in scan
 * order. Debounced, aborted on any input change and on unmount; the partial
 * result is held in the return cache at every flush, so a return to History
 * renders it at once and resumes the scan where it stopped.
 */
export function useMessageSearch(input: MessageSearchInput): MessageSearchResult {
  const query = input.query.trim();
  const length = [...query].length;
  const enabled = input.enabled !== false;
  const key =
    enabled && length >= MIN_MESSAGE_QUERY
      ? searchCacheKey(query, input.personaFilter, input.visiblePersonaIds)
      : null;

  const chatsRef = useRef(input.chats);
  chatsRef.current = input.chats;
  const [held, setHeld] = useState<Held | null>(() =>
    key === null ? null : heldFor(key, input.chats),
  );

  // Only `key` restarts the scan: a reordered or refetched chat list alone does
  // not, so groups never reshuffle mid-stream. The visible persona set is part
  // of the key, so a gating change always aborts and starts over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: query is part of key; the chat list is read through its ref.
  useEffect(() => {
    if (key === null) {
      setHeld(null);
      return;
    }
    const live = chatsRef.current;
    const cached = getSearchCache(key);
    let work: ScanChat[];
    let startIndex = 0;
    let hits: MessageHit[] = [];
    if (cached) {
      // Resume over the chats already scanned plus those still to come that are
      // in the current list (deleted ones are skipped), so nothing is read twice.
      const liveIds = new Set(live.map((c) => c.id));
      const scanned = cached.chats.slice(0, cached.progress.nextIndex);
      const rest = cached.chats.slice(cached.progress.nextIndex).filter((c) => liveIds.has(c.id));
      work = [...scanned, ...rest];
      startIndex = scanned.length;
      hits = cached.hits;
      setHeld({ key, hits, progress: cached.progress });
      if (cached.progress.done) return;
    } else {
      work = [...live];
      setHeld({ key, hits, progress: startProgress(work.length) });
    }

    let last: ScanProgress = cached?.progress ?? startProgress(work.length);
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        scanMessages({
          chats: work,
          query,
          startIndex,
          initialHits: hits.length,
          signal: controller.signal,
          onHits: (batch) => {
            hits = [...hits, ...batch];
          },
          onProgress: (progress) => {
            if (controller.signal.aborted) return;
            last = progress;
            setSearchCache({ key, hits, progress, chats: work });
            setHeld({ key, hits, progress });
          },
        }).catch(() => {
          // A failed read ends the search with what it found rather than a pill
          // that never goes away.
          if (!controller.signal.aborted) setHeld({ key, hits, progress: { ...last, done: true } });
        });
      },
      cached ? 0 : SEARCH_DEBOUNCE_MS,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  if (length === 0)
    return { status: 'idle', hits: [], progress: null, capped: false, cacheKey: null };
  if (length < MIN_MESSAGE_QUERY)
    return { status: 'short', hits: [], progress: null, capped: false, cacheKey: null };
  if (key === null)
    return { status: 'scanning', hits: [], progress: null, capped: false, cacheKey: null };
  // Between a key change and its effect, never show the previous query's hits.
  const view = held?.key === key ? held : heldFor(key, input.chats);
  return {
    status: view.progress.done ? 'done' : 'scanning',
    hits: view.hits,
    progress: view.progress,
    capped: view.progress.capped,
    cacheKey: key,
  };
}
