// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { PersonaRow } from '../../boot/client-data-db.js';
import { FONT_VAR } from '../../lib/persona-font.js';
import type { ResolvedMindspace } from '../../state/mindspace-resolver.js';

/** Persona font slug — re-projected from PersonaRow to keep this component's
 *  prop surface stable even if the row schema gains fields later. */
type PersonaFont = PersonaRow['font'];

export interface ReasoningPillProps {
  text: string;
  isLive: boolean;
  isStreamingDraft: boolean;
  mindspace: ResolvedMindspace;
  font: PersonaFont;
}

/**
 * Closed/open chain-of-thought pill. Closed: three sequentially-pulsing
 * dots + chevron; the dot pulse animates only while `isLive`. Open: body
 * renders the trace in the persona font with `white-space: pre-wrap`.
 *
 * Background saturation is locked: 18% mindspace-accent on the handle,
 * 8% on the body (spec §7, brainstorm visual companion). The mindspace
 * prop is accepted for future per-pill overrides; today the accent flows
 * via the `--mindspace-accent` CSS var set by `<MindspaceLayer>`.
 *
 * Open state is local to each pill (spec §2 Decision 12) — orthogonal
 * to the message-level expanded-pills toggle.
 */
export function ReasoningPill(p: ReasoningPillProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const personaFont = FONT_VAR[p.font];

  // `mindspace` and `isStreamingDraft` are reserved by the prop contract;
  // referencing them as void here silences `noUnusedParameters` without
  // narrowing the public API.
  void p.mindspace;
  void p.isStreamingDraft;

  const handle = (
    <button
      type="button"
      className="reasoning-pill"
      data-state={open ? 'open' : 'closed'}
      data-live={p.isLive ? 'true' : 'false'}
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
    >
      <span className="reasoning-pill-dots" data-testid="reasoning-pill-dots" aria-hidden="true">
        <span className="dot">·</span>
        <span className="dot">·</span>
        <span className="dot">·</span>
      </span>
      <svg
        className="reasoning-pill-chevron"
        width="10"
        height="10"
        viewBox="0 0 10 10"
        aria-hidden="true"
      >
        <path
          d="M2 1 L7 5 L2 9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {p.isLive && (
        <span className="sr-only" aria-live="polite">
          Model is thinking
        </span>
      )}
    </button>
  );

  if (!open) return handle;

  return (
    <div className="reasoning-pill-open">
      {handle}
      <section
        className="reasoning-pill-body"
        aria-label="Reasoning trace"
        style={{ fontFamily: personaFont, whiteSpace: 'pre-wrap' }}
      >
        {p.text}
      </section>
    </div>
  );
}
