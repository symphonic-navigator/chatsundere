import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PillRow } from '../../../src/boot/client-data-db.js';
import { Pill } from '../../../src/components/chat/Pill.js';

interface KbPayload {
  entries?: { libraryName: string; documentTitle: string; injectedText: string }[];
  omittedCount?: number;
  truncatedCount?: number;
}

function kbPill(payloadOverrides: Partial<KbPayload> = {}): PillRow {
  return {
    id: 'p1',
    messageId: 'm1',
    kind: 'kb-injection',
    positionHint: 'inline',
    status: 'completed',
    payload: {
      entries: [{ libraryName: 'Story', documentTitle: 'Red Dragon', injectedText: 'The dragon.' }],
      omittedCount: 1,
      truncatedCount: 0,
      ...payloadOverrides,
    },
    createdAt: 1,
  };
}

function toolCallPill(name: string, argumentsJson: string): PillRow {
  return {
    id: 'p2',
    messageId: 'm2',
    kind: 'tool-call',
    positionHint: 'inline',
    status: 'completed',
    payload: { name, argumentsJson },
    createdAt: 2,
  };
}

describe('Pill — write_memory_entry tool-call', () => {
  it('labels the pill "Remembered" and does not show the raw tool name', () => {
    render(
      <Pill
        row={toolCallPill(
          'write_memory_entry',
          JSON.stringify({ content: 'User has a cat named Mochi.' }),
        )}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('Remembered');
    expect(btn).not.toHaveTextContent('write_memory_entry');
  });

  it('is expandable and reveals the remembered text on click', () => {
    render(
      <Pill
        row={toolCallPill(
          'write_memory_entry',
          JSON.stringify({ content: 'User has a cat named Mochi.' }),
        )}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(screen.getByText('User has a cat named Mochi.')).toBeInTheDocument();
  });
});

describe('Pill — kb-injection', () => {
  it('labels with the entry count and expands to show provenance + content', () => {
    render(<Pill row={kbPill()} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('Lore · 1');
    fireEvent.click(btn);
    expect(screen.getByText('Story › Red Dragon')).toBeInTheDocument();
    expect(screen.getByText('The dragon.')).toBeInTheDocument();
    expect(screen.getByText(/1 omitted/i)).toBeInTheDocument();
  });

  it('shows the truncated count in the budget note', () => {
    render(<Pill row={kbPill({ omittedCount: 0, truncatedCount: 1 })} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/1 truncated/i)).toBeInTheDocument();
  });

  it('renders a non-expandable pill with no budget note when nothing was omitted or truncated', () => {
    render(<Pill row={kbPill({ omittedCount: 0, truncatedCount: 0 })} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText(/budget/i)).not.toBeInTheDocument();
  });

  it('stays collapsed (not expandable) when there are no entries', () => {
    render(<Pill row={kbPill({ entries: [] })} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('Lore · 0');
    expect(btn).not.toHaveAttribute('aria-expanded');
  });
});
