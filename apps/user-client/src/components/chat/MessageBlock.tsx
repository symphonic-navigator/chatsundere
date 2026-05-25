// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react';
import type { ContentBlock, MessageRow, PersonaRow, PillRow } from '../../boot/client-data-db.js';
import { MessageControls } from './MessageControls.js';
import { Pill } from './Pill.js';

const FONT_VAR: Record<'sans' | 'serif' | 'cursive', string> = {
  sans: 'var(--font-sans)',
  serif: 'var(--font-display)',
  cursive: 'var(--font-display)',
};

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
}

/** Renders a single chat message row with optional expanded controls. */
export function MessageBlock(p: MessageBlockProps): JSX.Element {
  const isUser = p.message.role === 'user';
  const roleClass = isUser ? 'from-user' : 'from-persona';
  const nameText = isUser ? p.displayName : (p.persona?.name ?? '');
  const nameStyle: React.CSSProperties = isUser
    ? {}
    : {
        color: p.persona?.colour,
        fontFamily: p.persona ? FONT_VAR[p.persona.font] : undefined,
      };

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
        {nameText}
      </div>
      {p.expanded ? (
        <div className="msg-timestamp">{formatTimestamp(p.message.createdAt)}</div>
      ) : null}
      <div className="msg-text">{renderBlocks(p.message.contentBlocks, p.pills)}</div>
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

function renderBlocks(blocks: ContentBlock[], pills: Map<string, PillRow>): (JSX.Element | null)[] {
  return blocks.map((b, i) => {
    // biome-ignore lint/suspicious/noArrayIndexKey: content blocks have no stable id; index is the correct key here
    if (b.type === 'text') return <span key={`t-${i}`}>{b.text}</span>;
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
