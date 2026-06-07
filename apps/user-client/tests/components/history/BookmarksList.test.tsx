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

  it('exposes rename and remove affordances per bookmark', () => {
    wrap(<BookmarksList groups={groups} onJump={() => {}} />);
    expect(screen.getByRole('button', { name: /rename bookmark/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /remove bookmark/i })).toBeTruthy();
  });

  it('opens an inline rename field when the rename affordance is tapped', () => {
    wrap(<BookmarksList groups={groups} onJump={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /rename bookmark/i }));
    const input = screen.getByDisplayValue('starred q');
    expect(input).toBeTruthy();
  });

  it('renders a constructive empty state for no bookmarks', () => {
    wrap(<BookmarksList groups={[]} onJump={() => {}} />);
    expect(screen.getByText(/star a message/i)).toBeTruthy();
  });
});
