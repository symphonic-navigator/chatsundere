// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { type AppSession, useSessionStore } from '@chatsundere/ui-shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { useAdultMode, useUpdateSettings } from '../../src/data/settings.js';
import {
  clearHistoryReturn,
  clearSearchCache,
  currentHistoryGen,
  getSearchCache,
  getSearchCacheView,
  goHistory,
  historyArrivalState,
  historyReturnTarget,
  noteChatOpened,
  rememberHistoryReturn,
  rotateHistoryGen,
  searchCacheKey,
  setSearchCache,
  setSearchCacheView,
  subscribeHistoryGen,
} from '../../src/lib/history-return.js';
import { recordLocation, resetNavTrailForTests } from '../../src/state/nav-trail.store.js';

function storedValues(): string[] {
  const out: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k !== null) out.push(k, sessionStorage.getItem(k) ?? '');
  }
  return out;
}

function cacheEntry(key: string) {
  return {
    key,
    hits: [],
    chats: [],
    progress: { scannedChats: 0, totalChats: 0, hits: 0, capped: false, done: true, nextIndex: 0 },
  };
}

describe('history-return', () => {
  beforeEach(() => {
    sessionStorage.clear();
    rotateHistoryGen();
  });

  it('keeps one stable generation token until rotated', () => {
    const a = currentHistoryGen();
    expect(currentHistoryGen()).toBe(a);
    rotateHistoryGen();
    expect(currentHistoryGen()).not.toBe(a);
  });

  it('reads the token back from sessionStorage, as after a reload', () => {
    sessionStorage.setItem('cs-history-gen', 'from-before-reload');
    expect(currentHistoryGen()).toBe('from-before-reload');
  });

  it('rotation clears the return cache and the return target', () => {
    const key = searchCacheKey('paprika', null, ['p1']);
    setSearchCache(cacheEntry(key));
    rememberHistoryReturn(
      { pathname: '/app/history', search: '', state: { q: 'paprika', gen: currentHistoryGen() } },
      'chat-1',
    );
    expect(getSearchCache(key)).not.toBeNull();
    expect(historyReturnTarget('chat-1')).not.toBeNull();

    rotateHistoryGen();
    expect(getSearchCache(key)).toBeNull();
    expect(historyReturnTarget('chat-1')).toBeNull();
  });

  it('the cache key changes with the generation, so an old entry never matches', () => {
    const before = searchCacheKey('paprika', null, ['p2', 'p1']);
    expect(searchCacheKey('paprika', null, ['p1', 'p2'])).toBe(before);
    rotateHistoryGen();
    expect(searchCacheKey('paprika', null, ['p1', 'p2'])).not.toBe(before);
  });

  it('holds one entry and drops it on clear', () => {
    const a = searchCacheKey('one', null, []);
    const b = searchCacheKey('two', null, []);
    setSearchCache(cacheEntry(a));
    setSearchCache(cacheEntry(b));
    expect(getSearchCache(a)).toBeNull();
    expect(getSearchCache(b)?.key).toBe(b);
    clearSearchCache();
    expect(getSearchCache(b)).toBeNull();
  });

  it('holds what was expanded with the entry, across flushes, and drops it with the entry', () => {
    const a = searchCacheKey('one', null, []);
    const b = searchCacheKey('two', null, []);
    setSearchCache(cacheEntry(a));
    setSearchCacheView(a, { expandedGroups: ['c1'] });
    setSearchCacheView(a, { titlesExpanded: true });
    setSearchCache(cacheEntry(a));
    expect(getSearchCacheView(a)).toEqual({ expandedGroups: ['c1'], titlesExpanded: true });
    expect(getSearchCache(a)?.expandedGroups).toEqual(['c1']);
    expect(getSearchCacheView(b)).toEqual({ expandedGroups: [], titlesExpanded: false });
    setSearchCache(cacheEntry(b));
    expect(getSearchCacheView(a)).toEqual({ expandedGroups: [], titlesExpanded: false });
    setSearchCacheView(b, { titlesExpanded: true });
    rotateHistoryGen();
    expect(getSearchCacheView(b)).toEqual({ expandedGroups: [], titlesExpanded: false });
  });

  it('an expansion before the first flush waits for the entry', () => {
    const a = searchCacheKey('one', null, []);
    setSearchCacheView(a, { titlesExpanded: true });
    expect(getSearchCacheView(a).titlesExpanded).toBe(true);
    setSearchCache(cacheEntry(a));
    expect(getSearchCache(a)?.titlesExpanded).toBe(true);
    setSearchCacheView(a, { expandedGroups: ['c2'] });
    clearSearchCache();
    expect(getSearchCacheView(a)).toEqual({ expandedGroups: [], titlesExpanded: false });
  });

  it('clearHistoryReturn drops the return target', () => {
    rememberHistoryReturn(
      { pathname: '/app/history', search: '', state: { gen: currentHistoryGen() } },
      'chat-1',
    );
    clearHistoryReturn();
    expect(historyReturnTarget('chat-1')).toBeNull();
  });

  it('the return target exists only for the chat opened from History', () => {
    const gen = currentHistoryGen();
    rememberHistoryReturn(
      { pathname: '/app/history', search: '?tab=bookmarks', state: { q: 'paprika', gen } },
      'chat-1',
    );
    expect(historyReturnTarget('chat-1')).toEqual({
      to: '/app/history?tab=bookmarks',
      state: { q: 'paprika', gen },
    });
    expect(historyReturnTarget('chat-2')).toBeNull();
  });

  it('opening another chat drops the return target; the same chat keeps it', () => {
    const gen = currentHistoryGen();
    rememberHistoryReturn({ pathname: '/app/history', search: '', state: { gen } }, 'chat-1');
    noteChatOpened('chat-1');
    expect(historyReturnTarget('chat-1')).not.toBeNull();
    noteChatOpened('chat-2');
    expect(historyReturnTarget('chat-1')).toBeNull();
  });

  it('a lazy new chat counts as another chat', () => {
    rememberHistoryReturn(
      { pathname: '/app/history', search: '', state: { gen: currentHistoryGen() } },
      'chat-1',
    );
    noteChatOpened(null);
    expect(historyReturnTarget('chat-1')).toBeNull();
  });

  it('goHistory falls back to the default address without a target', () => {
    const nav = vi.fn();
    const close = vi.fn();
    goHistory('chat-9', '/app/history?personaId=p1', nav, close);
    expect(close).toHaveBeenCalledOnce();
    expect(nav).toHaveBeenCalledWith('/app/history?personaId=p1');
  });

  it('goHistory opens the remembered location and hands its state over', () => {
    const gen = currentHistoryGen();
    rememberHistoryReturn(
      {
        pathname: '/app/history',
        search: '?tab=bookmarks',
        state: { q: 'paprika', scrollY: 300, gen },
      },
      'chat-1',
    );
    const nav = vi.fn();
    goHistory('chat-1', '/app/history?personaId=p1', nav, vi.fn());
    expect(nav).toHaveBeenCalledWith('/app/history?tab=bookmarks');
    expect(historyArrivalState('/app/history?tab=bookmarks')).toEqual({
      q: 'paprika',
      scrollY: 300,
      gen,
    });
    expect(historyArrivalState('/app/history')).toBeNull();
    rotateHistoryGen();
    expect(historyArrivalState('/app/history?tab=bookmarks')).toBeNull();
  });

  it('goHistory steps back when the History entry sits directly behind the chat', () => {
    const original = window.history.state;
    window.history.replaceState({ usr: null, key: 'h', idx: 4 }, '');
    rememberHistoryReturn(
      { pathname: '/app/history', search: '', state: { gen: currentHistoryGen() } },
      'chat-1',
    );
    window.history.replaceState({ usr: null, key: 'c', idx: 5 }, '');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const nav = vi.fn();
    goHistory('chat-1', '/app/history', nav, vi.fn());
    expect(back).toHaveBeenCalledOnce();
    expect(nav).not.toHaveBeenCalled();
    back.mockRestore();
    window.history.replaceState(original, '');
  });

  it('goHistory steps back to a History entry directly behind, even after a reload lost its memory', () => {
    // A reload empties the memory-only return target, but the trail of the chat's
    // history entry (in history.state) still says History sits directly behind it.
    resetNavTrailForTests();
    recordLocation({ key: 'h', pathname: '/app/history' }, 'POP');
    recordLocation({ key: 'c', pathname: '/app/chat/chat-1' }, 'PUSH');
    clearHistoryReturn();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const nav = vi.fn();
    goHistory('chat-1', '/app/history', nav, vi.fn());
    expect(back).toHaveBeenCalledOnce();
    expect(nav).not.toHaveBeenCalled();
    back.mockRestore();
    resetNavTrailForTests();
  });

  it('goHistory opens a fresh visit when History is not directly behind', () => {
    resetNavTrailForTests();
    recordLocation({ key: 'h', pathname: '/app/history' }, 'POP');
    recordLocation({ key: 'x', pathname: '/app/persona/p1' }, 'PUSH');
    recordLocation({ key: 'c', pathname: '/app/chat/chat-1' }, 'PUSH');
    clearHistoryReturn();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const nav = vi.fn();
    goHistory('chat-1', '/app/history', nav, vi.fn());
    expect(back).not.toHaveBeenCalled();
    expect(nav).toHaveBeenCalledWith('/app/history');
    back.mockRestore();
    resetNavTrailForTests();
  });

  it('notifies subscribers on rotation until they unsubscribe', () => {
    const listener = vi.fn();
    const off = subscribeHistoryGen(listener);
    rotateHistoryGen();
    expect(listener).toHaveBeenCalledOnce();
    off();
    rotateHistoryGen();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('a remembered address never carries the query', () => {
    rememberHistoryReturn(
      {
        pathname: '/app/history',
        search: '?personaId=p1&q=paprika',
        state: { q: 'paprika', gen: currentHistoryGen() },
      },
      'chat-1',
    );
    expect(historyReturnTarget('chat-1')?.to).toBe('/app/history?personaId=p1');
  });

  it('sessionStorage holds only the token, never the query', () => {
    const key = searchCacheKey('paprika', null, ['p1']);
    setSearchCache(cacheEntry(key));
    rememberHistoryReturn(
      { pathname: '/app/history', search: '', state: { q: 'paprika', gen: currentHistoryGen() } },
      'chat-1',
    );
    const stored = storedValues();
    expect(stored).toEqual(['cs-history-gen', currentHistoryGen()]);
    expect(stored.some((v) => v.includes('paprika'))).toBe(false);
  });

  it('works on without sessionStorage', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      const a = currentHistoryGen();
      expect(currentHistoryGen()).toBe(a);
      rotateHistoryGen();
      expect(currentHistoryGen()).not.toBe(a);
    } finally {
      if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    }
  });

  it('a sign-out (session to null) rotates the generation', () => {
    useSessionStore.getState().setSession({ close: () => undefined } as unknown as AppSession);
    const before = currentHistoryGen();
    useSessionStore.getState().closeAndForget();
    expect(currentHistoryGen()).not.toBe(before);
  });

  it('an adult-mode flip rotates the generation; other settings writes do not', async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => ({ adult: useAdultMode(), update: useUpdateSettings() }), {
      wrapper,
    });
    await waitFor(() => expect(qc.getQueryData(['settings'])).toBeDefined());

    const before = currentHistoryGen();
    await act(() => result.current.update.mutateAsync({ adultMode: 'nsfw' }));
    expect(currentHistoryGen()).toBe(before);
    await act(() => result.current.update.mutateAsync({ displayName: 'Chris' }));
    expect(currentHistoryGen()).toBe(before);
    await act(() => result.current.adult.setMode('sfw'));
    expect(currentHistoryGen()).not.toBe(before);
  });
});
