// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Lightbox } from '../../src/components/lightbox/Lightbox';
import type { ViewableItem } from '../../src/components/lightbox/viewable-item';

const caps = {
  rename: true,
  remove: true,
  copy: false,
  download: false,
  delete: false,
  editSource: false,
};
const img = (id: string, name: string): ViewableItem => ({
  id,
  kind: 'image',
  fileName: name,
  mime: 'image/jpeg',
  imageUrl: 'blob:1',
  caps,
});
const md = (id: string): ViewableItem => ({
  id,
  kind: 'text',
  fileName: 'n.md',
  mime: 'text/markdown',
  text: '# Hi',
  caps: { ...caps, copy: true, download: true, editSource: true },
});

function noop() {}
const handlers = { onRename: noop, onRemove: noop, onEditText: noop, onClose: noop };
const noopHandlers = handlers;

const textItem = (
  overrides: Partial<ViewableItem> & { text?: string; fileName?: string },
): ViewableItem => ({
  id: 'txt-1',
  kind: 'text',
  fileName: overrides.fileName ?? 'file.txt',
  mime: 'text/plain',
  text: overrides.text ?? '',
  caps: {
    rename: false,
    remove: false,
    copy: true,
    download: true,
    delete: false,
    editSource: false,
  },
  ...overrides,
});

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

  it('copies the raw content and flashes Copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const items = [textItem({ text: 'print(1)', fileName: 'a.py' })];
    render(<Lightbox items={items} index={0} {...noopHandlers} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('print(1)');
    vi.unstubAllGlobals();
  });

  it('overriding the format switches the rendered preview', () => {
    const items = [textItem({ text: '# H', fileName: 'note.txt' })]; // detects as plain
    render(<Lightbox items={items} index={0} {...noopHandlers} />);
    // The lightbox is a portal into document.body, so query there.
    expect(document.body.querySelector('.lightbox-plain')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /format/i }));
    fireEvent.click(screen.getByText('Markdown'));
    expect(document.body.querySelector('.lightbox-doc h1')?.textContent).toBe('H');
  });
});
