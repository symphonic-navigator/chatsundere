// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type HistoryNavStateApi,
  useHistoryNavState,
} from '../../../src/components/history/useHistoryNavState.js';
import {
  type HistoryReturnLocation,
  currentHistoryGen,
  rotateHistoryGen,
} from '../../../src/lib/history-return.js';

let api: HistoryNavStateApi | null = null;
let seen: { search: string; state: unknown }[] = [];

function Probe(): JSX.Element {
  const loc = useLocation();
  seen.push({ search: loc.search, state: loc.state });
  return (
    <>
      <div data-testid="search">{loc.search}</div>
      <div data-testid="state">{JSON.stringify(loc.state ?? null)}</div>
    </>
  );
}

function Page(): JSX.Element {
  api = useHistoryNavState();
  const [search, setSearch] = useSearchParams();
  return (
    <>
      <div data-testid="q">{api.q}</div>
      <div data-testid="scroll">{String(api.scrollY)}</div>
      <button
        type="button"
        onClick={() => {
          const next = new URLSearchParams(search);
          next.set('personaId', 'p9');
          setSearch(next, { replace: true });
        }}
      >
        filter
      </button>
    </>
  );
}

function renderAt(entry: string | { pathname: string; search?: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Probe />
      <Routes>
        <Route path="/app/history" element={<Page />} />
      </Routes>
    </MemoryRouter>,
  );
}

function state(): Record<string, unknown> | null {
  return JSON.parse(screen.getByTestId('state').textContent ?? 'null');
}

describe('useHistoryNavState', () => {
  beforeEach(() => {
    api = null;
    seen = [];
    sessionStorage.clear();
    rotateHistoryGen();
  });

  it('restores query and scroll from a current-generation state', () => {
    renderAt({
      pathname: '/app/history',
      state: { q: 'paprika', scrollY: 420, gen: currentHistoryGen() },
    });
    expect(screen.getByTestId('q').textContent).toBe('paprika');
    expect(screen.getByTestId('scroll').textContent).toBe('420');
  });

  it('discards a state of an older generation and replaces it at once', async () => {
    const old = currentHistoryGen();
    rotateHistoryGen();
    renderAt({ pathname: '/app/history', state: { q: 'paprika', scrollY: 420, gen: old } });
    expect(screen.getByTestId('q').textContent).toBe('');
    expect(screen.getByTestId('scroll').textContent).toBe('null');
    await waitFor(() => expect(state()).toEqual({ gen: currentHistoryGen() }));
  });

  it('moves an inbound ?q= into state and strips it from the address', async () => {
    renderAt('/app/history?personaId=p1&q=paprika');
    expect(screen.getByTestId('q').textContent).toBe('paprika');
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?personaId=p1'));
    expect(state()).toEqual({ q: 'paprika', gen: currentHistoryGen() });
  });

  it('writes a typed query into state, debounced, never into the address', async () => {
    renderAt('/app/history?tab=bookmarks');
    act(() => api?.setQ('pap'));
    act(() => api?.setQ('paprika'));
    expect(screen.getByTestId('q').textContent).toBe('paprika');
    expect(state()).toBeNull();
    await waitFor(() => expect(state()).toEqual({ q: 'paprika', gen: currentHistoryGen() }));
    expect(screen.getByTestId('search').textContent).toBe('?tab=bookmarks');
    expect(seen.some((l) => l.search.includes('paprika'))).toBe(false);
    expect(seen.some((l) => JSON.stringify(l.state ?? null).includes('"q":"pap"'))).toBe(false);
  });

  it('puts the state back when another replace on the entry drops it', async () => {
    renderAt({ pathname: '/app/history', state: { q: 'paprika', gen: currentHistoryGen() } });
    fireEvent.click(screen.getByRole('button', { name: 'filter' }));
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?personaId=p9'));
    await waitFor(() => expect(state()).toEqual({ q: 'paprika', gen: currentHistoryGen() }));
  });

  it('saveScroll writes the offset and the latest query, and returns the location', async () => {
    renderAt('/app/history?tab=bookmarks');
    act(() => api?.setQ('paprika'));
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 });
    let saved: HistoryReturnLocation | undefined;
    act(() => {
      saved = api?.saveScroll();
    });
    const gen = currentHistoryGen();
    expect(saved).toEqual({
      pathname: '/app/history',
      search: '?tab=bookmarks',
      state: { q: 'paprika', scrollY: 640, gen },
    });
    await waitFor(() => expect(state()).toEqual({ q: 'paprika', scrollY: 640, gen }));
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });
});
