// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageRow } from '../../src/boot/client-data-db.js';

// Module mocks must be hoisted before any component import.
vi.mock('../../src/data/chats.js', () => ({
  useChat: vi.fn(),
  useToggleBookmark: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock('../../src/data/bookmarks.js', () => ({
  useSetBookmarkLabel: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

import { useChat } from '../../src/data/chats.js';
import { BookmarksPage } from '../../src/routes/app/chat/bookmarks-page.js';

/** Renders the current router location so tests can assert navigation happened. */
function LocationProbe() {
  const loc = useLocation();
  return (
    <div data-testid="location-probe">
      {loc.pathname}
      {loc.search}
    </div>
  );
}

// Two user messages: one plain, one starred.
const msgPlain: MessageRow = {
  id: 'msg-plain',
  chatId: 'c1',
  role: 'user',
  contentBlocks: [{ type: 'text', text: 'What is the capital of France?' }],
  createdAt: 1000,
  bookmarked: false,
  streamingState: 'complete',
};

const msgStarred: MessageRow = {
  id: 'msg-starred',
  chatId: 'c1',
  role: 'user',
  contentBlocks: [{ type: 'text', text: 'Tell me about the Eiffel Tower' }],
  createdAt: 2000,
  bookmarked: true,
  streamingState: 'complete',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/app/chat/c1/bookmarks']}>
      <Routes>
        <Route path="/app/chat/:chatId/bookmarks" element={<BookmarksPage />} />
        {/* Catch-all prevents "no routes matched" console warnings after navigation. */}
        <Route path="*" element={null} />
      </Routes>
      {/* Always rendered — reflects location after navigation away from the bookmarks route. */}
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('BookmarksPage', () => {
  beforeEach(() => {
    vi.mocked(useChat).mockReturnValue({
      data: {
        chat: { id: 'c1' } as never,
        messages: [msgPlain, msgStarred],
        pills: [],
      },
    } as unknown as ReturnType<typeof useChat>);
  });

  it('renders the Bookmarks crumb', () => {
    renderPage();
    // "Bookmarks" now appears as both the crumb and the page H1.
    expect(screen.getAllByText('Bookmarks').length).toBeGreaterThan(0);
  });

  it('shows the Pinned section when starred messages are present', () => {
    renderPage();
    expect(screen.getByText('Pinned')).toBeInTheDocument();
  });

  it('renders user messages as timeline entries', () => {
    renderPage();
    // The plain message appears only in the timeline section.
    expect(
      screen.getByRole('button', { name: 'What is the capital of France?' }),
    ).toBeInTheDocument();
  });

  it('navigates to focus URL when a timeline entry label is clicked', async () => {
    renderPage();
    const label = screen.getByRole('button', { name: 'What is the capital of France?' });
    fireEvent.click(label);
    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent(
        '/app/chat/c1?focus=msg-plain',
      );
    });
  });
});
