// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { Root } from '../../src/routes/root.js';
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

  it('reading-chat hides both the logo and the connectivity badge', () => {
    renderAt('/app/chat/abc'); // interaction mode is false by default → reading
    expect(screen.queryByText('Chatsundere')).toBeNull();
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

  it('the adult-mode pill is suppressed on the login screen', () => {
    renderAt('/login');
    expect(screen.queryByRole('button', { name: /adult mode/i })).toBeNull();
  });

  it('the adult-mode pill is shown on a non-login route', () => {
    renderAt('/app');
    expect(screen.getByRole('button', { name: /adult mode/i })).toBeInTheDocument();
  });
});
