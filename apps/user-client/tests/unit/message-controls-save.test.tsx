// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { MessageRow } from '../../src/boot/client-data-db.js';
import { MessageControls } from '../../src/components/chat/MessageControls.js';

function msg(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm1',
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [{ type: 'text', text: 'hi' }],
    createdAt: 1,
    bookmarked: false,
    streamingState: 'complete',
    ...over,
  };
}

test('Save is enabled and fires onSave when canSave', () => {
  const onSave = vi.fn();
  render(
    <MessageControls
      message={msg()}
      onCopy={vi.fn()}
      onBookmark={vi.fn()}
      onSave={onSave}
      canSave={true}
    />,
  );
  const btn = screen.getByRole('button', { name: /Save/ });
  expect(btn).not.toBeDisabled();
  fireEvent.click(btn);
  expect(onSave).toHaveBeenCalledOnce();
});

test('Save is disabled with a tooltip when not saveable', () => {
  render(
    <MessageControls
      message={msg({ contentBlocks: [{ type: 'pill', pillId: 'x' }] })}
      onCopy={vi.fn()}
      onBookmark={vi.fn()}
      onSave={vi.fn()}
      canSave={false}
    />,
  );
  const btn = screen.getByRole('button', { name: /Save/ });
  expect(btn).toBeDisabled();
  expect(btn.getAttribute('title')).toBe('No text to save');
});
