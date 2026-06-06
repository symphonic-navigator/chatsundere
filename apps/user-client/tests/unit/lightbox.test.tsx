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

  it('toggles Preview/Source for markdown and persists an edit via Save', () => {
    const onEditText = vi.fn();
    const { getByText, getByRole } = render(
      <Lightbox items={[md('1')]} index={0} {...handlers} onEditText={onEditText} />,
    );
    fireEvent.click(getByText('Source'));
    const ta = getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '# Edited' } });
    fireEvent.click(getByRole('button', { name: 'Save' }));
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

describe('Lightbox editing (Save / Undo / dirty-confirm)', () => {
  function openSourceAndEdit(next: string): HTMLTextAreaElement {
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: next } });
    return ta;
  }

  it('Save is disabled until dirty, then persists the draft and clears dirty', () => {
    const onEditText = vi.fn();
    render(<Lightbox items={[md('e1')]} index={0} {...handlers} onEditText={onEditText} />);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    openSourceAndEdit('# Hi there');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEditText).toHaveBeenCalledWith('e1', '# Hi there');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Undo reverts the draft to the last saved value', () => {
    render(<Lightbox items={[md('e1')]} index={0} {...handlers} />);
    const ta = openSourceAndEdit('changed');
    expect(ta.value).toBe('changed');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# Hi');
  });

  it('closing while dirty shows the confirm bar instead of closing; Cancel keeps it open', () => {
    const onClose = vi.fn();
    render(<Lightbox items={[md('e1')]} index={0} {...handlers} onClose={onClose} />);
    openSourceAndEdit('edited');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('confirm → Discard proceeds with the close', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Lightbox items={[md('e1')]} index={0} {...handlers} onClose={onClose} />);
    openSourceAndEdit('edited');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    vi.advanceTimersByTime(300);
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('confirm → Save persists the edit before proceeding', () => {
    vi.useFakeTimers();
    const onEditText = vi.fn();
    render(<Lightbox items={[md('e1')]} index={0} {...handlers} onEditText={onEditText} />);
    openSourceAndEdit('edited');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    // Two "Save" buttons now exist (toolbar + confirm bar); the confirm one is last.
    const saves = screen.getAllByRole('button', { name: 'Save' });
    fireEvent.click(saves[saves.length - 1] as HTMLButtonElement);
    expect(onEditText).toHaveBeenCalledWith('e1', 'edited');
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
  });
});
