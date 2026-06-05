import type { Offering } from '@chatsundere/llm-unified';
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import type { PersonaRow } from '../../boot/client-data-db.js';
import type { ReasoningState } from '../../lib/reasoning-resolver.js';
import { useActiveSearchTiers } from '../../lib/use-active-search-tiers.js';
import { useCurrentChatStore } from '../../state/current-chat.store.js';
import { AutoSizeTextarea } from '../AutoSizeTextarea.js';
import { CockpitMenu } from './CockpitMenu.js';
import { DualActionBtn } from './DualActionBtn.js';

interface Props {
  persona: PersonaRow;
  offering: Offering;
  draftValue: string;
  onDraftChange: (v: string) => void;
  onSend: (text: string) => void;
  isStreamLive: boolean;
}

export function Cockpit(p: Props): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const isPinned = useCurrentChatStore((s) => s.isPinned);
  const togglePin = useCurrentChatStore((s) => s.togglePin);
  const setInteractionMode = useCurrentChatStore((s) => s.setInteractionMode);
  const reasoning = useCurrentChatStore((s) => s.reasoning);
  const setReasoning = useCurrentChatStore((s) => s.setReasoning);
  const searchTiers = useActiveSearchTiers();
  const searchTierId = useCurrentChatStore((s) => s.webSearchTierId);
  const setSearchTierId = useCurrentChatStore((s) => s.setWebSearchTierId);

  // Close the menu when the user clicks anywhere outside the wrap, or presses
  // Escape. Without this the menu had no close path: the toggle button only
  // toggled by re-clicking the same icon, and clicks on chips left it open.
  const menuWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointer = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      if (!target || !menuWrapRef.current) return;
      if (menuWrapRef.current.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Selecting a reasoning option also dismisses the menu — the user has made
  // their choice; keeping it open is busy-noise.
  const onReasoningChange = (r: ReasoningState): void => {
    setReasoning(r);
    setMenuOpen(false);
  };

  // Send affordances (ADR/CLAUDE.md §4: 1024px is the single desktop boundary):
  //   - Desktop: plain Enter sends, Shift+Enter inserts a newline.
  //   - Everywhere (desktop + mobile): Ctrl/Cmd+Enter sends — the fast keyboard
  //     path Chris uses while testing the desktop build in the browser, and the
  //     only keyboard send on mobile (plain Enter there inserts a newline; the
  //     DualActionBtn is the touch send).
  // We never send while a stream is live or the draft is blank (mirrors the
  // button's enabled state).
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter') return;
    const ctrlEnter = e.ctrlKey || e.metaKey;
    const desktopPlainEnter =
      !ctrlEnter && !e.shiftKey && window.matchMedia('(min-width: 1024px)').matches;
    if (!ctrlEnter && !desktopPlainEnter) return;
    if (p.isStreamLive || p.draftValue.trim().length === 0) return;
    e.preventDefault();
    p.onSend(p.draftValue);
  };

  // Pin toggle. Un-pinning with an empty draft is a "let me just read" signal:
  // drop straight back to reading mode rather than leaving an empty cockpit
  // hovering. With text in the draft we keep the cockpit so nothing is lost.
  const onTogglePin = (): void => {
    const willUnpin = isPinned;
    togglePin();
    if (willUnpin && p.draftValue.trim().length === 0) {
      setInteractionMode(false);
    }
  };

  return (
    <div className="cockpit" data-pinned={isPinned ? 'true' : 'false'}>
      <div className="cockpit-row-controls">
        <button
          type="button"
          className="cockpit-icon-btn"
          data-control="plus"
          disabled
          title="Coming with Treasury"
          aria-label="Treasury (coming soon)"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <div ref={menuWrapRef} className="cockpit-menu-wrap">
          <button
            type="button"
            className="cockpit-icon-btn"
            data-control="menu"
            aria-label="Open chat menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </button>
          {menuOpen ? (
            <CockpitMenu
              control={p.offering.profile.reasoning}
              reasoning={reasoning}
              onReasoningChange={onReasoningChange}
              searchTiers={searchTiers}
              searchTierId={searchTierId}
              onSearchTierChange={setSearchTierId}
              onClose={() => setMenuOpen(false)}
            />
          ) : null}
        </div>
        <button
          type="button"
          className="cockpit-icon-btn"
          data-control="live"
          disabled
          title="Voice arrives with Block 4"
          aria-label="Live voice mode (coming with Block 4)"
        >
          <span className="wave-icon" aria-hidden="true">
            ≈
          </span>
        </button>
        <div className="cockpit-controls-spacer" />
        <button
          type="button"
          className={`cockpit-icon-btn${isPinned ? ' active' : ''}`}
          data-control="pin"
          aria-label={isPinned ? 'Unpin cockpit' : 'Pin cockpit'}
          aria-pressed={isPinned}
          onClick={onTogglePin}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M12 2v10M8 14l4-4 4 4M6 22h12" />
          </svg>
        </button>
      </div>
      <div className="cockpit-row-input">
        <AutoSizeTextarea
          value={p.draftValue}
          onChange={p.onDraftChange}
          placeholder={`Speak to ${p.persona.name}…`}
          maxRows={6}
          className="cockpit-input"
          autoFocus
          onKeyDown={onInputKeyDown}
        />
        <DualActionBtn
          hasText={p.draftValue.trim().length > 0}
          isStreamLive={p.isStreamLive}
          personaName={p.persona.name}
          onSend={() => p.onSend(p.draftValue)}
        />
      </div>
    </div>
  );
}
