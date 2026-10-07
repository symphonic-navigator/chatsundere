// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRow } from '../../../src/boot/client-data-db.js';
import {
  RECENT_CHATS_OPEN_KEY,
  RecentChatsAccordion,
} from '../../../src/components/persona-hub/RecentChatsAccordion.js';

function chat(n: number, personaId = 'p1', title: string | null = `Chat ${n}`): ChatRow {
  return {
    id: `c${n}`,
    personaId,
    title,
    resolvedMindspaceId: 'ms',
    createdAt: n,
    updatedAt: n,
    lastMessageAt: 1000 + n,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  } as ChatRow;
}

// useChats() returns chats ordered newest first; mirror that.
const fifteen = Array.from({ length: 15 }, (_, i) => chat(i + 1)).reverse();

function Probe(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function renderAcc(chats: ChatRow[] | undefined, returnTo = '/app/persona/p1') {
  return render(
    <MemoryRouter initialEntries={['/app/persona/p1']}>
      <Routes>
        <Route
          path="/app/persona/:id"
          element={<RecentChatsAccordion personaId="p1" chats={chats} returnTo={returnTo} />}
        />
        <Route path="/app/chat/:chatId" element={<div data-testid="chat-sentinel" />} />
        <Route path="/app/history" element={<div data-testid="history-sentinel" />} />
      </Routes>
      <Probe />
    </MemoryRouter>,
  );
}

const toggle = () => screen.getByRole('button', { name: /recent chats/i });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('RecentChatsAccordion', () => {
  it('is collapsed by default with a History link and no list', () => {
    renderAcc(fifteen);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('link', { name: 'History →' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /chat 15/i })).toBeNull();
  });

  it('expanding persists "1"; a remount reads it back; collapsing writes "0"', () => {
    const { unmount } = renderAcc(fifteen);
    fireEvent.click(toggle());
    expect(localStorage.getItem(RECENT_CHATS_OPEN_KEY)).toBe('1');
    unmount();
    renderAcc(fifteen);
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle());
    expect(localStorage.getItem(RECENT_CHATS_OPEN_KEY)).toBe('0');
  });

  it('still toggles when storage throws', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    renderAcc(fifteen);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('expanded: the 10 newest chats, newest first, and All in History', () => {
    localStorage.setItem(RECENT_CHATS_OPEN_KEY, '1');
    renderAcc(fifteen);
    const list = screen.getByRole('list', { name: 'Recent chats' });
    const rows = within(list).getAllByRole('link');
    expect(rows).toHaveLength(10);
    expect(rows[0]?.textContent).toContain('Chat 15');
    expect(rows[9]?.textContent).toContain('Chat 6');
    expect(screen.getByRole('link', { name: 'All in History →' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'History →' })).toBeNull();
  });

  it('ignores chats of other personas', () => {
    localStorage.setItem(RECENT_CHATS_OPEN_KEY, '1');
    renderAcc([chat(99, 'p2', 'Foreign chat'), chat(1)]);
    expect(screen.queryByText('Foreign chat')).toBeNull();
    expect(screen.getByText('Chat 1')).toBeInTheDocument();
  });

  it('the filter searches all chats, case-insensitively', () => {
    localStorage.setItem(RECENT_CHATS_OPEN_KEY, '1');
    const chats = [...fifteen];
    // Chat 2 is outside the newest ten; give it a distinctive title.
    const idx = chats.findIndex((c) => c.id === 'c2');
    chats[idx] = { ...chat(2), title: 'Bach evening' } as ChatRow;
    renderAcc(chats);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter chats' }), {
      target: { value: 'BACH' },
    });
    const rows = within(screen.getByRole('list', { name: 'Recent chats' })).getAllByRole('link');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('Bach evening');
  });

  it('no matches: an empty line, and All in History stays', () => {
    localStorage.setItem(RECENT_CHATS_OPEN_KEY, '1');
    renderAcc(fifteen);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter chats' }), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('No chats match "zzz"')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All in History →' })).toBeInTheDocument();
  });

  it('zero chats (loaded): disabled toggle and a visible No chats yet', () => {
    renderAcc([]);
    expect(toggle()).toBeDisabled();
    expect(screen.getByText('No chats yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'History →' })).toBeNull();
  });

  it('chats loading (undefined): never shows the disabled state', () => {
    renderAcc(undefined);
    expect(toggle()).not.toBeDisabled();
    expect(screen.queryByText('No chats yet')).toBeNull();
    expect(screen.getByRole('link', { name: 'History →' })).toBeInTheDocument();
  });

  it('History link carries personaId and return, but no q when the filter is empty', () => {
    renderAcc(fifteen, '/app/persona/p1?return=%2Fapp%2Fchat%2Fc9');
    fireEvent.click(screen.getByRole('link', { name: 'History →' }));
    const loc = screen.getByTestId('location').textContent ?? '';
    const params = new URLSearchParams(loc.split('?')[1]);
    expect(loc.startsWith('/app/history?')).toBe(true);
    expect(params.get('personaId')).toBe('p1');
    expect(params.get('q')).toBeNull();
    expect(params.get('return')).toBe('/app/persona/p1?return=%2Fapp%2Fchat%2Fc9');
  });

  it('All in History carries the trimmed filter as q', () => {
    localStorage.setItem(RECENT_CHATS_OPEN_KEY, '1');
    renderAcc(fifteen);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter chats' }), {
      target: { value: '  chat 1 ' },
    });
    fireEvent.click(screen.getByRole('link', { name: 'All in History →' }));
    const params = new URLSearchParams(
      (screen.getByTestId('location').textContent ?? '').split('?')[1],
    );
    expect(params.get('q')).toBe('chat 1');
  });

  it('a row opens its chat', () => {
    localStorage.setItem(RECENT_CHATS_OPEN_KEY, '1');
    renderAcc(fifteen);
    fireEvent.click(screen.getByRole('link', { name: /chat 15/i }));
    expect(screen.getByTestId('chat-sentinel')).toBeInTheDocument();
  });

  it('collapsing clears the filter', () => {
    localStorage.setItem(RECENT_CHATS_OPEN_KEY, '1');
    renderAcc(fifteen);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter chats' }), {
      target: { value: 'zzz' },
    });
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(
      (screen.getByRole('searchbox', { name: 'Filter chats' }) as HTMLInputElement).value,
    ).toBe('');
  });
});
