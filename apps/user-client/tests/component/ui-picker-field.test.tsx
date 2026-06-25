// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PickerField } from '../../src/components/ui/PickerField.js';

describe('PickerField', () => {
  it('shows label + value and calls onOpen with its trigger element', () => {
    const onOpen = vi.fn();
    render(<PickerField label="Mindspace" value="Aurora" onOpen={onOpen} />);
    expect(screen.getByText('Mindspace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mindspace/ }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen.mock.calls[0]?.[0]).toBeInstanceOf(HTMLElement);
  });

  it('renders the constructive stale reason and marks the row stale', () => {
    render(
      <PickerField
        label="Search backend"
        value="Brave"
        stale={{ reason: 'Currently unavailable — add nano-gpt or pick another' }}
        onOpen={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Currently unavailable — add nano-gpt or pick another'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Search backend/ })).toHaveAttribute(
      'data-stale',
      'true',
    );
  });

  it('is disabled with a reason and does not open', () => {
    const onOpen = vi.fn();
    render(
      <PickerField
        label="Expert web"
        value="—"
        disabled
        disabledReason="Set an expert model first"
        onOpen={onOpen}
      />,
    );
    const btn = screen.getByRole('button', { name: /Expert web/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Set an expert model first');
    fireEvent.click(btn);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
