// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditSendButton } from '../../../src/components/chat/EditSendButton.js';

describe('EditSendButton', () => {
  it('last message: primary Replace fires onReplace; Branch is the secondary', () => {
    const onReplace = vi.fn();
    const onBranch = vi.fn();
    render(
      <EditSendButton
        canReplace
        disabledReason={null}
        onReplace={onReplace}
        onBranch={onBranch}
        busy={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Replace message$/i }));
    expect(onReplace).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /more/i })); // open the caret menu
    fireEvent.click(screen.getByText(/Branch to a new chat/i));
    expect(onBranch).toHaveBeenCalledOnce();
  });

  it('not last: Replace is present but disabled with its reason; primary is Branch', () => {
    const onReplace = vi.fn();
    render(
      <EditSendButton
        canReplace={false}
        disabledReason="There are newer messages after this — editing here starts a branch."
        onReplace={onReplace}
        onBranch={() => {}}
        busy={false}
      />,
    );
    // Primary action is Branch.
    expect(screen.getByRole('button', { name: /^Branch/i })).toBeTruthy();
    // Replace is still visibly present, disabled, carrying the reason (never
    // collapsed away). OverflowMenu keeps disabled items *focusable* (spec
    // §7, HARD-2: aria-disabled, not the native `disabled` attribute) so a
    // screen reader can still reach and announce the reason — so we assert
    // aria-disabled rather than the native `.disabled` DOM property, matching
    // the existing contract exercised by tests/component/ui-overflow-menu.test.tsx.
    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    const replace = screen.getByText(/^Replace$/i).closest('button');
    expect(replace).toHaveAttribute('aria-disabled', 'true');
    expect(replace?.getAttribute('title')).toMatch(/newer messages/i);
    fireEvent.click(replace as Element);
    expect(onReplace).not.toHaveBeenCalled();
  });
});
