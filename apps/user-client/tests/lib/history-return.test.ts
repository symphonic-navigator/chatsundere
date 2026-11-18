// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { type AppSession, useSessionStore } from '@chatsundere/ui-shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { useAdultMode, useUpdateSettings } from '../../src/data/settings.js';
import {
  clearSearchCache,
  currentHistoryGen,
  getSearchCache,
  historyReturnTarget,
  rememberHistoryReturn,
  rotateHistoryGen,
  searchCacheKey,
  setSearchCache,
} from '../../src/lib/history-return.js';

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
