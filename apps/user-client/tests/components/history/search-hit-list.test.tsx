// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchHitList } from '../../../src/components/history/SearchHitList.js';
import {
  type MessageSearchInput,
  SEARCH_DEBOUNCE_MS,
  useMessageSearch,
} from '../../../src/components/history/useMessageSearch.js';
import { rotateHistoryGen } from '../../../src/lib/history-return.js';
import type { SearchHitGroup } from '../../../src/lib/search/hit-groups.js';
import type {
  MessageHit,
  ScanChat,
  scanMessages as ScanFn,
  ScanProgress,
} from '../../../src/lib/search/scan-messages.js';

type ScanArgs = Parameters<typeof ScanFn>[0];
const scanSpy = vi.hoisted(() => vi.fn());
vi.mock('../../../src/lib/search/scan-messages.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/search/scan-messages.js')>()),
  scanMessages: scanSpy,
}));

function group(key: string, n: number): SearchHitGroup {
  return {
    key,
    title: `Chat ${key}`,
    personaId: 'p1',
    totalHits: n,
    hits: Array.from({ length: n }, (_, i) => ({
      key: `${key}-m${i}`,
      roleLabel: i % 2 === 0 ? 'You' : 'Mira',
      date: new Date(2026, 10, 3).getTime(),
      snippet: { text: `…the paprika number ${i}…`, marks: [[5, 12]] as [number, number][] },
      href: `/app/chat/${key}?focus=${key}-m${i}`,
    })),
  };
}

const personaById = new Map([['p1', { id: 'p1', name: 'Mira', colour: '#c9a' }]]);

function renderList(groups: SearchHitGroup[], onOpen = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SearchHitList groups={groups} personaById={personaById} onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return onOpen;
}

describe('SearchHitList', () => {
  it('shows three hits per chat, then expands the rest in place', () => {
    renderList([group('a', 5)]);
    expect(document.querySelectorAll('[data-search-hit]')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '+ 2 more in this chat' }));
    expect(document.querySelectorAll('[data-search-hit]')).toHaveLength(5);
    expect(screen.queryByText(/more in this chat/)).toBeNull();
  });

  it('starts with the held groups expanded and reports every expansion', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onExpandedChange = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <SearchHitList
          groups={[group('a', 5), group('b', 4)]}
          personaById={personaById}
          onOpen={vi.fn()}
          initialExpanded={['a']}
          onExpandedChange={onExpandedChange}
        />
      </QueryClientProvider>,
    );
    expect(document.querySelectorAll('[data-search-group="a"] [data-search-hit]')).toHaveLength(5);
    expect(document.querySelectorAll('[data-search-group="b"] [data-search-hit]')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '+ 1 more in this chat' }));
    expect(onExpandedChange).toHaveBeenCalledWith(['a', 'b']);
  });

  it('renders the header title, role labels, date and marked words', () => {
    renderList([group('a', 2)]);
    expect(screen.getByRole('heading', { name: 'Chat a' })).toBeInTheDocument();
    expect(screen.getByText('You · 3 Nov')).toBeInTheDocument();
    expect(screen.getByText('Mira · 3 Nov')).toBeInTheDocument();
    const marks = document.querySelectorAll('mark.cs-search-mark');
    expect(marks).toHaveLength(2);
    expect(marks[0]?.textContent).toBe('paprika');
    expect(marks[0]?.parentElement?.textContent).toBe('…the paprika number 0…');
  });

  it('hands the tapped hit and its group to onOpen; the header is not a button', () => {
    const onOpen = renderList([group('a', 1)]);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[0].href).toBe('/app/chat/a?focus=a-m0');
    expect(onOpen.mock.calls[0]?.[1].key).toBe('a');
  });
});

function chats(...ids: string[]): ScanChat[] {
  return ids.map((id) => ({ id, personaId: 'p1', title: id }));
}

function msgHit(chatId: string, messageId: string): MessageHit {
  return {
    chatId,
    messageId,
    role: 'user',
    createdAt: 1,
    snippet: { text: 'paprika', marks: [[0, 7]] },
  };
}

function progress(p: Partial<ScanProgress>): ScanProgress {
  return {
    scannedChats: 0,
    totalChats: 0,
    hits: 0,
    capped: false,
    done: false,
    nextIndex: 0,
    ...p,
  };
}

function lastScan(): ScanArgs {
  const call = scanSpy.mock.calls.at(-1);
  if (!call) throw new Error('scanMessages was not called');
  return call[0] as ScanArgs;
}

describe('useMessageSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    scanSpy.mockReset();
    scanSpy.mockImplementation(() => Promise.resolve());
    rotateHistoryGen();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const base = (query: string, list = chats('a', 'b')): MessageSearchInput => ({
    query,
    chats: list,
    personaFilter: null,
    visiblePersonaIds: ['p1'],
  });

  it('is idle without a query and short with one letter, and never scans', () => {
    const { result, rerender } = renderHook((i: MessageSearchInput) => useMessageSearch(i), {
      initialProps: base(''),
    });
    expect(result.current.status).toBe('idle');
    rerender(base('p'));
    expect(result.current.status).toBe('short');
    act(() => vi.advanceTimersByTime(1000));
    expect(scanSpy).not.toHaveBeenCalled();
  });

  it('debounces: only the query typed last is scanned, after 250 ms', () => {
    const { result, rerender } = renderHook((i: MessageSearchInput) => useMessageSearch(i), {
      initialProps: base('pa'),
    });
    expect(result.current.status).toBe('scanning');
    expect(result.current.progress?.totalChats).toBe(2);
    act(() => vi.advanceTimersByTime(100));
    rerender(base('pap'));
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
    expect(scanSpy).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(scanSpy).toHaveBeenCalledTimes(1);
    expect(lastScan().query).toBe('pap');
    expect(lastScan().chats.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('aborts the running scan on a change, and ignores its late results', () => {
    const { result, rerender } = renderHook((i: MessageSearchInput) => useMessageSearch(i), {
      initialProps: base('paprika'),
    });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    const first = lastScan();
    rerender({ ...base('paprika'), personaFilter: 'p1' });
    expect(first.signal.aborted).toBe(true);
    act(() => {
      first.onHits([msgHit('a', 'm1')]);
      first.onProgress(progress({ hits: 1, done: true, nextIndex: 2 }));
    });
    expect(result.current.hits).toEqual([]);
    expect(result.current.status).toBe('scanning');
  });

  it('aborts on unmount', () => {
    const { unmount } = renderHook((i: MessageSearchInput) => useMessageSearch(i), {
      initialProps: base('paprika'),
    });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    unmount();
    expect(lastScan().signal.aborted).toBe(true);
  });

  it('streams hits and reports done and capped', () => {
    const { result } = renderHook((i: MessageSearchInput) => useMessageSearch(i), {
      initialProps: base('paprika'),
    });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    act(() => {
      lastScan().onHits([msgHit('a', 'm1')]);
      lastScan().onProgress(progress({ scannedChats: 1, totalChats: 2, hits: 1, nextIndex: 1 }));
    });
    expect(result.current.hits.map((h) => h.messageId)).toEqual(['m1']);
    expect(result.current.status).toBe('scanning');
    act(() => {
      lastScan().onHits([msgHit('b', 'm2')]);
      lastScan().onProgress(
        progress({
          scannedChats: 2,
          totalChats: 2,
          hits: 2,
          capped: true,
          done: true,
          nextIndex: 2,
        }),
      );
    });
    expect(result.current.hits.map((h) => h.messageId)).toEqual(['m1', 'm2']);
    expect(result.current.status).toBe('done');
    expect(result.current.capped).toBe(true);
  });

  it('on return, renders the held partial result at once and resumes where it stopped', () => {
    const first = renderHook((i: MessageSearchInput) => useMessageSearch(i), {
      initialProps: base('paprika', chats('a', 'b', 'c')),
    });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    act(() => {
      lastScan().onHits([msgHit('a', 'm1')]);
      lastScan().onProgress(progress({ scannedChats: 1, totalChats: 3, hits: 1, nextIndex: 1 }));
    });
    first.unmount();

    // Chat b was deleted while away; c is still to come.
    const again = renderHook((i: MessageSearchInput) => useMessageSearch(i), {
      initialProps: base('paprika', chats('a', 'c')),
    });
    expect(again.result.current.hits.map((h) => h.messageId)).toEqual(['m1']);
    expect(scanSpy).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(0));
    expect(scanSpy).toHaveBeenCalledTimes(2);
    expect(lastScan().chats.map((c) => c.id)).toEqual(['a', 'c']);
    expect(lastScan().startIndex).toBe(1);
    expect(lastScan().initialHits).toBe(1);
  });

  it('a finished held search is shown without scanning again', () => {
    const first = renderHook((i: MessageSearchInput) => useMessageSearch(i), {
      initialProps: base('paprika'),
    });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    act(() => {
      lastScan().onHits([msgHit('a', 'm1')]);
      lastScan().onProgress(
        progress({ scannedChats: 2, totalChats: 2, hits: 1, done: true, nextIndex: 2 }),
      );
    });
    first.unmount();
    const again = renderHook((i: MessageSearchInput) => useMessageSearch(i), {
      initialProps: base('paprika'),
    });
    act(() => vi.advanceTimersByTime(1000));
    expect(again.result.current.status).toBe('done');
    expect(again.result.current.hits).toHaveLength(1);
    expect(scanSpy).toHaveBeenCalledTimes(1);
  });

  it('a different visible persona set never reuses the held search', () => {
    const first = renderHook((i: MessageSearchInput) => useMessageSearch(i), {
      initialProps: base('paprika'),
    });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    act(() => {
      lastScan().onHits([msgHit('a', 'm1')]);
      lastScan().onProgress(progress({ hits: 1, done: true, nextIndex: 2 }));
    });
    first.unmount();
    const again = renderHook((i: MessageSearchInput) => useMessageSearch(i), {
      initialProps: { ...base('paprika'), visiblePersonaIds: ['p1', 'p2'] },
    });
    expect(again.result.current.hits).toEqual([]);
    expect(again.result.current.status).toBe('scanning');
  });

  it('does nothing while not enabled', () => {
    const { result } = renderHook((i: MessageSearchInput) => useMessageSearch(i), {
      initialProps: { ...base('paprika'), enabled: false },
    });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.status).toBe('scanning');
    expect(result.current.progress).toBeNull();
    expect(scanSpy).not.toHaveBeenCalled();
  });
});
