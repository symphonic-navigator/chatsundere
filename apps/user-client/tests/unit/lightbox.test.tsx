// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Lightbox } from '../../src/components/lightbox/Lightbox';
import type { ViewableItem } from '../../src/components/lightbox/viewable-item';

const caps = { rename: true, remove: true, download: false, delete: false, editSource: false };
const img = (id: string, name: string): ViewableItem => ({
  id,
  kind: 'image',
  fileName: name,
  imageUrl: 'blob:1',
  caps,
});
const md = (id: string): ViewableItem => ({
  id,
  kind: 'markdown',
  fileName: 'n.md',
  text: '# Hi',
  caps: { ...caps, editSource: true },
});

function noop() {}
const handlers = { onRename: noop, onRemove: noop, onEditText: noop, onClose: noop };

describe('Lightbox', () => {
  it('shows the current item filename and a n / total counter', () => {
    const { getByText } = render(
      <Lightbox items={[img('1', 'a.png'), img('2', 'b.png')]} index={0} {...handlers} />,
    );
    expect(getByText('a.png')).toBeTruthy();
    expect(getByText('1 / 2')).toBeTruthy();
  });

  it('loops navigation with the next chevron', () => {
    const { getByText, getByLabelText } = render(
      <Lightbox items={[img('1', 'a.png'), img('2', 'b.png')]} index={1} {...handlers} />,
    );
    fireEvent.click(getByLabelText('Next'));
    expect(getByText('a.png')).toBeTruthy(); // wrapped around
  });

  it('renders Remove only when caps.remove and calls onRemove', () => {
    const onRemove = vi.fn();
    const { getByText } = render(
      <Lightbox items={[img('1', 'a.png')]} index={0} {...handlers} onRemove={onRemove} />,
    );
    fireEvent.click(getByText('Remove'));
    expect(onRemove).toHaveBeenCalledWith('1');
  });

  it('toggles Preview/Source for markdown and persists an edit', () => {
    const onEditText = vi.fn();
    const { getByText, getByRole } = render(
      <Lightbox items={[md('1')]} index={0} {...handlers} onEditText={onEditText} />,
    );
    fireEvent.click(getByText('Source'));
    const ta = getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '# Edited' } });
    fireEvent.blur(ta);
    expect(onEditText).toHaveBeenCalledWith('1', '# Edited');
  });

  it('does not render Download/Delete for an upload item', () => {
    const { queryByText } = render(
      <Lightbox items={[img('1', 'a.png')]} index={0} {...handlers} />,
    );
    expect(queryByText('Download')).toBeNull();
    expect(queryByText('Delete')).toBeNull();
  });
});
