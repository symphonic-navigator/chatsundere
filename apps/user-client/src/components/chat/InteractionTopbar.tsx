// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import type { ChatRow, PersonaRow } from '../../boot/client-data-db.js';
import { displayTitle } from '../../lib/chat-title.js';
import { sanitiseTitle } from '../../lib/title-generator.js';
import { contextUtilisation } from '../../lib/token-estimator.js';
import { PersonaAvatar } from '../PersonaAvatar.js';

interface Props {
  persona: PersonaRow;
  chat: ChatRow | null;
  usedTokens: number;
  contextWindow: number;
  onExit: () => void;
  onRenameChat: (next: string | null) => void;
  onOpenPersonaEditor?: () => void;
  /** Name of the project this chat belongs to. Projects are not yet modelled,
   *  so this is `null`/absent today and the slot shows a muted placeholder —
   *  reserving the space (in the persona's accent + display font) for when the
   *  feature lands. */
  projectName?: string | null;
}

export function InteractionTopbar(p: Props): JSX.Element {
  const pct = contextUtilisation(p.usedTokens, p.contextWindow);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Escape sets this to true so the blur handler that immediately
  // follows the unmount doesn't re-save the in-progress draft.
  const discardRef = useRef(false);

  function startEdit(): void {
    if (!p.chat) return;
    discardRef.current = false;
    setDraft(p.chat.title ?? '');
    setIsEditing(true);
  }

  function commit(value: string): void {
    p.onRenameChat(sanitiseTitle(value));
    setIsEditing(false);
  }

  function cancel(): void {
    discardRef.current = true;
    setIsEditing(false);
  }

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  return (
    <div className="interaction-topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="hamburger-btn"
          aria-label="Exit to Entrance Hall"
          onClick={p.onExit}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            width="24"
            height="24"
            aria-hidden="true"
          >
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <button
          type="button"
          className="topbar-avatar-btn"
          aria-label={`Open ${p.persona.name} settings`}
          onClick={p.onOpenPersonaEditor}
          disabled={!p.onOpenPersonaEditor}
        >
          <PersonaAvatar
            personaId={p.persona.id}
            name={p.persona.name}
            colour={p.persona.colour}
            size={36}
          />
        </button>
      </div>

      <div className="topbar-center">
        {p.chat ? (
          isEditing ? (
            <input
              ref={inputRef}
              className="topbar-title-input"
              type="text"
              value={draft}
              maxLength={60}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit(draft);
                else if (e.key === 'Escape') cancel();
              }}
              onBlur={() => {
                if (!discardRef.current) commit(draft);
              }}
            />
          ) : (
            <button
              type="button"
              className="topbar-title-btn"
              aria-label="Rename chat"
              onClick={startEdit}
            >
              <span className="topbar-title">{displayTitle(p.chat)}</span>
              <span aria-hidden className="topbar-pencil">
                🖎
              </span>
            </button>
          )
        ) : (
          <div className="topbar-title-placeholder" aria-hidden>
            New chat
          </div>
        )}
        <div
          className="topbar-project"
          style={{ color: p.persona.colour }}
          data-empty={p.projectName ? undefined : 'true'}
          title={p.projectName ?? 'No project'}
        >
          {p.projectName ?? '(no project)'}
        </div>
      </div>

      <div className="topbar-right">
        <div className="status-group">
          <div className="journal-indicator" title="Uncommitted journal entries">
            <span className="journal-dot" />
            <span>0</span>
          </div>
          <div className="context-gauge" title="Context window">
            <div className="context-gauge-bar">
              <div className="context-gauge-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="context-gauge-text">{pct}%</div>
          </div>
        </div>
      </div>
    </div>
  );
}
