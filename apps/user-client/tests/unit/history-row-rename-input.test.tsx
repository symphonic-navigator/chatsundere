// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryRowRenameInput } from '../../src/components/history/HistoryRowRenameInput';

describe('HistoryRowRenameInput', () => {
  it('renders an autofocused input with maxLength=60 pre-filled with initialValue', () => {
    const { container } = render(
      <HistoryRowRenameInput initialValue="seed" onCommit={vi.fn()} onCancel={vi.fn()} />,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('seed');
    expect(input.getAttribute('maxlength')).toBe('60');
  });

  it('Enter calls onCommit with sanitised value', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <HistoryRowRenameInput initialValue="" onCommit={onCommit} onCancel={vi.fn()} />,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  trim me  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('trim me');
  });

  it('empty / whitespace-only commits null', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <HistoryRowRenameInput initialValue="existing" onCommit={onCommit} onCancel={vi.fn()} />,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it('Escape calls onCancel and does NOT call onCommit', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <HistoryRowRenameInput initialValue="" onCommit={onCommit} onCancel={onCancel} />,
    );
    const input = container.querySelector('input');
    if (!input) throw new Error('input element not found');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('Blur calls onCommit with the current value', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <HistoryRowRenameInput initialValue="" onCommit={onCommit} onCancel={vi.fn()} />,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'blurred' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith('blurred');
  });
});
