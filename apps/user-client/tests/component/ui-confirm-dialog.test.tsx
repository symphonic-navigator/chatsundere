// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../src/components/ui/ConfirmDialog.js';

const base = {
  title: 'Save changes?',
  confirmLabel: 'Save',
  onConfirm: () => {},
  onCancel: () => {},
};

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ConfirmDialog {...base} open={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('non-destructive: the confirm button wears the gold priority overlay', () => {
    render(<ConfirmDialog {...base} open />);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveAttribute('data-tone', 'primary');
    expect(save).toHaveAttribute('data-priority', 'true');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveAttribute('data-tone', 'neutral');
  });

  it('destructive: gold moves to the safe choice, confirm is red, title is marked destructive', () => {
    render(
      <ConfirmDialog
        {...base}
        open
        destructive
        title="Delete Fable?"
        confirmLabel="Delete"
        cancelLabel="Keep"
      />,
    );
    const del = screen.getByRole('button', { name: 'Delete' });
    expect(del).toHaveAttribute('data-tone', 'destructive');
    expect(del).not.toHaveAttribute('data-priority'); // gold never invites destruction
    const keep = screen.getByRole('button', { name: 'Keep' });
    expect(keep).toHaveAttribute('data-priority', 'true'); // gold protects the safe choice
    expect(screen.getByText('Delete Fable?')).toHaveAttribute('data-destructive', 'true');
  });

  it('fires onConfirm and onCancel; backdrop click maps to cancel (the safe path)', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog {...base} open onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    const backdrop = container.querySelector('.cs-dialog-backdrop') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
