import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MessageRow } from '../../../src/boot/client-data-db.js';
import { TocSheet } from '../../../src/components/chat/TocSheet.js';

function wrap(ui: JSX.Element) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const messages: MessageRow[] = [
  {
    id: 'u1',
    chatId: 'c1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'hello there' }],
    createdAt: 1,
    bookmarked: false,
    streamingState: 'complete',
  },
  {
    id: 'p1',
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [{ type: 'text', text: 'persona reply' }],
    createdAt: 2,
    bookmarked: true,
    streamingState: 'complete',
  },
  {
    id: 'u2',
    chatId: 'c1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'second user' }],
    createdAt: 3,
    bookmarked: true,
    streamingState: 'complete',
  },
];

describe('TocSheet', () => {
  it('renders a pinned section and a full user-message timeline', () => {
    wrap(<TocSheet messages={messages} onClose={() => {}} onJump={() => {}} />);
    expect(screen.getByText('hello there')).toBeTruthy();
    expect(screen.getAllByText('second user').length).toBe(2);
    expect(screen.getByText('persona reply')).toBeTruthy();
  });

  it('jumps and closes when an entry is tapped', () => {
    const onJump = vi.fn();
    const onClose = vi.fn();
    wrap(<TocSheet messages={messages} onClose={onClose} onJump={onJump} />);
    fireEvent.click(screen.getByText('hello there'));
    expect(onJump).toHaveBeenCalledWith('u1');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on backdrop click', () => {
    const onClose = vi.fn();
    wrap(<TocSheet messages={messages} onClose={onClose} onJump={() => {}} />);
    fireEvent.click(screen.getByTestId('toc-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
