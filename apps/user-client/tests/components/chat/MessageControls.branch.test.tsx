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

describe('MessageControls branch button', () => {
  it('calls onBranch when enabled', () => {
    const onBranch = vi.fn();
    render(
      <MessageControls message={msg} onCopy={() => {}} onBookmark={() => {}} onBranch={onBranch} />,
    );
    const btn = screen.getByRole('button', { name: /Branch/ });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onBranch).toHaveBeenCalledTimes(1);
  });

  it('is disabled while a stream is live', () => {
    const onBranch = vi.fn();
    render(
      <MessageControls
        message={msg}
        onCopy={() => {}}
        onBookmark={() => {}}
        onBranch={onBranch}
        branchDisabled
      />,
    );
    const btn = screen.getByRole('button', { name: /Branch/ });
    expect(btn).toBeDisabled();
  });
});
