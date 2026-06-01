// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BranchSheet } from '../../../src/components/chat/BranchSheet.js';

describe('BranchSheet', () => {
  it('disables Branch until a non-empty name is entered, and confirms trimmed', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<BranchSheet onConfirm={onConfirm} onClose={onClose} />);

    const branchBtn = screen.getByRole('button', { name: 'Branch' });
    expect(branchBtn).toBeDisabled();

    const input = screen.getByLabelText('Branch name');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(branchBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: '  My fork  ' } });
    expect(branchBtn).toBeEnabled();

    fireEvent.click(branchBtn);
    expect(onConfirm).toHaveBeenCalledWith('My fork');
  });

  it('dismisses on Cancel', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<BranchSheet onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows an error message when provided, preserving the input', () => {
    render(
      <BranchSheet
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        error="Could not branch — please try again."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not branch — please try again.');
    // The Branch button is still usable for a retry once a name is present.
    const input = screen.getByLabelText('Branch name');
    fireEvent.change(input, { target: { value: 'retry name' } });
    expect(screen.getByRole('button', { name: 'Branch' })).toBeEnabled();
  });
});
