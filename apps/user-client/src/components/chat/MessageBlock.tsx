// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react';
import type { ContentBlock, MessageRow, PersonaRow, PillRow } from '../../boot/client-data-db.js';
import { FONT_VAR } from '../../lib/persona-font.js';
import { MessageControls } from './MessageControls.js';
import { Pill } from './Pill.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MessageBlockProps {
  message: MessageRow;
  pills: Map<string, PillRow>;
  persona: PersonaRow | null;
  displayName: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onCopy: () => void;
  onBookmark: () => void;
  onRegenerate?: () => void;
  /** True while this message is the active streaming draft. Text-block
   *  spans rendered under this flag carry the `token-fade` class so each
   *  freshly-mounted span plays the fade-in keyframe (Grok-style). */
  isStreamingDraft?: boolean;
}

/** Renders a single chat message row with optional expanded controls. */
export function MessageBlock(p: MessageBlockProps): JSX.Element {
  const isUser = p.message.role === 'user';
  const roleClass = isUser ? 'from-user' : 'from-persona';
  const namePrefix = isUser ? '🪶' : '✨';
  const nameText = isUser ? p.displayName : (p.persona?.name ?? '');
  // Persona keeps its accent colour at full strength; the user's name is the
  // same accent but mixed further toward the muted paper tone — quieter than
  // the persona name, but still recognisably "this persona's chat". Both
  // names use the persona's font so the whole chat surface speaks in one
  // typographic voice (continuation of the iter-2 .msg-text decision).
  const personaColour = p.persona?.colour;
  const personaFont = p.persona ? FONT_VAR[p.persona.font] : undefined;
  const nameStyle: React.CSSProperties = isUser
    ? {
        fontFamily: personaFont,
        ...(personaColour
          ? { color: `color-mix(in srgb, ${personaColour} 38%, var(--color-paper-soft) 62%)` }
          : {}),
      }
    : { color: personaColour, fontFamily: personaFont };

  // When this message is freshly expanded, scroll its controls (rendered at
  // the bottom) into view. Without this, expanding a message near the
  // viewport edge leaves the new controls hidden behind the cockpit or
  // chat-stream boundary.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!p.expanded) return;
    // scrollIntoView is unimplemented in jsdom — guard so unit tests don't
    // explode. The real browser always has it.
    ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [p.expanded]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: message block is a touch-first tap target — keyboard nav handled at chat-list level
    <div
      ref={ref}
      className={`msg ${roleClass}${p.expanded ? ' expanded' : ''}`}
      data-msg-id={p.message.id}
      data-bookmarked={p.message.bookmarked || undefined}
      onClick={p.onToggleExpand}
    >
      <div className="msg-name" style={nameStyle}>
        <span className="msg-name-prefix" aria-hidden="true">
          {namePrefix}
        </span>
        <span className="msg-name-text">{nameText}</span>
      </div>
      {p.expanded ? (
        <div className="msg-timestamp">{formatTimestamp(p.message.createdAt)}</div>
      ) : null}
      <div
        className="msg-text"
        style={p.persona ? { fontFamily: FONT_VAR[p.persona.font] } : undefined}
      >
        {renderBlocks(p.message.contentBlocks, p.pills, p.isStreamingDraft === true)}
      </div>
      {p.expanded ? (
        <MessageControls
          message={p.message}
          onCopy={p.onCopy}
          onBookmark={p.onBookmark}
          onRegenerate={p.onRegenerate}
        />
      ) : null}
    </div>
  );
}

function renderBlocks(
  blocks: ContentBlock[],
  pills: Map<string, PillRow>,
  isStreamingDraft: boolean,
): (JSX.Element | null)[] {
  // During streaming, the stream-manager pushes one text block per upstream
  // chunk (no coalescing). Each block then becomes its own DOM span with a
  // stable per-index key — React mounts only the newest span on each token
  // arrival, so the `.token-fade` keyframe plays exactly once per chunk.
  const textClass = isStreamingDraft ? 'token-fade' : undefined;
  return blocks.map((b, i) => {
    if (b.type === 'text')
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: content blocks have no stable id; index is the correct key here — appending tokens stays append-only so prior keys are preserved
        <span key={`t-${i}`} className={textClass}>
          {b.text}
        </span>
      );
    const pill = pills.get(b.pillId);
    return pill ? <Pill key={`p-${b.pillId}`} row={pill} /> : null;
  });
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} · ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
