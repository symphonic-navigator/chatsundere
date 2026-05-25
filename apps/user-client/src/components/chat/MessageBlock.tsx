// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react';
import type { ContentBlock, MessageRow, PersonaRow, PillRow } from '../../boot/client-data-db.js';
import { groupAdjacent } from '../../lib/content-blocks.js';
import { FONT_VAR } from '../../lib/persona-font.js';
import type { ResolvedMindspace } from '../../state/mindspace-resolver.js';
import { MessageControls } from './MessageControls.js';
import { Pill } from './Pill.js';
import { ReasoningPill } from './ReasoningPill.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MessageBlockProps {
  message: MessageRow;
  pills: Map<string, PillRow>;
  persona: PersonaRow | null;
  /** Active mindspace for this chat — propagated to ReasoningPill so its
   *  open-body can pick up the resolved accent in future iterations. */
  mindspace: ResolvedMindspace;
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
        {renderBlocks(
          p.message.contentBlocks,
          p.pills,
          p.isStreamingDraft === true,
          p.persona,
          p.mindspace,
        )}
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
  persona: PersonaRow | null,
  mindspace: ResolvedMindspace,
): (JSX.Element | null)[] {
  // Partition into ordered runs of same-type blocks — one component per run.
  // Pills never coalesce (their `pillId` identity is load-bearing); text and
  // reasoning runs merge into a single span / pill respectively.
  const groups = groupAdjacent(blocks);

  // Only the LAST reasoning group of a streaming-draft message wears the
  // live indicator. Finalised messages (and all earlier groups within a
  // live draft) animate-out.
  const lastReasoningIdx = isStreamingDraft
    ? groups.map((g) => g.type).lastIndexOf('reasoning')
    : -1;

  // During streaming, the stream-manager pushes one text block per upstream
  // chunk (no coalescing). Each block becomes its own DOM span inside the
  // group span; React mounts only the newest span on each token arrival, so
  // the `.token-fade` keyframe plays exactly once per chunk.
  const textClass = isStreamingDraft ? 'token-fade' : undefined;
  // Reasoning needs a font; the prop type allows persona=null (greeting /
  // empty chat surface), so fall back to 'serif' — the default user font.
  const reasoningFont: PersonaRow['font'] = persona?.font ?? 'serif';

  return groups.map((group, idx) => {
    if (group.type === 'text') {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: groups have no stable id; the group index is stable across token appends (append-only)
        <span key={`g-${idx}`}>
          {group.blocks.map((b, j) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: see above — per-chunk spans are append-only within their group
              key={`t-${idx}-${j}`}
              className={textClass}
            >
              {(b as { type: 'text'; text: string }).text}
            </span>
          ))}
        </span>
      );
    }
    if (group.type === 'reasoning') {
      const trace = group.blocks
        .map((b) => (b as { type: 'reasoning'; text: string }).text)
        .join('');
      return (
        <ReasoningPill
          // biome-ignore lint/suspicious/noArrayIndexKey: group ordering is stable across appends
          key={`g-${idx}`}
          text={trace}
          isLive={idx === lastReasoningIdx}
          isStreamingDraft={isStreamingDraft}
          mindspace={mindspace}
          font={reasoningFont}
        />
      );
    }
    // 'pill' — single-block group (pills never coalesce; one PillRow per group).
    const pillBlock = group.blocks[0] as { type: 'pill'; pillId: string };
    const pill = pills.get(pillBlock.pillId);
    return pill ? <Pill key={`p-${pillBlock.pillId}`} row={pill} /> : null;
  });
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} · ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
