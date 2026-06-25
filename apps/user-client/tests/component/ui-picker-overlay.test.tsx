// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PickerOverlay } from '../../src/components/ui/PickerOverlay.js';

function renderOverlay(over: Partial<React.ComponentProps<typeof PickerOverlay>> = {}) {
  const props = {
    open: true,
    title: 'Mindspace',
    onClose: vi.fn(),
    children: <button type="button">inner</button>,
    ...over,
  };
  render(<PickerOverlay {...props} />);
  return props;
}

describe('PickerOverlay', () => {
  it('renders nothing when closed', () => {
    renderOverlay({ open: false });
    expect(screen.queryByText('Mindspace')).toBeNull();
  });

  it('shows the title and a Save button only when onSave is given', () => {
    const { rerender } = render(
      <PickerOverlay open title="Web search" onClose={vi.fn()}>
        x
      </PickerOverlay>,
    );
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    rerender(
      <PickerOverlay open title="Web search" onClose={vi.fn()} onSave={vi.fn()}>
        x
      </PickerOverlay>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('Save is disabled when saveDisabled and fires onSave otherwise', () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <PickerOverlay open title="t" onClose={vi.fn()} onSave={onSave} saveDisabled>
        x
      </PickerOverlay>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    rerender(
      <PickerOverlay open title="t" onClose={vi.fn()} onSave={onSave}>
        x
      </PickerOverlay>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('‹ calls onBack when given, else onClose; clean sheet closes without a confirm', () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <PickerOverlay open title="t" onClose={onClose} onBack={onBack}>
        x
      </PickerOverlay>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    rerender(
      <PickerOverlay open title="t" onClose={onClose}>
        x
      </PickerOverlay>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('a dirty sheet raises a Discard-changes confirm before dismissing; Keep editing aborts, Discard closes', () => {
    const onClose = vi.fn();
    renderOverlay({ onClose, onSave: vi.fn(), dirty: true });
    // backdrop tap requests dismissal
    fireEvent.click(screen.getByTestId('cs-picker-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Discard changes?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    // dismiss again, this time confirm the discard
    fireEvent.click(screen.getByTestId('cs-picker-backdrop'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Escape dismisses (clean), and focus moves to the first control (Back) on open', () => {
    const onClose = vi.fn();
    renderOverlay({ onClose });
    expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('opening the discard confirm moves focus onto one of its buttons', () => {
    renderOverlay({ onSave: vi.fn(), dirty: true });
    // act() ensures the confirmingDiscard→true useEffect (focus shift) has run
    // before we assert on document.activeElement.
    act(() => {
      fireEvent.click(screen.getByTestId('cs-picker-backdrop'));
    });
    // The confirm is now open; focus should be on a confirm button.
    const keepBtn = screen.getByRole('button', { name: 'Keep editing' });
    const discardBtn = screen.getByRole('button', { name: 'Discard' });
    const focused = document.activeElement;
    expect(focused === keepBtn || focused === discardBtn).toBe(true);
  });

  it('with the confirm open, Tab from the last confirm button wraps to the first confirm button', () => {
    renderOverlay({ onSave: vi.fn(), dirty: true });
    fireEvent.click(screen.getByTestId('cs-picker-backdrop'));
    // Explicitly put focus on the last button (Discard) and press Tab — should wrap
    // to the first confirm button (Keep editing), not escape to a panel control.
    const discardBtn = screen.getByRole('button', { name: 'Discard' });
    discardBtn.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: false });
    expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus();
  });
});
