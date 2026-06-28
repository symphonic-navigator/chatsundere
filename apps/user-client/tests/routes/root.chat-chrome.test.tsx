// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { Root, isExactChatRoute } from '../../src/routes/root.js';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';

// Root renders <Outlet/>, but with no nested <Routes> here it stays empty —
// so we can drive the header at any pathname via initialEntries without
// mounting the real (provider-heavy) page for that route.
function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Root />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Root brand-bar chrome trims inside a chat', () => {
  beforeEach(async () => {
    sessionStorage.setItem('splashShown', '1'); // suppress the splash so the logo is asserted directly
    useCurrentChatStore.getState().reset();
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    sessionStorage.clear();
    useCurrentChatStore.getState().reset();
    await _resetClientDataDbForTests();
  });

  it('reading-chat shows a small home logo and hides the connectivity badge', () => {
    renderAt('/app/chat/abc'); // interaction mode is false by default → reading
    expect(screen.getByText('Chatsundere')).toBeInTheDocument();
    expect(screen.getByText('Chatsundere').closest('.brand-logo')).toHaveClass('brand-logo-small');
    expect(screen.queryByText('✦')).toBeNull();
    expect(screen.queryByText(/local|linked|server/i)).toBeNull();
  });

  it('cockpit-open chat keeps the logo but still hides connectivity', () => {
    useCurrentChatStore.getState().setInteractionMode(true);
    renderAt('/app/chat/abc');
    expect(screen.getByText('Chatsundere')).toBeInTheDocument();
    expect(screen.queryByText(/local|linked|server/i)).toBeNull();
  });

  it('outside a chat, the logo and connectivity badge are present', () => {
    renderAt('/app');
    expect(screen.getByText('Chatsundere')).toBeInTheDocument();
    expect(screen.getByText(/local|linked|server/i)).toBeInTheDocument();
  });

  it('a chat cockpit sub-page falls back to full chrome (badge present)', () => {
    // Guards the exact-route narrowing: a startsWith('/app/chat') predicate
    // would wrongly trim the chrome here. The connectivity badge that the
    // chat chrome hides must be present on a cockpit sub-page.
    renderAt('/app/chat/abc123/bookmarks');
    expect(screen.getByText('Chatsundere')).toBeInTheDocument();
    expect(screen.getByText(/local|linked|server/i)).toBeInTheDocument();
  });

  it('the adult-mode pill is suppressed on the login screen', () => {
    renderAt('/login');
    expect(screen.queryByRole('button', { name: /adult mode/i })).toBeNull();
  });

  it('the adult-mode pill is shown on a non-login route', () => {
    renderAt('/app');
    expect(screen.getByRole('button', { name: /adult mode/i })).toBeInTheDocument();
  });
});

describe('Root read-only chat topbar (chatHeader set)', () => {
  beforeEach(async () => {
    sessionStorage.setItem('splashShown', '1');
    useCurrentChatStore.getState().reset();
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    sessionStorage.clear();
    useCurrentChatStore.getState().reset();
    await _resetClientDataDbForTests();
  });

  it('renders exit affordance with correct aria-label in reading-chat mode', () => {
    useCurrentChatStore.getState().setChatHeader({
      personaId: 'p1',
      name: 'Laura',
      colour: '#c44e8e',
      title: 'Evening at the harbour',
    });
    useCurrentChatStore.getState().setInteractionMode(false);
    renderAt('/app/chat/c1');
    expect(screen.getByLabelText('Leave chat')).toBeInTheDocument();
  });

  it('renders persona avatar button with correct aria-label in reading-chat mode', () => {
    useCurrentChatStore.getState().setChatHeader({
      personaId: 'p1',
      name: 'Laura',
      colour: '#c44e8e',
      title: 'Evening at the harbour',
    });
    useCurrentChatStore.getState().setInteractionMode(false);
    renderAt('/app/chat/c1');
    expect(screen.getByLabelText('Go to Laura')).toBeInTheDocument();
  });

  it('does not render persona avatar button outside reading-chat mode', () => {
    useCurrentChatStore.getState().setChatHeader({
      personaId: 'p1',
      name: 'Laura',
      colour: '#c44e8e',
      title: 'Evening at the harbour',
    });
    useCurrentChatStore.getState().setInteractionMode(true);
    renderAt('/app/chat/c1');
    expect(screen.queryByLabelText('Go to Laura')).toBeNull();
  });

  it('renders chat title in right cluster in reading-chat mode', () => {
    useCurrentChatStore.getState().setChatHeader({
      personaId: 'p1',
      name: 'Laura',
      colour: '#c44e8e',
      title: 'Evening at the harbour',
    });
    useCurrentChatStore.getState().setInteractionMode(false);
    renderAt('/app/chat/c1');
    expect(screen.getByText('Evening at the harbour')).toBeInTheDocument();
  });

  it('tapping the persona avatar navigates to the persona with the chat as ?return', () => {
    useCurrentChatStore.getState().setChatHeader({
      personaId: 'p1',
      name: 'Laura',
      colour: '#c44e8e',
      title: 'Evening at the harbour',
    });
    useCurrentChatStore.getState().setInteractionMode(false);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function LocationProbe(): JSX.Element {
      const loc = useLocation();
      return (
        <div data-testid="loc">
          {loc.pathname}
          {loc.search}
        </div>
      );
    }
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/app/chat/c1']}>
          <Root />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByLabelText('Go to Laura'));
    // The persona page's back control reads ?return, so this round-trips to the chat.
    expect(screen.getByTestId('loc').textContent).toBe(
      `/app/persona/p1?return=${encodeURIComponent('/app/chat/c1')}`,
    );
  });
});

describe('isExactChatRoute', () => {
  it('matches the chat itself', () => {
    expect(isExactChatRoute('/app/chat/abc123')).toBe(true);
    expect(isExactChatRoute('/app/chat/new')).toBe(true);
  });
  it('does not match cockpit sub-pages', () => {
    expect(isExactChatRoute('/app/chat/abc123/bookmarks')).toBe(false);
    expect(isExactChatRoute('/app/chat/abc123/artefacts')).toBe(false);
    expect(isExactChatRoute('/app/chat/abc123/knowledge')).toBe(false);
  });
  it('does not match other routes', () => {
    expect(isExactChatRoute('/app')).toBe(false);
    expect(isExactChatRoute('/app/treasury')).toBe(false);
  });
});
