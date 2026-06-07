import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentStatusBadge } from '../../../src/components/knowledge/DocumentStatusBadge.js';

describe('DocumentStatusBadge', () => {
  it('renders a label per status', () => {
    const { rerender } = render(<DocumentStatusBadge status="pending" onRetry={() => {}} />);
    expect(screen.getByText(/pending/i)).toBeTruthy();
    rerender(<DocumentStatusBadge status="embedding" onRetry={() => {}} />);
    expect(screen.getByText(/embedding/i)).toBeTruthy();
    rerender(<DocumentStatusBadge status="ready" onRetry={() => {}} />);
    expect(screen.getByText(/ready/i)).toBeTruthy();
  });

  it('offers retry only when failed', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<DocumentStatusBadge status="ready" onRetry={onRetry} />);
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    rerender(<DocumentStatusBadge status="failed" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
