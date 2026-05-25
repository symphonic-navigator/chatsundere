// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ReasoningPill } from '../../src/components/chat/ReasoningPill';
import type { ResolvedMindspace } from '../../src/state/mindspace-resolver';

// Minimal stub — the component does not read mindspace fields directly; it
// relies on the CSS var --mindspace-accent set by an ancestor (MindspaceLayer).
// The prop is plumbed for future extensions and for the type contract, so a
// cast is appropriate here.
const mindspaceStub = {} as ResolvedMindspace;

describe('<ReasoningPill>', () => {
  it('renders closed by default with aria-expanded="false"', () => {
    render(
      <ReasoningPill
        text="thinking ..."
        isLive
        isStreamingDraft={false}
        mindspace={mindspaceStub}
        font="serif"
      />,
    );
    const handle = screen.getByRole('button');
    expect(handle.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows three pulse-animated dots while isLive', () => {
    render(
      <ReasoningPill
        text=""
        isLive
        isStreamingDraft={false}
        mindspace={mindspaceStub}
        font="serif"
      />,
    );
    const dotsContainer = screen.getByTestId('reasoning-pill-dots');
    expect(dotsContainer.querySelectorAll('.dot').length).toBe(3);
    const handle = screen.getByRole('button');
    expect(handle.getAttribute('data-live')).toBe('true');
  });

  it('omits the live attribute when !isLive (finalised)', () => {
    render(
      <ReasoningPill
        text="done"
        isLive={false}
        isStreamingDraft={false}
        mindspace={mindspaceStub}
        font="serif"
      />,
    );
    const handle = screen.getByRole('button');
    expect(handle.getAttribute('data-live')).toBe('false');
  });

  it('toggles open on click and renders the trace in a region', async () => {
    const user = userEvent.setup();
    render(
      <ReasoningPill
        text={'line one\n\nline two'}
        isLive={false}
        isStreamingDraft={false}
        mindspace={mindspaceStub}
        font="serif"
      />,
    );
    await user.click(screen.getByRole('button'));
    const body = screen.getByRole('region', { name: /reasoning trace/i });
    expect(body.textContent).toContain('line one');
    expect(body.textContent).toContain('line two');
    expect((body as HTMLElement).style.whiteSpace).toBe('pre-wrap');
  });

  it('uses the persona font in the open body', () => {
    render(
      <ReasoningPill
        text="hi"
        isLive={false}
        isStreamingDraft={false}
        mindspace={mindspaceStub}
        font="serif"
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    const body = screen.getByRole('region', { name: /reasoning trace/i });
    expect((body as HTMLElement).style.fontFamily).toContain('var(--font-display)');
  });
});
