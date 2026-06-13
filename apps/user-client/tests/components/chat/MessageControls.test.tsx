// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../../../src/boot/client-data-db.js';
import { MessageControls } from '../../../src/components/chat/MessageControls.js';

const msg: MessageRow = {
  id: 'm1',
  chatId: 'c1',
  role: 'persona',
  contentBlocks: [{ type: 'text', text: 'hi' }],
  createdAt: 1,
  bookmarked: false,
  streamingState: 'complete',
};

const baseProps = {
  message: msg,
  onCopy: () => {},
  onBookmark: () => {},
};

describe('manual read button disabled reason (touch)', () => {
  it('reveals the reason inline on tap when disabled (no-voice)', () => {
    const { queryByText, getByText } = render(
      <MessageControls {...baseProps} onReadAloud={() => {}} readDisabledReason="no-voice" />,
    );
    expect(queryByText(/voice/i)).toBeNull();
    fireEvent.click(getByText(/▸ Read/i));
    expect(getByText(/voice/i)).toBeTruthy();
  });

  it('reveals the reason inline on tap when disabled (no-provider)', () => {
    const { queryByText, getByText } = render(
      <MessageControls {...baseProps} onReadAloud={() => {}} readDisabledReason="no-provider" />,
    );
    expect(queryByText(/provider/i)).toBeNull();
    fireEvent.click(getByText(/▸ Read/i));
    expect(getByText(/provider/i)).toBeTruthy();
  });

  it('reveals the reason inline on tap when disabled (nothing)', () => {
    const { queryByText, getByText } = render(
      <MessageControls {...baseProps} onReadAloud={() => {}} readDisabledReason="nothing" />,
    );
    expect(queryByText(/nothing to read/i)).toBeNull();
    fireEvent.click(getByText(/▸ Read/i));
    expect(getByText(/nothing to read/i)).toBeTruthy();
  });

  it('calls onReadAloud and reveals no inline note when not disabled', () => {
    let called = false;
    const { queryByRole } = render(
      <MessageControls
        {...baseProps}
        onReadAloud={() => {
          called = true;
        }}
        readDisabledReason={null}
      />,
    );
    fireEvent.click(screen.getByText(/▸ Read/i));
    expect(called).toBe(true);
    // no inline note rendered
    expect(queryByRole('status')).toBeNull();
  });

  it('hides the inline note after the reason clears (e.g. provider set up)', () => {
    const { rerender, queryByRole } = render(
      <MessageControls {...baseProps} onReadAloud={() => {}} readDisabledReason="no-provider" />,
    );
    // tap to reveal
    fireEvent.click(screen.getByText(/▸ Read/i));
    // now parent clears the reason — note should disappear
    rerender(<MessageControls {...baseProps} onReadAloud={() => {}} readDisabledReason={null} />);
    expect(queryByRole('status')).toBeNull();
  });
});
