// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MessageRow } from '../../../src/boot/client-data-db.js';
import { MessageControls } from '../../../src/components/chat/MessageControls.js';

const userMsg: MessageRow = {
  id: 'u1',
  chatId: 'c1',
  role: 'user',
  contentBlocks: [{ type: 'text', text: 'hi' }],
  createdAt: 1,
  updatedAt: 1,
  bookmarked: false,
  streamingState: 'complete',
};
const base = { message: userMsg, onCopy: () => {}, onBookmark: () => {} };

describe('MessageControls — edit affordance (user messages)', () => {
  it('renders an Edit button that fires onEdit', () => {
    const onEdit = vi.fn();
    render(<MessageControls {...base} onEdit={onEdit} />);
    fireEvent.click(screen.getByText(/✎ Edit/));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('disables Edit with the live-stream tooltip', () => {
    render(<MessageControls {...base} onEdit={() => {}} editDisabled />);
    const btn = screen.getByText(/✎ Edit/).closest('button');
    expect(btn?.disabled).toBe(true);
    expect(btn?.getAttribute('title')).toMatch(/paused while replying/i);
  });

  it('moves Save into the overflow on a user message (not on the flat row)', () => {
    render(<MessageControls {...base} onEdit={() => {}} onSave={() => {}} canSave />);
    // No flat Save button.
    expect(screen.queryByText(/◆ Save/)).toBeNull();
    // It lives behind the ⋯ trigger.
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    expect(screen.getByText(/Save as artefact/i)).toBeTruthy();
  });

  it('Branch no longer uses the pencil glyph', () => {
    render(<MessageControls {...base} onBranch={() => {}} />);
    expect(screen.getByText(/⎇ Branch/)).toBeTruthy();
    expect(screen.queryByText(/✎ Branch/)).toBeNull();
  });
});
