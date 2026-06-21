// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompactionMarker } from '../../src/components/chat/CompactionMarker.js';

const cp = {
  id: 'cp',
  chatId: 'c',
  createdAt: 1,
  modelId: 'm',
  summaryMarkdown: 'BRIEFING TEXT',
  lastMessageIdBefore: 'a',
  tailStartMessageId: 'b',
  tokensBefore: 87000,
  tokensAfter: 4000,
  tailTokenCount: 20,
  prevCheckpointId: null,
  trigger: 'manual' as const,
};

describe('CompactionMarker', () => {
  it('renders a tappable pill and opens the drawer with the briefing', () => {
    render(<CompactionMarker checkpoint={cp} />);
    const pill = screen.getByRole('button', { name: /compacted/i });
    expect(pill).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(pill);
    expect(screen.getByText(/BRIEFING TEXT/)).toBeInTheDocument();
    expect(screen.getByText(/compact again/i)).toBeInTheDocument(); // the refresh line
  });
});
