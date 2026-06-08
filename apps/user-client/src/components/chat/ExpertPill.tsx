// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { PillRow } from '../../boot/client-data-db.js';

interface ExpertPayload {
  model?: string;
  question?: string;
  argumentsJson?: string;
  result?: string;
  error?: string;
  charCount?: number;
  phase?: 'reasoning' | 'answer';
}

function questionOf(p: ExpertPayload): string {
  if (p.question) return p.question;
  if (p.argumentsJson) {
    try {
      const a = JSON.parse(p.argumentsJson) as { question?: string };
      if (typeof a.question === 'string') return a.question;
    } catch {
      /* ignore */
    }
  }
  return '';
}

/** Pill for ask_expert tool-calls: thinking/answering (live) · expandable Q&A. */
export function ExpertPill({ row }: { row: PillRow }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const p = (row.payload ?? {}) as ExpertPayload;
  const model = p.model ?? 'expert';
  const chars = (p.charCount ?? 0).toLocaleString();

  if (row.status === 'pending') {
    const verb = p.phase === 'answer' ? 'answering' : 'thinking';
    return (
      <span className="artefact-pill" data-state="building">
        <span className="artefact-pill-ic" aria-hidden>
          ↑
        </span>
        <span className="artefact-pill-ttl">{model}</span>
        <span className="artefact-pill-sub">
          {verb} · {chars} chars
        </span>
        <span className="artefact-pill-bar">
          <i />
        </span>
      </span>
    );
  }

  if (row.status === 'failed') {
    return (
      <span className="artefact-pill" data-state="tombstone" aria-disabled>
        <span className="artefact-pill-ic" aria-hidden>
          ↑
        </span>
        <span className="artefact-pill-ttl">expert · {model}</span>
        <span className="artefact-pill-sub">{p.error ?? 'failed'}</span>
      </span>
    );
  }

  // Completed — use the same expandable structure as the generic Pill for visual parity.
  // Class names mirror Pill.tsx: pill-wrap > button.pill > pill-icon + label,
  // then pill-detail > pill-detail-code (question) + pill-detail-result (answer).
  const question = questionOf(p);
  return (
    <span className="pill-wrap">
      <button
        type="button"
        className="pill"
        data-pill-kind="tool-call"
        data-pill-status="completed"
        data-pill-expandable
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="pill-icon" aria-hidden>
          ↑
        </span>
        Asked expert · {model}
      </button>
      {expanded ? (
        <span className="pill-detail">
          {question && <code className="pill-detail-code">{question}</code>}
          {p.result !== undefined && <code className="pill-detail-result">{p.result}</code>}
        </span>
      ) : null}
    </span>
  );
}
