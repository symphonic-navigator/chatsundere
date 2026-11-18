// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  type HistoryNavState,
  type HistoryReturnLocation,
  clearHistoryArrival,
  currentHistoryGen,
  historyArrivalState,
  subscribeHistoryGen,
} from '../../lib/history-return.js';

/** How long the query waits after the last keystroke before it is written to the entry. */
export const NAV_STATE_DEBOUNCE_MS = 250;
/** How long scrolling must pause before the offset is written to the entry. */
const SCROLL_SAVE_MS = 200;

export interface HistoryNavStateApi {
  /** The query as typed (never in the address). */
  q: string;
  /** Update the query; written to the entry's state debounced, with `replace`. */
  setQ: (q: string) => void;
  /** Scroll offset to restore once, from a current-generation state; null when none. */
  scrollY: number | null;
  /**
   * Write the query and `window.scrollY` into the entry's state now, before
   * leaving. Returns the location as written, ready for `rememberHistoryReturn`.
   */
  saveScroll: () => HistoryReturnLocation;
}

/** The state when it is History's own and of the current generation, else null. */
function currentState(raw: unknown): HistoryNavState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Partial<HistoryNavState>;
  if (s.gen !== currentHistoryGen()) return null;
  return {
    gen: s.gen,
    ...(typeof s.q === 'string' && s.q !== '' ? { q: s.q } : {}),
    ...(typeof s.scrollY === 'number' && Number.isFinite(s.scrollY) ? { scrollY: s.scrollY } : {}),
  };
}

function sameState(raw: unknown, want: HistoryNavState): boolean {
  if (typeof raw !== 'object' || raw === null)
    return want.q === undefined && want.scrollY === undefined;
  const s = raw as Partial<HistoryNavState>;
  return s.gen === want.gen && s.q === want.q && s.scrollY === want.scrollY;
}

function searchWithoutQ(search: string): { search: string; hadQ: boolean; q: string | null } {
  const params = new URLSearchParams(search);
  const q = params.get('q');
  if (!params.has('q')) return { search, hadQ: false, q: null };
  params.delete('q');
  const rest = params.toString();
  return { search: rest === '' ? '' : `?${rest}`, hadQ: true, q };
}

/**
 * My History's query and scroll offset, kept in the entry's `location.state`
 * tagged with the generation token (spec §10): never in the address, never in
 * storage. A state of an older generation is discarded on arrival; an inbound
 * `?q=` is moved into state and stripped from the address at once.
 */
export function useHistoryNavState(): HistoryNavStateApi {
  const location = useLocation();
  const navigate = useNavigate();

  const [initial] = useState(() => {
    const inbound = new URLSearchParams(location.search).get('q');
    // The quick menu's forward return carries its state beside the path.
    const st =
      currentState(location.state) ??
      currentState(historyArrivalState(`${location.pathname}${location.search}`));
    if (inbound !== null) return { q: inbound, scrollY: null };
    return { q: st?.q ?? '', scrollY: st?.scrollY ?? null };
  });

  const [q, setQState] = useState(initial.q);
  const [committedQ, setCommittedQ] = useState(initial.q);
  const qRef = useRef(initial.q);
  const committedRef = useRef(initial.q);
  const scrollRef = useRef<number | null>(initial.scrollY);
  const locationRef = useRef(location);
  locationRef.current = location;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped when the generation rotates while History is mounted.
  const [genTick, setGenTick] = useState(0);

  useEffect(() => clearHistoryArrival(), []);

  // A rotation (adult-mode flip, sign-out, wipe, decouple) discards the typed
  // query and the offset here too, not only in the entry's state.
  useEffect(
    () =>
      subscribeHistoryGen(() => {
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }
        qRef.current = '';
        committedRef.current = '';
        scrollRef.current = null;
        setQState('');
        setCommittedQ('');
        setGenTick((n) => n + 1);
      }),
    [],
  );

  const wantState = useCallback((): HistoryNavState => {
    const committed = committedRef.current;
    return {
      gen: currentHistoryGen(),
      ...(committed !== '' ? { q: committed } : {}),
      ...(scrollRef.current !== null ? { scrollY: scrollRef.current } : {}),
    };
  }, []);

  // Keeps the entry's state in step with the query, and repairs it whenever
  // another navigation on this entry (a `setSearchParams` with `replace`, say)
  // dropped it. Also discards a stale-generation state and strips `?q=`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: committedQ and genTick re-run it; the refs carry the values.
  useEffect(() => {
    const loc = locationRef.current;
    const stripped = searchWithoutQ(loc.search);
    const want = wantState();
    if (!stripped.hadQ && sameState(loc.state, want)) return;
    navigate(
      { pathname: loc.pathname, search: stripped.search, hash: loc.hash },
      { replace: true, state: want },
    );
  }, [location.key, location.search, committedQ, genTick, navigate, wantState]);

  const setQ = useCallback((next: string) => {
    qRef.current = next;
    setQState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (committedRef.current === next) return;
      committedRef.current = next;
      // An offset saved for another query means nothing for this one.
      scrollRef.current = null;
      setCommittedQ(next);
    }, NAV_STATE_DEBOUNCE_MS);
  }, []);

  const saveScroll = useCallback((): HistoryReturnLocation => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (committedRef.current !== qRef.current) {
      committedRef.current = qRef.current;
      setCommittedQ(qRef.current);
    }
    scrollRef.current = window.scrollY;
    const loc = locationRef.current;
    const search = searchWithoutQ(loc.search).search;
    const state = wantState();
    navigate({ pathname: loc.pathname, search, hash: loc.hash }, { replace: true, state });
    return { pathname: loc.pathname, search, state };
  }, [navigate, wantState]);

  // Fallback for leaving by any other way (the page bar, the system Back): the
  // offset is written while this entry is still the current one, after
  // scrolling settles. On unmount the router has already moved to the next
  // entry, so writing then would land on the wrong one.
  useEffect(() => {
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = (): void => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        scrollRef.current = window.scrollY;
        try {
          const entry = window.history.state as { usr?: unknown } | null;
          const usr = currentState(entry?.usr);
          if (!entry || !usr) return;
          window.history.replaceState({ ...entry, usr: { ...usr, scrollY: window.scrollY } }, '');
        } catch {
          // History API refused (sandboxed frame): the explicit save still runs on taps.
        }
      }, SCROLL_SAVE_MS);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (scrollTimer) clearTimeout(scrollTimer);
    };
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { q, setQ, scrollY: genTick === 0 ? initial.scrollY : null, saveScroll };
}
