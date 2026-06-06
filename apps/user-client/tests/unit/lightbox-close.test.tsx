// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Lightbox } from '../../src/components/lightbox/Lightbox';
import type { ViewableItem } from '../../src/components/lightbox/viewable-item';

const img: ViewableItem = {
  id: 'a',
  kind: 'image',
  fileName: 'p.jpg',
  mime: 'image/jpeg',
  imageUrl: 'blob:x',
  caps: {
    rename: true,
    remove: false,
    copy: false,
    download: false,
    delete: false,
    editSource: false,
  },
};
const handlers = { onRename: () => {}, onRemove: () => {}, onEditText: () => {} };

describe('Lightbox close', () => {
  it('closes (calls onClose) on the × button', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Lightbox items={[img]} index={0} {...handlers} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    vi.runAllTimers();
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });
  it('consults getOriginRect for the current item on close', () => {
    vi.useFakeTimers();
    const getOriginRect = vi.fn().mockReturnValue(null);
    const onClose = vi.fn();
    render(
      <Lightbox
        items={[img]}
        index={0}
        getOriginRect={getOriginRect}
        {...handlers}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    vi.runAllTimers();
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
