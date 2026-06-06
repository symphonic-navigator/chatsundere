// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Lightbox } from '../../src/components/lightbox/Lightbox.js';
import type { ViewableItem } from '../../src/components/lightbox/viewable-item.js';

const item: ViewableItem = {
  id: 'a1',
  kind: 'text',
  fileName: 'calc.html',
  title: 'Calc',
  mime: 'text/html',
  text: '<x>',
  caps: { rename: true, remove: false, copy: true, download: true, delete: true, editSource: true },
};

test('renders a delete control and fires onDelete', () => {
  const onDelete = vi.fn();
  render(
    <Lightbox
      items={[item]}
      index={0}
      onRename={vi.fn()}
      onRemove={vi.fn()}
      onEditText={vi.fn()}
      onDelete={onDelete}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /delete/i }));
  expect(onDelete).toHaveBeenCalledWith('a1');
});

test('renames title and fileName independently via onRename patch', () => {
  const onRename = vi.fn();
  render(
    <Lightbox
      items={[item]}
      index={0}
      onRename={onRename}
      onRemove={vi.fn()}
      onEditText={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  // title shown when present; clicking it opens the title editor
  fireEvent.click(screen.getByRole('button', { name: /rename title/i }));
  const input = screen.getByDisplayValue('Calc');
  fireEvent.change(input, { target: { value: 'New' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onRename).toHaveBeenCalledWith('a1', { title: 'New' });
});
