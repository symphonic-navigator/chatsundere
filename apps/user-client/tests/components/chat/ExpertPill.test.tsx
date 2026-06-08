// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PillRow } from '../../../src/boot/client-data-db.js';
import { ExpertPill } from '../../../src/components/chat/ExpertPill.js';

function row(over: Partial<PillRow> = {}, payload: Record<string, unknown> = {}): PillRow {
  return {
    id: 'p',
    messageId: 'm',
    kind: 'tool-call',
    positionHint: 'inline',
    status: 'pending',
    payload,
    createdAt: 0,
    ...over,
  };
}

describe('ExpertPill', () => {
  it('pending + reasoning phase shows "thinking" with formatted charCount and model', () => {
    render(
      <ExpertPill
        row={row(
          { status: 'pending' },
          { phase: 'reasoning', charCount: 1234, model: 'Big Model' },
        )}
      />,
    );
    expect(screen.getByText(/thinking/)).toBeInTheDocument();
    expect(screen.getByText(/1[,.]?234/)).toBeInTheDocument();
    expect(screen.getByText(/Big Model/)).toBeInTheDocument();
  });

  it('pending + answer phase shows "answering"', () => {
    render(
      <ExpertPill
        row={row({ status: 'pending' }, { phase: 'answer', charCount: 10, model: 'Big Model' })}
      />,
    );
    expect(screen.getByText(/answering/)).toBeInTheDocument();
  });

  it('completed pill shows question and answer after clicking to expand', () => {
    render(
      <ExpertPill
        row={row(
          { status: 'completed' },
          {
            model: 'Big Model',
            question: 'Q?',
            result: 'A.',
            argumentsJson: '{"question":"Q?"}',
          },
        )}
      />,
    );
    // Initially collapsed — question and answer not visible
    expect(screen.queryByText('Q?')).not.toBeInTheDocument();
    expect(screen.queryByText('A.')).not.toBeInTheDocument();
    // Expand
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Q?')).toBeInTheDocument();
    expect(screen.getByText('A.')).toBeInTheDocument();
  });

  it('failed pill shows the error message', () => {
    render(<ExpertPill row={row({ status: 'failed' }, { model: 'Big Model', error: 'boom' })} />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
});
