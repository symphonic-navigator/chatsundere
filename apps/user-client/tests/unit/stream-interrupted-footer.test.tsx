// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StreamInterruptedFooter } from '../../src/components/chat/StreamInterruptedFooter';

describe('StreamInterruptedFooter', () => {
  it('renders Retry + Discard buttons', () => {
    const { container } = render(<StreamInterruptedFooter onRetry={vi.fn()} onDiscard={vi.fn()} />);
    expect(container.querySelector('[data-action="retry"]')).not.toBeNull();
    expect(container.querySelector('[data-action="discard"]')).not.toBeNull();
  });

  it('Retry fires onRetry', () => {
    const onRetry = vi.fn();
    const { container } = render(<StreamInterruptedFooter onRetry={onRetry} onDiscard={vi.fn()} />);
    fireEvent.click(container.querySelector('[data-action="retry"]') as HTMLElement);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('Discard fires onDiscard', () => {
    const onDiscard = vi.fn();
    const { container } = render(
      <StreamInterruptedFooter onRetry={vi.fn()} onDiscard={onDiscard} />,
    );
    fireEvent.click(container.querySelector('[data-action="discard"]') as HTMLElement);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('shows "Stream interrupted" copy', () => {
    const { container } = render(<StreamInterruptedFooter onRetry={vi.fn()} onDiscard={vi.fn()} />);
    expect(container.textContent).toContain('Stream interrupted');
  });

  it('Retry disabled when prop says so', () => {
    const { container } = render(
      <StreamInterruptedFooter onRetry={vi.fn()} onDiscard={vi.fn()} disabled />,
    );
    expect((container.querySelector('[data-action="retry"]') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((container.querySelector('[data-action="discard"]') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
