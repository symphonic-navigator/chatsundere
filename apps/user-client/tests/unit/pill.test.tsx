import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PillRow } from '../../src/boot/client-data-db';
import { Pill } from '../../src/components/chat/Pill';

function makeRow(over: Partial<PillRow>): PillRow {
  return {
    id: 'p1',
    messageId: 'm1',
    kind: 'tool-call',
    positionHint: 'inline',
    status: 'completed',
    payload: { name: 'web_search' },
    createdAt: 1,
    ...over,
  };
}

describe('Pill', () => {
  it('renders inline pill with icon + label', () => {
    const { container } = render(<Pill row={makeRow({})} />);
    const span = container.querySelector('.pill');
    expect(span).not.toBeNull();
    expect(span?.getAttribute('data-pill-kind')).toBe('tool-call');
    expect(span?.getAttribute('data-pill-status')).toBe('completed');
    expect(span?.textContent).toContain('⚙');
    expect(span?.textContent).toContain('web_search');
  });

  it('renders above-text wrapper for positionHint above-text', () => {
    const { container } = render(<Pill row={makeRow({ positionHint: 'above-text' })} />);
    expect(container.querySelector('.pill-above')).not.toBeNull();
    expect(container.querySelector('.pill-above .pill')).not.toBeNull();
  });

  it('kb-injection label shows the lore entry count', () => {
    const { container } = render(
      <Pill
        row={makeRow({
          kind: 'kb-injection',
          payload: {
            entries: [{ libraryName: 'Story', documentTitle: 'Red Dragon', injectedText: 'x' }],
            omittedCount: 0,
            truncatedCount: 0,
          },
        })}
      />,
    );
    const span = container.querySelector('.pill');
    expect(span?.textContent).toContain('◆');
    expect(span?.textContent).toContain('Lore · 1');
  });

  it('image-result has the image label', () => {
    const { container } = render(<Pill row={makeRow({ kind: 'image-result', payload: {} })} />);
    expect(container.querySelector('.pill')?.textContent).toContain('image');
  });

  it('voice-expression uses payload.expression', () => {
    const { container } = render(
      <Pill row={makeRow({ kind: 'voice-expression', payload: { expression: 'soft' } })} />,
    );
    expect(container.querySelector('.pill')?.textContent).toContain('soft');
  });

  it('falls back gracefully when payload lacks expected keys', () => {
    const { container } = render(<Pill row={makeRow({ payload: undefined })} />);
    expect(container.querySelector('.pill')?.textContent).toContain('tool');
  });
});
