// SPDX-License-Identifier: AGPL-3.0-only
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  BrowserRouter,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NavTrailTracker } from '../../src/components/NavTrailTracker.js';
import { useAppNav } from '../../src/lib/use-app-nav.js';
import { resetNavTrailForTests } from '../../src/state/nav-trail.store.js';

function Page({ name }: { name: string }) {
  const nav = useAppNav();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div>
      <p data-testid="where">{`${location.pathname}${location.search}`}</p>
      <p data-testid="trail">{nav.trail().join(' ')}</p>
      <p>{name}</p>
      <button type="button" onClick={() => nav.back('/fallback')}>
        back
      </button>
      <button type="button" onClick={() => nav.returnTo('/a')}>
        to a
      </button>
      <button type="button" onClick={() => nav.returnTo('/b?x=1')}>
        to b
      </button>
      <button type="button" onClick={() => nav.returnTo('/z')}>
        to z
      </button>
      <button type="button" onClick={() => navigate('/b')}>
        push b
      </button>
      <button type="button" onClick={() => navigate('/c')}>
        push c
      </button>
      <button
        type="button"
        onClick={() => {
          navigate('/b');
          navigate('/c');
        }}
      >
        push twice
      </button>
      <button type="button" onClick={() => navigate('/c2', { replace: true })}>
        replace c2
      </button>
    </div>
  );
}

function routes() {
  return (
    <>
      <NavTrailTracker />
      <Routes>
        {['/a', '/b', '/c', '/c2', '/z', '/fallback'].map((p) => (
          <Route key={p} path={p} element={<Page name={p} />} />
        ))}
      </Routes>
    </>
  );
}

const where = () => screen.getByTestId('where').textContent;
const trail = () => screen.getByTestId('trail').textContent;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => resetNavTrailForTests());
afterEach(cleanup);

describe('useAppNav in a router with history behind', () => {
  function walk() {
    render(<MemoryRouter initialEntries={['/a']}>{routes()}</MemoryRouter>);
    click('push b');
    click('push c');
  }

  it('records the trail of pushes and inherits it on replace', () => {
    walk();
    expect(trail()).toBe('/a /b');
    click('replace c2');
    expect(where()).toBe('/c2');
    expect(trail()).toBe('/a /b');
  });

  it('back pops one entry', () => {
    walk();
    click('back');
    expect(where()).toBe('/b');
    expect(trail()).toBe('/a');
  });

  it('returnTo unwinds to the nearest matching entry, one or more steps', () => {
    walk();
    click('to b');
    expect(where()).toBe('/b');
    click('push c');
    click('to a');
    expect(where()).toBe('/a');
    expect(trail()).toBe('');
  });

  it('returnTo replaces on a miss, keeping the trail', () => {
    walk();
    click('to z');
    expect(where()).toBe('/z');
    expect(trail()).toBe('/a /b');
    click('back');
    expect(where()).toBe('/b');
  });
});

describe('useAppNav with nothing behind', () => {
  it('back replaces with the fallback', () => {
    render(<MemoryRouter initialEntries={['/c']}>{routes()}</MemoryRouter>);
    click('back');
    expect(where()).toBe('/fallback');
    expect(trail()).toBe('');
  });
});

describe('the trail in window.history.state', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/a');
  });

  it('is mirrored into the entry’s state next to React Router’s own keys', () => {
    render(<BrowserRouter>{routes()}</BrowserRouter>);
    click('push b');
    click('push c');
    const state = window.history.state as { csTrail?: unknown; usr?: unknown; idx?: unknown };
    expect(state.csTrail).toEqual(['/a', '/b']);
    expect(state.idx).toBe(2);
  });

  it('survives a reload: a fresh tracker reads the stamp of the current entry', () => {
    const first = render(<BrowserRouter>{routes()}</BrowserRouter>);
    click('push b');
    click('push c');
    first.unmount();
    resetNavTrailForTests(); // the in-memory map is gone after a reload
    render(<BrowserRouter>{routes()}</BrowserRouter>);
    expect(where()).toBe('/c');
    expect(trail()).toBe('/a /b');
  });

  it('a system Back lands where back() would', async () => {
    render(<BrowserRouter>{routes()}</BrowserRouter>);
    click('push b');
    click('push c');
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(where()).toBe('/b');
    expect(trail()).toBe('/a');
  });

  it('one move fires once: a double tap of back steps back one page, not two', async () => {
    render(<BrowserRouter>{routes()}</BrowserRouter>);
    click('push b');
    click('push c');
    await act(async () => {
      click('back');
      click('back');
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(where()).toBe('/b');
  });
});

describe('a trail it cannot trust', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/a');
  });

  it('is dropped when an entry was skipped in one batch, so back goes up instead of astray', () => {
    render(<BrowserRouter>{routes()}</BrowserRouter>);
    click('push twice');
    expect(where()).toBe('/c');
    expect(trail()).toBe('');
  });
});
