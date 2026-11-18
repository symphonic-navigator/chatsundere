// SPDX-License-Identifier: AGPL-3.0-only
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavTrailTracker } from '../../src/components/NavTrailTracker.js';
import { RESET_TIMEOUT_MS, useAppNav } from '../../src/lib/use-app-nav.js';
import { resetNavTrailForTests, useNavResetStore } from '../../src/state/nav-trail.store.js';

function Page() {
  const nav = useAppNav();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <div>
      <p data-testid="where">{pathname}</p>
      <button type="button" onClick={() => navigate(`${pathname === '/' ? '' : pathname}/x`)}>
        deeper
      </button>
      <button type="button" onClick={() => nav.resetTo('/done')}>
        reset
      </button>
      <button type="button" onClick={() => nav.returnTo('/app')}>
        home
      </button>
      <button type="button" onClick={() => nav.back('/up')}>
        back
      </button>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <NavTrailTracker />
      <Routes>
        <Route path="*" element={<Page />} />
      </Routes>
    </BrowserRouter>
  );
}

const where = () => screen.getByTestId('where').textContent;
const idx = () => (window.history.state as { idx: number }).idx;
async function tap(name: string, wait = 30) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await new Promise((r) => setTimeout(r, wait));
  });
}

beforeEach(() => {
  resetNavTrailForTests();
  window.history.replaceState(null, '', '/a');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('resetTo', () => {
  it('unwinds to the first entry and replaces it with the target', async () => {
    render(<App />);
    await tap('deeper');
    await tap('deeper');
    expect(idx()).toBe(2);
    await tap('reset');
    expect(where()).toBe('/done');
    expect(idx()).toBe(0);
    expect(useNavResetStore.getState().resetting).toBe(false);
  });

  it('clears entries that carry no stamp (a tab open across the update)', async () => {
    render(<App />);
    await tap('deeper');
    await tap('deeper');
    // The entries were written by an older build: no trail anywhere.
    window.history.replaceState({ ...window.history.state, csTrail: undefined }, '');
    resetNavTrailForTests();
    cleanup();
    render(<App />);
    await tap('reset');
    expect(where()).toBe('/done');
    expect(idx()).toBe(0);
  });

  it('with nothing behind, just replaces', async () => {
    render(<App />);
    await tap('reset');
    expect(where()).toBe('/done');
    expect(idx()).toBe(0);
  });

  it('shows the curtain while the unwind runs', async () => {
    render(<App />);
    await tap('deeper');
    vi.spyOn(window.history, 'go').mockImplementation(() => {});
    await tap('reset', 0);
    expect(useNavResetStore.getState().resetting).toBe(true);
  });

  it('when the unwind never arrives, replaces the current entry after the bound and lifts the curtain', async () => {
    render(<App />);
    await tap('deeper');
    await tap('deeper');
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    await tap('reset', RESET_TIMEOUT_MS + 50);
    expect(go).toHaveBeenCalledWith(-2);
    expect(where()).toBe('/done');
    expect(idx()).toBe(2);
    expect(useNavResetStore.getState().resetting).toBe(false);
    // A late traversal is not answered with a second replace.
    go.mockRestore();
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(where()).toBe('/a/x');
  });
});

describe('returnTo the Hall', () => {
  it('on a miss resets, so Back from the Hall leaves the app', async () => {
    render(<App />);
    await tap('deeper');
    await tap('home');
    expect(where()).toBe('/app');
    expect(idx()).toBe(0);
  });
});

describe('a step back that never arrives', () => {
  it('falls back to the page above after the bound, so ‹ is never dead', async () => {
    render(<App />);
    await tap('deeper');
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    await tap('back', RESET_TIMEOUT_MS + 50);
    expect(go).toHaveBeenCalledWith(-1);
    expect(where()).toBe('/up');
    go.mockRestore();
    // And ‹ works again on the new page.
    await tap('deeper');
    await tap('back');
    expect(where()).toBe('/up');
  });
});

describe('a reset whose unwind arrives late', () => {
  it('still puts the target in place of the first entry', async () => {
    render(<App />);
    await tap('deeper');
    await tap('deeper');
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    await tap('reset', RESET_TIMEOUT_MS + 50);
    expect(where()).toBe('/done');
    go.mockRestore();
    await act(async () => {
      window.history.go(-2);
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(where()).toBe('/done');
    expect(idx()).toBe(0);
  });
});
