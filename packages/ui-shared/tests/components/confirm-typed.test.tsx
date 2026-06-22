// SPDX-License-Identifier: LGPL-3.0-only

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfirmTyped } from '../../src/components/ConfirmTyped.js';

afterEach(() => cleanup());

// jsdom does not implement the native <dialog> showModal / close methods.
// Stub them so ConfirmTyped's useEffect can run without throwing.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

const baseProps = {
  open: true,
  title: 'Delete everything?',
  body: 'This is permanent.',
  confirmToken: 'navigator',
  confirmTokenLabel: 'your username',
  destructiveCta: 'Yes, delete',
  cancelCta: 'No',
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
};

describe('ConfirmTyped protectCancel', () => {
  it('cancel button has data-priority="true" when protectCancel is set', () => {
    render(<ConfirmTyped {...baseProps} protectCancel />);
    const cancelBtn = screen.getByRole('button', { name: 'No' });
    expect(cancelBtn.getAttribute('data-priority')).toBe('true');
  });

  it('cancel button uses the real gold gradient tokens (not a fallback literal)', () => {
    render(<ConfirmTyped {...baseProps} protectCancel />);
    const cancelBtn = screen.getByRole('button', { name: 'No' }) as HTMLButtonElement;
    // The style prop must reference the canonical design tokens, not the broken --gold alias.
    expect(cancelBtn.style.backgroundImage).toContain('var(--color-gold-hi)');
    expect(cancelBtn.style.backgroundImage).toContain('var(--color-gold-lo)');
  });

  it('destructive button does NOT have data-priority when protectCancel is set', () => {
    render(<ConfirmTyped {...baseProps} protectCancel />);
    const destructiveBtn = screen.getByRole('button', { name: 'Yes, delete' });
    expect(destructiveBtn.getAttribute('data-priority')).toBeNull();
  });

  it('cancel button has no data-priority when protectCancel is absent', () => {
    render(<ConfirmTyped {...baseProps} />);
    const cancelBtn = screen.getByRole('button', { name: 'No' });
    expect(cancelBtn.getAttribute('data-priority')).toBeNull();
  });

  it('cancel button has no data-priority when protectCancel is false', () => {
    render(<ConfirmTyped {...baseProps} protectCancel={false} />);
    const cancelBtn = screen.getByRole('button', { name: 'No' });
    expect(cancelBtn.getAttribute('data-priority')).toBeNull();
  });
});
