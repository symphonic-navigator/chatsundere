import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StreamInterruptedFooter } from '../../src/components/chat/StreamInterruptedFooter.js';

describe('StreamInterruptedFooter', () => {
  it('shows no diagnostics affordance when onShowDiagnostics is absent', () => {
    render(<StreamInterruptedFooter onRetry={() => {}} onDiscard={() => {}} />);
    expect(screen.queryByRole('button', { name: /show diagnostics/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/before reloading/i)).not.toBeInTheDocument();
  });

  it('shows the diagnostics link + perishable nudge when provided, and fires it', () => {
    const onShow = vi.fn();
    render(
      <StreamInterruptedFooter
        onRetry={() => {}}
        onDiscard={() => {}}
        onShowDiagnostics={onShow}
      />,
    );
    expect(screen.getByText(/before reloading/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show diagnostics/i }));
    expect(onShow).toHaveBeenCalledTimes(1);
  });
});
