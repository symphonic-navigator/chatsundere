// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { TagEditor } from '../../src/components/artefact/TagEditor.js';

test('edit mode: adding a tag normalises and dedupes via onChange', () => {
  const onChange = vi.fn();
  render(<TagEditor mode="edit" value={['demo']} suggestions={[]} onChange={onChange} />);
  const input = screen.getByPlaceholderText('Add a tag…') as HTMLInputElement;
  fireEvent.change(input, { target: { value: ' PROD ' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith(['demo', 'prod']);
});

test('edit mode: adding an existing tag is a no-op (deduped)', () => {
  const onChange = vi.fn();
  render(<TagEditor mode="edit" value={['demo']} suggestions={[]} onChange={onChange} />);
  const input = screen.getByPlaceholderText('Add a tag…');
  fireEvent.change(input, { target: { value: 'Demo' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith(['demo']);
});

test('removing a chip calls onChange without it', () => {
  const onChange = vi.fn();
  render(<TagEditor mode="edit" value={['demo', 'prod']} suggestions={[]} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove tag demo' }));
  expect(onChange).toHaveBeenCalledWith(['prod']);
});

test('pick mode: shows suggestions not yet selected and toggles them on', () => {
  const onChange = vi.fn();
  render(
    <TagEditor mode="pick" value={['demo']} suggestions={['demo', 'prod']} onChange={onChange} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add tag prod' }));
  expect(onChange).toHaveBeenCalledWith(['demo', 'prod']);
});
