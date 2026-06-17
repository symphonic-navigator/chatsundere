// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { PersonaRow } from '../../boot/client-data-db.js';
import { FONT_VAR } from '../../lib/persona-font.js';
import type { ResolvedMindspace } from '../../state/mindspace-resolver.js';

/** Persona font slug — re-projected from PersonaRow to keep this component's
 *  prop surface stable even if the row schema gains fields later. */
type PersonaFont = PersonaRow['font'];

/** Inner-monologue read controller threaded from the chat page. */
export interface MonologueController {
  read: (id: string, trace: string) => void;
  activeId: string | null;
  disabledReason: 'no-voice' | null;
  /** Set when reading is suppressed by mode (live voice) — button renders disabled with that reason. */
  suppressedReason: 'live-voice' | null;
}

export interface ReasoningPillProps {
  text: string;
  isLive: boolean;
  isStreamingDraft: boolean;
  mindspace: ResolvedMindspace;
  font: PersonaFont;
  /** Stable id for this reasoning group (e.g. `${messageId}:${groupIdx}`). */
  monologueId: string;
  /** Inner-monologue read controller, or null when unavailable. */
  monologue: MonologueController | null;
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

  // `mindspace` is reserved by the prop contract; referencing it as void here
  // silences `noUnusedParameters` without narrowing the public API.
  void p.mindspace;

  const m = p.monologue;
  const streaming = p.isLive || p.isStreamingDraft;
  const disabledReason: string | null =
    m === null
      ? 'Inner monologue is unavailable here.'
      : m.suppressedReason === 'live-voice'
        ? 'Not during live voice.'
        : streaming
          ? 'Available once the thought is complete.'
          : m.disabledReason === 'no-voice'
            ? 'Add a read-aloud voice in My Settings → Voice to hear this.'
            : null;
  const isPlaying = m?.activeId === p.monologueId;

  const handle = (
    <button
      type="button"
      className="reasoning-pill"
      data-state={open ? 'open' : 'closed'}
      data-live={p.isLive ? 'true' : 'false'}
      aria-expanded={open}
      onClick={(e) => {
        // Pills are inside the message-block tap target — stop the click from
        // bubbling so opening the trace never also expands/activates the
        // message. Same pattern applies to any future clickable in-message
        // affordance.
        e.stopPropagation();
        setOpen((v) => !v);
      }}
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
      <button
        type="button"
        className="reasoning-pill-monologue"
        data-playing={isPlaying ? 'true' : 'false'}
        disabled={disabledReason !== null}
        title={disabledReason ?? (isPlaying ? 'Stop' : 'Read this thought aloud')}
        aria-label={isPlaying ? 'Stop inner monologue' : 'Read this thought aloud'}
        onClick={(e) => {
          e.stopPropagation();
          if (disabledReason === null && m) m.read(p.monologueId, p.text);
        }}
      >
        {/* simple speaker glyph — visible affordance, present whenever the pill is open */}
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M2 5 H4 L7 2 V12 L4 9 H2 Z M10 4 Q12 7 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
