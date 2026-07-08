// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DecryptPromptOverlay } from '../../src/components/transfer/DecryptPromptOverlay.js';

describe('DecryptPromptOverlay', () => {
  it('submits the typed password and shows an error while keeping it', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <DecryptPromptOverlay onSubmit={onSubmit} onCancel={() => {}} error={null} busy={false} />,
    );
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));
    expect(onSubmit).toHaveBeenCalledWith('secret');

    rerender(
      <DecryptPromptOverlay
        onSubmit={onSubmit}
        onCancel={() => {}}
        error="That password didn’t work — try again."
        busy={false}
      />,
    );
    expect(screen.getByText(/didn.t work/i)).toBeTruthy();
    // The field keeps what was typed (component is not remounted).
    expect((screen.getByLabelText(/^password$/i) as HTMLInputElement).value).toBe('secret');
  });

  it('disables Unlock while the field is empty', () => {
    render(
      <DecryptPromptOverlay onSubmit={vi.fn()} onCancel={() => {}} error={null} busy={false} />,
    );
    expect((screen.getByRole('button', { name: /unlock/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
