// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AttachmentRow } from '../../src/boot/client-data-db';
import { AttachmentStrip } from '../../src/components/chat/AttachmentStrip';

function row(over: Partial<AttachmentRow>): AttachmentRow {
  return {
    id: 'a',
    chatId: 'c',
    messageId: null,
    origin: 'upload',
    kind: 'image',
    fileName: 'a.png',
    mime: 'image/jpeg',
    order: 0,
    state: 'active',
    createdAt: 0,
    blob: new Blob(['x']),
    width: 1,
    height: 1,
    visionDescription: null,
    ...over,
  };
}

describe('AttachmentStrip', () => {
  it('renders one thumb per attachment with the filename, and no X button', () => {
    const { getAllByRole, getByText, queryByLabelText } = render(
      <AttachmentStrip
        attachments={[
          row({ id: '1', fileName: 'a.png' }),
          row({ id: '2', kind: 'text', fileName: 'n.md', blob: undefined, text: 'x' }),
        ]}
        onOpen={vi.fn()}
      />,
    );
    expect(getAllByRole('button')).toHaveLength(2);
    expect(getByText('a.png')).toBeTruthy();
    expect(getByText('n.md')).toBeTruthy();
    expect(queryByLabelText(/remove|close|×/i)).toBeNull(); // deliberate: no X on the thumb
  });

  it('calls onOpen with the clicked index', () => {
    const onOpen = vi.fn();
    const { getAllByRole } = render(
      <AttachmentStrip attachments={[row({ id: '1' }), row({ id: '2' })]} onOpen={onOpen} />,
    );
    const btn = getAllByRole('button')[1] as HTMLElement;
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it('renders nothing when empty', () => {
    const { container } = render(<AttachmentStrip attachments={[]} onOpen={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
