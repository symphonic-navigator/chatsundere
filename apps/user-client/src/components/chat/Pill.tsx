// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { PillRow } from '../../boot/client-data-db.js';
import { ArtefactPill } from './ArtefactPill.js';

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
  argumentsJson?: string;
  result?: string;
  error?: string;
}

function labelFor(row: PillRow): string {
  const p = row.payload as PillPayloadShape | undefined;
  if (row.kind === 'tool-call') return p?.name ?? 'tool';
  if (row.kind === 'kb-injection') return `KB${p?.kbName ? ` ${p.kbName}` : ''}`;
  if (row.kind === 'image-result') return 'image';
  return p?.expression ?? 'voice';
}

/** Pull the `code` argument out of the stored arguments JSON for display. */
function codeOf(p: PillPayloadShape | undefined): string | null {
  if (!p?.argumentsJson) return null;
  try {
    const parsed = JSON.parse(p.argumentsJson) as { code?: unknown };
    return typeof parsed.code === 'string' ? parsed.code : p.argumentsJson;
  } catch {
    return p.argumentsJson;
  }
}

export function Pill({ row }: { row: PillRow }): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  if (
    row.kind === 'tool-call' &&
    (row.payload as { name?: string } | undefined)?.name === 'create_artefact'
  ) {
    return <ArtefactPill row={row} />;
  }

  if (row.positionHint === 'above-text') {
    const inlineRow: PillRow = { ...row, positionHint: 'inline' };
    return (
      <div className="pill-above">
        <Pill row={inlineRow} />
      </div>
    );
  }

  const payload = row.payload as PillPayloadShape | undefined;
  const expandable =
    row.kind === 'tool-call' && (!!codeOf(payload) || !!payload?.result || !!payload?.error);
  const code = codeOf(payload);

  return (
    <span className="pill-wrap">
      <button
        type="button"
        className="pill"
        data-pill-kind={row.kind}
        data-pill-status={row.status}
        data-pill-expandable={expandable || undefined}
        aria-expanded={expandable ? expanded : undefined}
        onClick={expandable ? () => setExpanded((v) => !v) : undefined}
      >
        <span className="pill-icon">{ICON[row.kind]}</span>
        {labelFor(row)}
      </button>
      {expandable && expanded && (
        <span className="pill-detail">
          {code !== null && <code className="pill-detail-code">{code}</code>}
          {payload?.result !== undefined && (
            <code className="pill-detail-result">{payload.result}</code>
          )}
          {payload?.error && <code className="pill-detail-error">{payload.error}</code>}
        </span>
      )}
    </span>
  );
}
