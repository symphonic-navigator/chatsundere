// SPDX-License-Identifier: AGPL-3.0-only
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryRowConfirmTray } from '../../src/components/history/HistoryRowConfirmTray';

describe('HistoryRowConfirmTray', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renders Cancel + Delete buttons', () => {
    const { getByText, getByRole } = render(
      <HistoryRowConfirmTray onCancel={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(getByText('Delete this chat?')).toBeInTheDocument();
    expect(getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('Cancel fires onCancel', () => {
    const onCancel = vi.fn();
    const { getByRole } = render(<HistoryRowConfirmTray onCancel={onCancel} onDelete={vi.fn()} />);
    getByRole('button', { name: /cancel/i }).click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Delete fires onDelete', () => {
    const onDelete = vi.fn();
    const { getByRole } = render(<HistoryRowConfirmTray onCancel={vi.fn()} onDelete={onDelete} />);
    getByRole('button', { name: /delete/i }).click();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('auto-collapses after 6s (fires onCancel)', () => {
    const onCancel = vi.fn();
    render(<HistoryRowConfirmTray onCancel={onCancel} onDelete={vi.fn()} />);
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does NOT auto-cancel before 6s', () => {
    const onCancel = vi.fn();
    render(<HistoryRowConfirmTray onCancel={onCancel} onDelete={vi.fn()} />);
    act(() => {
      vi.advanceTimersByTime(5999);
    });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
