// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdultChatGuard } from '../../src/components/AdultChatGuard.js';
import { QK } from '../../src/data/queryKeys.js';
import { resetNavTrailForTests } from '../../src/state/nav-trail.store.js';
import { toastStore } from '../../src/state/toast.store.js';

function client(
  mode: 'nsfw' | 'sfw' | null,
  adult: boolean | null,
  { chatCached = true }: { chatCached?: boolean } = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  if (mode) qc.setQueryData(QK.settings, { adultMode: mode });
  if (chatCached) {
    qc.setQueryData(QK.chat('c1'), {
      chat: { id: 'c1', personaId: 'p1' },
      messages: [],
      pills: [],
    });
  }
  if (adult !== null) {
    qc.setQueryData(QK.personas, [
      { id: 'p1', adultPersona: adult },
      { id: 'p2', adultPersona: true },
    ]);
  }
  return qc;
}

function App({ qc, at = '/app/chat/c1' }: { qc: QueryClient; at?: string }) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/app" element={<h1>Hall</h1>} />
          <Route element={<AdultChatGuard />}>
            <Route path="/app/chat/:chatId" element={<h1>Chat content</h1>} />
            <Route path="/app/chat/:chatId/bookmarks" element={<h1>Bookmarks</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  resetNavTrailForTests();
  toastStore.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AdultChatGuard', () => {
  it('an ordinary chat in SFW mode is in the first render (no added blank frame)', () => {
    render(<App qc={client('sfw', false)} />);
    expect(screen.getByRole('heading').textContent).toBe('Chat content');
  });

  it('an adult chat in adult mode is in the first render', () => {
    render(<App qc={client('nsfw', true)} />);
    expect(screen.getByRole('heading').textContent).toBe('Chat content');
  });

  it('an adult chat in SFW mode is never painted: it resets to the Hall with the toast', async () => {
    const show = vi.spyOn(toastStore, 'show');
    render(<App qc={client('sfw', true)} />);
    expect(screen.queryByText('Chat content')).toBeNull();
    expect(await screen.findByText('Hall')).toBeInTheDocument();
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Adult mode') }),
    );
  });

  it('guards a chat’s sub-pages the same way', async () => {
    render(<App qc={client('sfw', true)} at="/app/chat/c1/bookmarks" />);
    expect(screen.queryByText('Bookmarks')).toBeNull();
    expect(await screen.findByText('Hall')).toBeInTheDocument();
  });

  it('without any adult persona, a chat not yet loaded is not held back', () => {
    const qc = client('sfw', null, { chatCached: false });
    qc.setQueryData(QK.personas, [{ id: 'p1', adultPersona: false }]);
    render(<App qc={qc} />);
    expect(screen.getByRole('heading').textContent).toBe('Chat content');
  });

  it('an ordinary chat not yet loaded is in the first render when the chat list knows it', () => {
    const qc = client('sfw', false, { chatCached: false });
    qc.setQueryData(QK.chats, [{ id: 'c1', personaId: 'p1' }]);
    render(<App qc={qc} />);
    expect(screen.getByRole('heading').textContent).toBe('Chat content');
  });

  it('shows the toast once, even when its effect runs twice', async () => {
    const show = vi.spyOn(toastStore, 'show');
    render(
      <StrictMode>
        <App qc={client('sfw', true)} />
      </StrictMode>,
    );
    expect(await screen.findByText('Hall')).toBeInTheDocument();
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('a chat it cannot read in SFW mode leads to the Hall instead of a blank page', async () => {
    const qc = client('sfw', null, { chatCached: false });
    qc.setQueryData(QK.personas, [{ id: 'p2', adultPersona: true }]);
    qc.setQueryDefaults(QK.chat('c1'), {
      queryFn: () => Promise.reject(new Error('read failed')),
    });
    render(<App qc={qc} />);
    expect(await screen.findByText('Hall')).toBeInTheDocument();
  });

  it('renders nothing while the persona is not yet known', () => {
    render(<App qc={client('sfw', null)} />);
    expect(screen.queryByText('Chat content')).toBeNull();
  });

  it('closes an open adult chat when the mode flips to SFW', async () => {
    const qc = client('nsfw', true);
    render(<App qc={qc} />);
    expect(screen.getByRole('heading').textContent).toBe('Chat content');
    act(() => qc.setQueryData(QK.settings, { adultMode: 'sfw' }));
    expect(await screen.findByText('Hall')).toBeInTheDocument();
  });
});
