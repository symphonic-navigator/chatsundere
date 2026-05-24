// SPDX-License-Identifier: AGPL-3.0-only
import type { PillRow } from '../../boot/client-data-db.js';

const ICON: Record<PillRow['kind'], string> = {
  'tool-call': '⚙',
  'kb-injection': '◆',
  'image-result': '▢',
  'voice-expression': '~',
};

interface PillPayloadShape {
  name?: string;
  kbName?: string;
  expression?: string;
}

function labelFor(row: PillRow): string {
  const p = row.payload as PillPayloadShape | undefined;
  if (row.kind === 'tool-call') return p?.name ?? 'tool';
  if (row.kind === 'kb-injection') return `KB${p?.kbName ? ` ${p.kbName}` : ''}`;
  if (row.kind === 'image-result') return 'image';
  return p?.expression ?? 'voice';
}

export function Pill({ row }: { row: PillRow }): JSX.Element {
  if (row.positionHint === 'above-text') {
    const inlineRow: PillRow = { ...row, positionHint: 'inline' };
    return (
      <div className="pill-above">
        <Pill row={inlineRow} />
      </div>
    );
  }
  return (
    <span className="pill" data-pill-kind={row.kind} data-pill-status={row.status}>
      <span className="pill-icon">{ICON[row.kind]}</span>
      {labelFor(row)}
    </span>
  );
}
