import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

  it('shows the generic "Stream interrupted" heading and no link when failureKind is absent', () => {
    render(
      <MemoryRouter>
        <StreamInterruptedFooter onRetry={() => {}} onDiscard={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Stream interrupted')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open server linking/i })).not.toBeInTheDocument();
  });

  it('surfaces the specific proxy-unavailable remedy and an "Open Server linking" link that navigates there', () => {
    render(
      <MemoryRouter>
        <StreamInterruptedFooter
          onRetry={() => {}}
          onDiscard={() => {}}
          failureKind="proxy_unavailable"
        />
      </MemoryRouter>,
    );
    // The specific remedy text must reach the DOM, not the generic
    // "Stream interrupted" header (the known unrendered-error-surface class).
    expect(screen.queryByText('Stream interrupted')).not.toBeInTheDocument();
    expect(screen.getByText(/needs your account link to reach this model/i)).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /open server linking/i });
    expect(link.getAttribute('href')).toBe('/app/account/server-linking');
  });
});
