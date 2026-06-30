// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

describe('Save as template (in the overflow, not the flat row)', () => {
  it('keeps "Save as template" out of the flat control row, behind the ⋯', () => {
    render(<MessageControls {...baseProps} onSaveAsTemplate={() => {}} />);
    // Not rendered inline until the overflow is opened.
    expect(screen.queryByText(/save as template/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    expect(screen.getByText(/save as template/i)).toBeTruthy();
  });

  it('invokes onSaveAsTemplate when the overflow item is chosen', () => {
    const onSaveAsTemplate = vi.fn();
    render(<MessageControls {...baseProps} onSaveAsTemplate={onSaveAsTemplate} />);
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(screen.getByText(/save as template/i));
    expect(onSaveAsTemplate).toHaveBeenCalledTimes(1);
  });

  it('renders no overflow when onSaveAsTemplate is absent', () => {
    render(<MessageControls {...baseProps} />);
    expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
  });

  it('renders no overflow on a user message', () => {
    render(
      <MessageControls
        {...baseProps}
        message={{ ...msg, role: 'user' }}
        onSaveAsTemplate={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
  });
});
