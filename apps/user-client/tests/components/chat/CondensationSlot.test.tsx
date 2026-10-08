// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PillRow } from '../../../src/boot/client-data-db.js';
import { CondensationSlot } from '../../../src/components/chat/CondensationSlot.js';
import { useToolSummaryStore } from '../../../src/state/tool-summary.store.js';

const LONG = 'Fact. '.repeat(1_000);
function row(payload: Record<string, unknown> = {}, over: Partial<PillRow> = {}): PillRow {
  return {
    id: 'p1',
    messageId: 'm1',
    kind: 'tool-call',
    positionHint: 'inline',
    status: 'completed',
    payload: { name: 'mcp_search', argumentsJson: '{"q":"x"}', result: LONG, ...payload },
    createdAt: 0,
    ...over,
  };
}
afterEach(() => useToolSummaryStore.setState({ pending: new Set() }));

describe('CondensationSlot', () => {
  it('renders nothing for a short result', () => {
    const { container } = render(<CondensationSlot row={row({ result: 'short' })} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('announces a pending summary', () => {
    useToolSummaryStore.setState({ pending: new Set(['p1']) });
    render(<CondensationSlot row={row()} />);
    expect(screen.getByText('Condensing for later turns…')).toBeInTheDocument();
  });
  it('shows the summary under its heading', () => {
    render(<CondensationSlot row={row({ replaySummary: 'The gist.' })} />);
    expect(screen.getByText('Later turns see this summary')).toBeInTheDocument();
    expect(screen.getByText('The gist.')).toBeInTheDocument();
  });
  it('caps an oversized summary at the replay limit', () => {
    render(<CondensationSlot row={row({ replaySummary: 's'.repeat(5_000) })} />);
    expect(screen.getByText('s'.repeat(2_000))).toBeInTheDocument();
  });
  it('names the cut input in the heading', () => {
    render(<CondensationSlot row={row({ result: 'z'.repeat(48_001), replaySummary: 'G.' })} />);
    expect(
      screen.getByText('Later turns see this summary of the first 48,000 characters'),
    ).toBeInTheDocument();
  });
  it('explains the head-cut without a summary (also for a non-string summary)', () => {
    render(<CondensationSlot row={row({ replaySummary: 42 })} />);
    expect(
      screen.getByText('Later turns only see the beginning of this result.'),
    ).toBeInTheDocument();
  });
  it('renders nothing for artefact tools and vision pills', () => {
    const a = render(<CondensationSlot row={row({ name: 'inspect_artefact' })} />);
    expect(a.container).toBeEmptyDOMElement();
    const v = render(
      <CondensationSlot row={row({ name: 'describe_image', argumentsJson: undefined })} />,
    );
    expect(v.container).toBeEmptyDOMElement();
  });
});
