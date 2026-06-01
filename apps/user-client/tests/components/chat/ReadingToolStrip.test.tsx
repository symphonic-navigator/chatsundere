import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadingToolStrip } from '../../../src/components/chat/ReadingToolStrip.js';
import { useCurrentChatStore } from '../../../src/state/current-chat.store.js';

beforeEach(() => useCurrentChatStore.getState().reset());

describe('ReadingToolStrip', () => {
  it('collapsed: shows only the toggle, no actions', () => {
    render(<ReadingToolStrip onOpenToc={() => {}} />);
    expect(screen.getByRole('button', { name: /show tools/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /bookmarks/i })).toBeNull();
  });

  it('expands on toggle and reveals pin + bookmark', () => {
    render(<ReadingToolStrip onOpenToc={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /show tools/i }));
    expect(screen.getByRole('button', { name: /keep tools open/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /bookmarks/i })).toBeTruthy();
  });

  it('bookmark button calls onOpenToc', () => {
    const onOpenToc = vi.fn();
    render(<ReadingToolStrip onOpenToc={onOpenToc} />);
    fireEvent.click(screen.getByRole('button', { name: /show tools/i }));
    fireEvent.click(screen.getByRole('button', { name: /bookmarks/i }));
    expect(onOpenToc).toHaveBeenCalledOnce();
  });

  it('collapses on an outside pointerdown when unpinned', () => {
    render(<ReadingToolStrip onOpenToc={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /show tools/i }));
    fireEvent.pointerDown(document.body);
    expect(useCurrentChatStore.getState().isToolStripExpanded).toBe(false);
  });

  it('stays open on an outside pointerdown when pinned', () => {
    render(<ReadingToolStrip onOpenToc={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /show tools/i }));
    fireEvent.click(screen.getByRole('button', { name: /keep tools open/i })); // pin
    fireEvent.pointerDown(document.body);
    expect(useCurrentChatStore.getState().isToolStripExpanded).toBe(true);
  });
});
