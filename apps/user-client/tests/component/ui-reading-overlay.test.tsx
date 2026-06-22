// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ReadingOverlay } from '../../src/components/ui/ReadingOverlay.js';

// MarkdownContent pulls in heavy markdown deps; stub it to its text for this unit test.
vi.mock('../../src/components/chat/markdown/MarkdownContent.js', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div data-md>{text}</div>,
}));

describe('ReadingOverlay', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ReadingOverlay open={false} title="Privacy" markdown="# Privacy" onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the title and renders the markdown when open', () => {
    render(
      <ReadingOverlay open title="Privacy & data handling" markdown="# Hello" onClose={() => {}} />,
    );
    expect(screen.getByText('Privacy & data handling')).toBeInTheDocument();
    expect(screen.getByText('# Hello')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('closes on the × button, on Escape, and on backdrop tap', () => {
    const onClose = vi.fn();
    render(<ReadingOverlay open title="X" markdown="x" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('cs-reader-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('restores focus to the trigger element when the overlay closes', () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <ReadingOverlay open={open} title="T" markdown="m" onClose={() => setOpen(false)} />
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });

    // Focus and open the overlay via the trigger.
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);

    // The × button should now have focus (overlay is open).
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));

    // Close via the × button.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    // Focus must be restored to the trigger.
    expect(document.activeElement).toBe(trigger);
  });
});
