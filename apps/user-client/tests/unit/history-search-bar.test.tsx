// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HistorySearchBar } from '../../src/components/history/HistorySearchBar';

describe('HistorySearchBar', () => {
  it('renders an input with the placeholder copy', () => {
    const { container } = render(<HistorySearchBar value="" onChange={vi.fn()} />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.placeholder).toBe('Search chats by title…');
  });
  it('reflects the controlled value', () => {
    const { container } = render(<HistorySearchBar value="abc" onChange={vi.fn()} />);
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('abc');
  });
  it('calls onChange with the new value on typing', () => {
    const onChange = vi.fn();
    const { container } = render(<HistorySearchBar value="" onChange={onChange} />);
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: 'xy' },
    });
    expect(onChange).toHaveBeenCalledWith('xy');
  });
});
