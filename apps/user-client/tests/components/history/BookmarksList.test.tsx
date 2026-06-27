import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BookmarksList } from '../../../src/components/history/BookmarksList.js';
import type { BookmarkGroup } from '../../../src/data/bookmarks.js';

function wrap(ui: JSX.Element) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const groups: BookmarkGroup[] = [
  {
    chat: {
      id: 'c1',
      personaId: 'p1',
      title: 'My chat',
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 9,
      bookmarkedMessageCount: 1,
      draftInput: '',
      libraryIds: [],
    },
    persona: null,
    bookmarks: [
      {
        message: {
          id: 'u2',
          chatId: 'c1',
          role: 'user',
          contentBlocks: [{ type: 'text', text: 'starred q' }],
          createdAt: 2,
          bookmarked: true,
          streamingState: 'complete',
        },
        label: 'starred q',
      },
    ],
  },
];

describe('BookmarksList', () => {
  it('groups by chat with a chat-title header and the bookmark label', () => {
    wrap(<BookmarksList groups={groups} onJump={() => {}} />);
    expect(screen.getByText('My chat')).toBeTruthy();
    expect(screen.getByText('starred q')).toBeTruthy();
  });

  it('calls onJump with chatId + messageId when a bookmark is tapped', () => {
    const onJump = vi.fn();
    wrap(<BookmarksList groups={groups} onJump={onJump} />);
    fireEvent.click(screen.getByText('starred q'));
    expect(onJump).toHaveBeenCalledWith('c1', 'u2');
  });

  it('keeps the remove-star visible and houses rename in the overflow menu', () => {
    wrap(<BookmarksList groups={groups} onJump={() => {}} />);
    // The remove affordance (the star) stays visible; rename lives in the ⋯ menu.
    expect(screen.getByRole('button', { name: /remove bookmark/i })).toBeTruthy();
    const menu = screen.getByRole('button', { name: /bookmark actions/i });
    expect(menu).toBeTruthy();
    fireEvent.click(menu);
    expect(screen.getByText('Rename')).toBeTruthy();
  });

  it('opens an inline rename field when Rename is chosen from the overflow menu', () => {
    wrap(<BookmarksList groups={groups} onJump={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /bookmark actions/i }));
    fireEvent.click(screen.getByText('Rename'));
    expect(screen.getByDisplayValue('starred q')).toBeTruthy();
  });

  // The empty state is owned by the My History route (it distinguishes
  // "no bookmarks yet" from "no bookmarks match your filter"), so the list
  // component assumes a non-empty `groups` and renders no empty state of its own.
});
