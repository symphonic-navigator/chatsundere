// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PillRow } from '../../src/boot/client-data-db.js';
import { Pill } from '../../src/components/chat/Pill.js';

function calcPill(over: Partial<PillRow> = {}): PillRow {
  return {
    id: 'p1',
    messageId: 'm1',
    kind: 'tool-call',
    positionHint: 'inline',
    status: 'completed',
    payload: {
      name: 'calculate_js',
      argumentsJson: '{"code":"[...\\"strawberry\\"].filter(c=>c===\\"r\\").length"}',
      result: '3',
    },
    createdAt: 0,
    ...over,
  };
}

describe('Pill (tool-call)', () => {
  it('renders the tool name collapsed and the status attribute', () => {
    render(<Pill row={calcPill()} />);
    expect(screen.getByText('calculate_js')).toBeInTheDocument();
    expect(screen.queryByText(/strawberry/)).not.toBeInTheDocument();
  });

  it('expands on click to show the code and the result', () => {
    render(<Pill row={calcPill()} />);
    fireEvent.click(screen.getByText('calculate_js'));
    expect(screen.getByText(/strawberry/)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('expands a query_knowledgebase pill to show the query and results', () => {
    const row: PillRow = {
      id: 'p2',
      messageId: 'm1',
      kind: 'tool-call',
      positionHint: 'inline',
      status: 'completed',
      payload: {
        name: 'query_knowledgebase',
        argumentsJson: '{"query":"farbkraft"}',
        result: '[Farblehre › Grundlagen]  (0.57)\nWarme Farben wirken kräftiger.',
      },
      createdAt: 0,
    };
    render(<Pill row={row} />);
    fireEvent.click(screen.getByText('query_knowledgebase'));
    expect(screen.getByText(/farbkraft/)).toBeInTheDocument();
    expect(screen.getByText(/Farblehre/)).toBeInTheDocument();
  });

  it('shows the error when the call failed', () => {
    render(
      <Pill
        row={calcPill({
          status: 'failed',
          payload: {
            name: 'calculate_js',
            argumentsJson: '{"code":"x"}',
            error: 'ReferenceError: x is not defined',
          },
        })}
      />,
    );
    fireEvent.click(screen.getByText('calculate_js'));
    expect(screen.getByText(/ReferenceError/)).toBeInTheDocument();
  });
});
