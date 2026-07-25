// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { PillRow } from '../../boot/client-data-db.js';
import { ArtefactPill } from './ArtefactPill.js';
import { ExpertPill } from './ExpertPill.js';
import { ImagePill } from './ImagePill.js';
import { VisionPill } from './VisionPill.js';

const ICON: Record<PillRow['kind'], string> = {
  'tool-call': '⚙',
  'kb-injection': '◆',
  'image-result': '▢',
  'voice-expression': '~',
};

interface LoreEntryShape {
  libraryName: string;
  documentTitle: string;
  injectedText: string;
}

interface PillPayloadShape {
  name?: string;
  kbName?: string;
  expression?: string;
  argumentsJson?: string;
  result?: string;
  error?: string;
  entries?: LoreEntryShape[];
  omittedCount?: number;
  truncatedCount?: number;
}

function labelFor(row: PillRow): string {
  const p = row.payload as PillPayloadShape | undefined;
  if (row.kind === 'tool-call' && p?.name === 'write_memory_entry') return 'Remembered';
  if (row.kind === 'tool-call') return p?.name ?? 'tool';
  if (row.kind === 'kb-injection') return `Lore · ${p?.entries?.length ?? 0}`;
  if (row.kind === 'image-result') return 'image';
  return p?.expression ?? 'voice';
}

/**
 * Pull the primary argument out of the stored arguments JSON for display.
 * `calculate_js` exposes `code`, `query_knowledgebase` exposes `query`,
 * `write_memory_entry` exposes `content`; any other tool falls back to the
 * raw JSON so its input is still inspectable.
 */
function codeOf(p: PillPayloadShape | undefined): string | null {
  if (!p?.argumentsJson) return null;
  try {
    const parsed = JSON.parse(p.argumentsJson) as {
      code?: unknown;
      query?: unknown;
      content?: unknown;
    };
    if (typeof parsed.code === 'string') return parsed.code;
    if (typeof parsed.query === 'string') return parsed.query;
    if (typeof parsed.content === 'string') return parsed.content;
    return p.argumentsJson;
  } catch {
    return p.argumentsJson;
  }
}

export function Pill({ row }: { row: PillRow }): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const toolName = (row.payload as { name?: string } | undefined)?.name;
  if (
    row.kind === 'tool-call' &&
    (toolName === 'create_artefact' ||
      toolName === 'modify_artefact' ||
      toolName === 'inspect_artefact')
  ) {
    return <ArtefactPill row={row} />;
  }

  if (
    row.kind === 'tool-call' &&
    (row.payload as { name?: string } | undefined)?.name === 'ask_expert'
  ) {
    return <ExpertPill row={row} />;
  }

  if (
    row.kind === 'tool-call' &&
    (row.payload as { name?: string } | undefined)?.name === 'describe_image'
  ) {
    return <VisionPill row={row} />;
  }

  if (
    row.kind === 'tool-call' &&
    (row.payload as { name?: string } | undefined)?.name === 'generate_image'
  ) {
    // Block-level wrapper: the image pill (and its thumbnail grid) always
    // starts on its own line instead of continuing the inline text flow.
    return (
      <div className="image-pill-block">
        <ImagePill row={row} />
      </div>
    );
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
  const isLore = row.kind === 'kb-injection';
  const expandable =
    (row.kind === 'tool-call' && (!!codeOf(payload) || !!payload?.result || !!payload?.error)) ||
    (isLore && (payload?.entries?.length ?? 0) > 0);
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
          {isLore ? (
            <>
              {payload?.entries?.map((e, i) => (
                <span key={`${e.libraryName}-${e.documentTitle}-${i}`} className="pill-detail-lore">
                  <span className="pill-detail-lore-source">{`${e.libraryName} › ${e.documentTitle}`}</span>
                  <code className="pill-detail-result">{e.injectedText}</code>
                </span>
              ))}
              {(payload?.omittedCount ?? 0) > 0 || (payload?.truncatedCount ?? 0) > 0 ? (
                <span className="pill-detail-lore-note">
                  {`${payload?.truncatedCount ?? 0} truncated, ${payload?.omittedCount ?? 0} omitted (budget).`}
                </span>
              ) : null}
            </>
          ) : (
            <>
              {code !== null && <code className="pill-detail-code">{code}</code>}
              {payload?.result !== undefined && (
                <code className="pill-detail-result">{payload.result}</code>
              )}
              {payload?.error && <code className="pill-detail-error">{payload.error}</code>}
            </>
          )}
        </span>
      )}
    </span>
  );
}
