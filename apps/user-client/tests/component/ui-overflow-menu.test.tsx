// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OverflowMenu } from '../../src/components/ui/OverflowMenu.js';

describe('OverflowMenu', () => {
  it('opens on trigger click and lists every action', () => {
    render(
      <OverflowMenu items={[{ label: 'Rename' }, { label: 'Delete', tone: 'destructive' }]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('icon variant (default) renders the ⋯ glyph and uses cs-overflow-trigger', () => {
    render(<OverflowMenu items={[{ label: 'Rename' }]} />);
    const trigger = screen.getByRole('button', { name: /more actions/i });
    expect(trigger.textContent).toBe('⋯');
    expect(trigger).toHaveClass('cs-overflow-trigger');
    expect(trigger).not.toHaveClass('cs-overflow-trigger-labelled');
  });

  it('labelled variant renders triggerLabel as visible text and uses cs-overflow-trigger-labelled', () => {
    render(
      <OverflowMenu
        items={[{ label: 'Upload files' }, { label: 'New document' }]}
        triggerLabel="Add ▾"
        variant="labelled"
      />,
    );
    const trigger = screen.getByRole('button', { name: /add/i });
    expect(trigger.textContent).toBe('Add ▾');
    expect(trigger).toHaveClass('cs-overflow-trigger-labelled');
    expect(trigger).not.toHaveClass('cs-overflow-trigger');
  });

  it('fires onSelect for an enabled item and closes', () => {
    const onSelect = vi.fn();
    render(<OverflowMenu items={[{ label: 'Rename', onSelect }]} />);
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
  });

  it('shows disabled items as focusable with an announced reason and does NOT fire onSelect (HARD-2)', () => {
    const onSelect = vi.fn();
    render(
      <OverflowMenu
        items={[{ label: 'Pin', onSelect, disabled: true, disabledReason: 'Needs sync' }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    const item = screen.getByRole('menuitem', { name: 'Pin' });
    expect(item.tagName).toBe('BUTTON'); // focusable, not a non-focusable div
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).not.toBeDisabled(); // aria-disabled, not the native attribute (stays tabbable)
    const reasonId = item.getAttribute('aria-describedby');
    expect(reasonId).toBeTruthy();
    expect(document.getElementById(reasonId as string)?.textContent).toMatch(/needs sync/i);
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    render(<OverflowMenu items={[{ label: 'Rename' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
  });
});
