// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InteractionTopbar } from '../../src/components/chat/InteractionTopbar.js';

const base = {
  persona: { id: 'p', name: 'Fable' } as never,
  chat: { id: 'c' } as never,
  contextWindow: 1000,
  onExit: () => {},
  onRenameChat: () => {},
};

function wrap(ui: React.ReactElement): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('InteractionTopbar gauge as compaction trigger', () => {
  it('invokes onCompact when the gauge is tapped and compactable', () => {
    const onCompact = vi.fn();
    render(
      wrap(<InteractionTopbar {...base} usedTokens={900} compactable onCompact={onCompact} />),
    );
    fireEvent.click(screen.getByRole('button', { name: /compact/i }));
    expect(onCompact).toHaveBeenCalled();
  });

  it('is disabled with a reason when not compactable', () => {
    render(
      wrap(
        <InteractionTopbar {...base} usedTokens={100} compactable={false} onCompact={() => {}} />,
      ),
    );
    const gauge = screen.getByRole('button', { name: /compact/i });
    expect(gauge).toBeDisabled();
    expect(gauge).toHaveAttribute('title');
  });
});
