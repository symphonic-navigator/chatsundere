// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { BookmarksList } from '../../src/components/history/BookmarksList';
import type { BookmarkGroup } from '../../src/data/bookmarks';

const mockToggle = vi.fn();
const mockSetLabel = vi.fn(() => Promise.resolve());
vi.mock('../../src/data/chats', () => ({
  useToggleBookmark: () => ({ mutateAsync: mockToggle }),
}));
vi.mock('../../src/data/bookmarks', async (orig) => {
  const actual = await orig<typeof import('../../src/data/bookmarks')>();
  return { ...actual, useSetBookmarkLabel: () => ({ mutateAsync: mockSetLabel }) };
});

function makeGroup(): BookmarkGroup {
  return {
    chat: {
      id: 'c1',
      personaId: 'p1',
      title: 'Long talk',
      resolvedMindspaceId: 'm1',
      createdAt: 0,
      updatedAt: 0,
      lastMessageAt: 10,
      bookmarkedMessageCount: 1,
      draftInput: '',
      libraryIds: [],
    },
    persona: {
      id: 'p1',
      name: 'Aurum',
      colour: '#c9a84c',
      // biome-ignore lint/suspicious/noExplicitAny: test fixture only needs id/name/colour
    } as any,
    // biome-ignore lint/suspicious/noExplicitAny: test fixture only needs id
    bookmarks: [{ message: { id: 'm-1' } as any, label: 'a key line' }],
  };
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('BookmarksList', () => {
  it('renders a group header with the persona avatar and chat title', () => {
    render(wrap(<BookmarksList groups={[makeGroup()]} onJump={() => {}} />));
    expect(screen.getByLabelText('Aurum avatar')).toBeTruthy();
    expect(screen.getByText('Long talk')).toBeTruthy();
    expect(screen.getByText('a key line')).toBeTruthy();
  });

  it('jumps to the message when an entry is tapped', () => {
    const onJump = vi.fn();
    render(wrap(<BookmarksList groups={[makeGroup()]} onJump={onJump} />));
    fireEvent.click(screen.getByText('a key line'));
    expect(onJump).toHaveBeenCalledWith('c1', 'm-1');
  });

  it('removes the bookmark when the visible star is tapped', () => {
    render(wrap(<BookmarksList groups={[makeGroup()]} onJump={() => {}} />));
    fireEvent.click(screen.getByLabelText('Remove bookmark'));
    expect(mockToggle).toHaveBeenCalledWith('m-1');
  });

  it('renames inline from the overflow menu', () => {
    render(wrap(<BookmarksList groups={[makeGroup()]} onJump={() => {}} />));
    fireEvent.click(screen.getByLabelText('Bookmark actions'));
    fireEvent.click(screen.getByText('Rename'));
    expect(screen.getByDisplayValue('a key line')).toBeTruthy();
  });

  it('commits the new label on Enter', () => {
    render(wrap(<BookmarksList groups={[makeGroup()]} onJump={() => {}} />));
    fireEvent.click(screen.getByLabelText('Bookmark actions'));
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByDisplayValue('a key line');
    fireEvent.change(input, { target: { value: 'renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockSetLabel).toHaveBeenCalledWith({ messageId: 'm-1', label: 'renamed' });
  });
});
