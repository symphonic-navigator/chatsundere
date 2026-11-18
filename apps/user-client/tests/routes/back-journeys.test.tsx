// SPDX-License-Identifier: AGPL-3.0-only
// Journeys of the "Back means one thing" spec, in a real BrowserRouter over
// jsdom's history: the stack after every step, and the system Back landing where
// the page bar's ‹ lands.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NavTrailTracker } from '../../src/components/NavTrailTracker.js';
import { PageScaffold } from '../../src/components/ui/PageScaffold.js';
import { useAppNav } from '../../src/lib/use-app-nav.js';
import { resetNavTrailForTests } from '../../src/state/nav-trail.store.js';

function Hall() {
  const navigate = useNavigate();
  return (
    <div>
      <h1>Hall</h1>
      <button type="button" onClick={() => navigate('/app/settings')}>
        open settings
      </button>
    </div>
  );
}

function Settings() {
  const navigate = useNavigate();
  return (
    <PageScaffold crumbs={[{ label: 'My Settings' }]} back="/app">
      <h1>Settings</h1>
      <button type="button" onClick={() => navigate('/app/settings/providers')}>
        open providers
      </button>
    </PageScaffold>
  );
}

function Providers() {
  const navigate = useNavigate();
  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'AI Providers' }]}
      back="/app/settings"
    >
      <h1>Providers</h1>
      <button type="button" onClick={() => navigate('/app/settings/providers/openrouter')}>
        open provider
      </button>
    </PageScaffold>
  );
}

function Provider({ dirty = false }: { dirty?: boolean }) {
  const nav = useAppNav();
  return (
    <PageScaffold
      crumbs={[
        { label: 'My Settings', to: '/app/settings' },
        { label: 'AI Providers', to: '/app/settings/providers' },
        { label: 'OpenRouter' },
      ]}
      back="/app/settings/providers"
      dirty={dirty}
    >
      <h1>Provider</h1>
      <button type="button" onClick={() => nav.back('/app/settings/providers')}>
        save
      </button>
    </PageScaffold>
  );
}

function App({ dirty = false }: { dirty?: boolean }) {
  return (
    <BrowserRouter>
      <NavTrailTracker />
      <Routes>
        <Route path="/app" element={<Hall />} />
        <Route path="/app/settings" element={<Settings />} />
        <Route path="/app/settings/providers" element={<Providers />} />
        <Route path="/app/settings/providers/:id" element={<Provider dirty={dirty} />} />
      </Routes>
    </BrowserRouter>
  );
}

const heading = () => screen.getByRole('heading').textContent;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
/** Click and let a history traversal (`navigate(-n)` is a `history.go`) land. */
async function tap(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await new Promise((r) => setTimeout(r, 20));
  });
}
const idx = () => (window.history.state as { idx: number }).idx;

async function systemBack() {
  await act(async () => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 20));
  });
}

beforeEach(() => {
  resetNavTrailForTests();
  window.history.replaceState(null, '', '/app');
});
afterEach(cleanup);

describe('J1 — Hall → Settings → AI Providers → a provider → Save', () => {
  function walkIn(dirty = false) {
    render(<App dirty={dirty} />);
    click('open settings');
    click('open providers');
    click('open provider');
    expect(heading()).toBe('Provider');
    expect(idx()).toBe(3);
  }

  it('Save and ‹ unwind the history instead of growing it', async () => {
    walkIn();
    await tap('save');
    expect(heading()).toBe('Providers');
    expect(idx()).toBe(2);
    await tap('Back');
    expect(heading()).toBe('Settings');
    await tap('Back');
    expect(heading()).toBe('Hall');
    expect(idx()).toBe(0);
  });

  it('the system Back walks the same pages as ‹', async () => {
    walkIn();
    await systemBack();
    expect(heading()).toBe('Providers');
    await systemBack();
    expect(heading()).toBe('Settings');
    await systemBack();
    expect(heading()).toBe('Hall');
  });

  it('a crumb unwinds to its page when it is behind', async () => {
    walkIn();
    await tap('My Settings');
    expect(heading()).toBe('Settings');
    expect(idx()).toBe(1);
    await tap('Back');
    expect(heading()).toBe('Hall');
  });

  it('the dirty guard’s Discard runs the same step back', async () => {
    walkIn(true);
    await tap('Back');
    await tap('Discard');
    expect(heading()).toBe('Providers');
    expect(idx()).toBe(2);
  });
});

describe('J6 — a cold start on a deep link', () => {
  it('‹ goes up one page at a time, replacing, and never leaves the app', async () => {
    window.history.replaceState(null, '', '/app/settings/providers/openrouter');
    render(<App />);
    expect(heading()).toBe('Provider');
    await tap('Back');
    expect(heading()).toBe('Providers');
    await tap('Back');
    expect(heading()).toBe('Settings');
    await tap('Back');
    expect(heading()).toBe('Hall');
    expect(idx()).toBe(0);
  });
});
