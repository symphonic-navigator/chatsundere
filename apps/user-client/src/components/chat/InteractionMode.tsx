import type { Offering } from '@chatsundere/llm-unified';
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react';
import type { AttachmentRow, ChatRow, PersonaRow } from '../../boot/client-data-db.js';
import { resolveContextWindow } from '../../lib/context-window.js';
import type { Dictation } from '../../lib/voice/dictation/use-dictation.js';
import { useCurrentChatStore } from '../../state/current-chat.store.js';
import { useEffectiveChatMode } from '../../state/effective-chat-mode.js';
import { Cockpit } from './Cockpit.js';
import { InteractionTopbar } from './InteractionTopbar.js';

interface Props {
  persona: PersonaRow;
  /** The active chat's id (empty string while a lazy chat has not yet been created on first send). */
  chatId: string;
  chat: ChatRow | null;
  /** Null when the chat's model cannot be resolved (removed provider/model).
   *  The topbar still mounts — it is the repair path — but the cockpit needs a
   *  model to compose against and stays absent (spec 2026-07-18 §5.6). */
  offering: Offering | null;
  usedTokens: number;
  draftValue: string;
  onDraftChange: (v: string) => void;
  onSend: (text: string) => void;
  /**
   * Non-null when this chat's composer is editing an existing message (spec
   * 2026-07-18). Required — see the matching doc comment on Cockpit's Props.
   * Pure pass-through to Cockpit here.
   */
  editingMessageId: string | null;
  /** Whether Replace-in-place is available (derived: the edited message is still last). */
  canReplace: boolean;
  /** The edit view of attachments (originals − staged removals + additions). */
  editAttachments: AttachmentRow[];
  onReplace: () => void;
  onBranchEdit: () => void;
  onCancelEdit: () => void;
  onStop: () => void;
  isStreamLive: boolean;
  onExit: () => void;
  onRenameChat: (next: string | null) => void;
  onOpenPersonaEditor?: () => void;
  onAttachFromTreasury?: () => void;
  onAttachFromLibrary?: () => void;
  /** Dictation surface — connected in chat-page via useDictation (spec 2026-06-12 §3). */
  dictation: Dictation;
  /** Voice-mode (auto-read-aloud) on/off — global setting. */
  autoReadAloud: boolean;
  onToggleAutoRead: (next: boolean) => void;
  /** Why read-aloud is unavailable, or null when a voice is configured. */
  voiceUnavailable: 'no-provider' | 'no-voice' | null;
  /** Opens live voice mode — forwarded to the cockpit's live button. */
  onEnterLiveVoice?: () => void;
  /** Whether the conversation meets compaction preconditions. */
  compactable?: boolean;
  /** Called when the user taps the context gauge to request compaction. */
  onCompact?: () => void;
}

/**
 * Overlay layer that composes Topbar + Cockpit, drives the DimOverlay focus
 * flag (the overlay itself renders at chat-page level), and owns the three
 * auto-close triggers (§6.3 Decision 16):
 *
 * 1. Send-tap with non-empty input → close after 100 ms (visual clear first).
 * 2. Outside-tap (pointerdown outside the InteractionMode DOM tree) → close immediately.
 * 3. Blur + next outside-tap → close on that outside-tap.
 *
 * Trigger 3 is handled naturally by trigger 2: the outside-tap listener fires
 * for any pointerdown outside the container, regardless of whether a blur
 * preceded it. The `blurArmedRef` is intentionally retained as documentation
 * of the design decision but is NOT checked in the listener — trigger 2 already
 * covers both cases. Removing it would require a comment explaining why, which
 * is more verbose than keeping the named ref.
 *
 * Pin (`isPinned`) blocks all three triggers.
 */
export function InteractionMode(p: Props): JSX.Element {
  const { isPinned } = useEffectiveChatMode();
  const setInteractionMode = useCurrentChatStore((s) => s.setInteractionMode);
  const clearExpanded = useCurrentChatStore((s) => s.clearExpanded);
  // DimOverlay activation lives in the store and is rendered at chat-page level
  // (see chat-page.tsx) so the un-dim fade isn't cut short by this component
  // unmounting on close. Here we only drive the focus flag.
  const setInputFocused = useCurrentChatStore((s) => s.setInputFocused);
  const containerRef = useRef<HTMLDivElement>(null);

  // Tracks "blur happened; the next outside-tap is meaningful" — see JSDoc above.
  // Effectively unused in the listener because trigger 2 already handles it.
  const blurArmedRef = useRef(false);

  // Global outside-pointer listener closes when not pinned (triggers 2 + 3).
  // The closing pointerdown is followed by a click — without intercepting it,
  // tapping a message to "close the cockpit" would also expand the message.
  // The click-capture listener is attached *inside* the pointerdown handler
  // (not in this useEffect) so it survives the component's own unmount when
  // setInteractionMode(false) re-renders the parent and tears us down.
  useEffect(() => {
    if (isPinned) return;

    const onPointer = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      if (!target || !containerRef.current) return;
      if (containerRef.current.contains(target)) return;

      // A tap on the brand logo is a deliberate navigation back to the Entrance
      // Hall, not an idle outside-tap: let its click through to React Router
      // rather than swallowing it. Without this the logo is dead while unpinned.
      if (target instanceof Element && target.closest('.brand-logo')) return;

      // The lightbox is portalled to <body>, so it lives outside this container —
      // but a tap inside it is an interaction with the lightbox, not an outside-tap.
      // Without this exemption every click inside the lightbox (e.g. the
      // Preview/Source toggle) would collapse the cockpit and unmount the lightbox
      // (it renders as a Cockpit child), making in-lightbox clicks close it.
      if (target instanceof Element && target.closest('.lightbox-root')) return;

      // Sheet overlays (artefact sidebar, ToC, branch, attach picker) render at
      // chat-page level — outside this container — but a tap inside one is an
      // interaction with that sheet, not an outside-tap. Without this the first tap
      // inside the sheet is swallowed (and the cockpit collapses) instead of reaching
      // the control, so e.g. opening an artefact from the sidebar — or selecting one
      // in the attach picker — over an unpinned cockpit takes two taps.
      if (
        target instanceof Element &&
        target.closest('.branch-sheet-root, .artefact-picker-root, .document-picker-root')
      )
        return;

      // Pointerdown landed outside — close regardless of blur state.
      blurArmedRef.current = false;

      // One-shot click swallower. Attached to document directly so the
      // upcoming click event is intercepted even after this component
      // unmounts as a consequence of setInteractionMode(false).
      const swallowClick = (ev: MouseEvent): void => {
        ev.stopPropagation();
        ev.preventDefault();
        document.removeEventListener('click', swallowClick, { capture: true });
      };
      document.addEventListener('click', swallowClick, { capture: true });
      // Safety net: drop the listener if no click follows within 300ms.
      window.setTimeout(() => {
        document.removeEventListener('click', swallowClick, { capture: true });
      }, 300);

      setInteractionMode(false);
    };

    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [isPinned, setInteractionMode]);

  const handleSend = (text: string): void => {
    p.onSend(text);
    if (!isPinned) {
      // Trigger 1: delay 100 ms so the textarea clears visually before the
      // overlay collapses.
      setTimeout(() => setInteractionMode(false), 100);
      return;
    }
    // Pinned: the cockpit stays open and keeps input focus — pinned means the
    // user is set on full interaction, ready to keep typing. The streamed reply
    // is no longer dimmed behind the held focus (the DimOverlay is suppressed
    // while pinned, see chat-page.tsx), so there is no reason to shed focus on
    // send. Unpinned (zen mode) is where dimming and focus-release still apply.
  };

  return (
    <div ref={containerRef} className="interaction-mode">
      <InteractionTopbar
        persona={p.persona}
        chat={p.chat}
        usedTokens={p.usedTokens}
        contextWindow={p.offering ? resolveContextWindow(p.persona, p.offering) : null}
        onExit={p.onExit}
        onRenameChat={p.onRenameChat}
        onOpenPersonaEditor={p.onOpenPersonaEditor}
        compactable={p.compactable}
        onCompact={p.onCompact}
      />
      {/* Capture focus/blur on the textarea to drive DimOverlay activation
          (the overlay itself renders at chat-page level). display: contents so
          this wrapper does not form a box — without it the cockpit's order:1000
          would be scoped to this div instead of hoisting to the .chat-page flex
          column, which would drop the audio toolbar (order 998) below the
          cockpit. Focus/blur capture is unaffected (React events ignore CSS
          display). */}
      {p.offering ? (
        <div
          className="cockpit-focus-capture"
          onFocusCapture={(e) => {
            if ((e.target as HTMLElement).tagName === 'TEXTAREA') {
              setInputFocused(true);
              blurArmedRef.current = false;
              // Reading and writing are separate mental modes: the moment the
              // user starts composing, drop any message they had expanded for
              // reading. Tidies the surface and keeps the two intents distinct.
              clearExpanded();
            }
          }}
          onBlurCapture={(e) => {
            if ((e.target as HTMLElement).tagName === 'TEXTAREA') {
              setInputFocused(false);
              blurArmedRef.current = true;
            }
          }}
        >
          <Cockpit
            chatId={p.chatId}
            persona={p.persona}
            offering={p.offering}
            draftValue={p.draftValue}
            onDraftChange={p.onDraftChange}
            onSend={handleSend}
            editingMessageId={p.editingMessageId}
            canReplace={p.canReplace}
            editAttachments={p.editAttachments}
            onReplace={p.onReplace}
            onBranchEdit={p.onBranchEdit}
            onCancelEdit={p.onCancelEdit}
            onStop={p.onStop}
            isStreamLive={p.isStreamLive}
            onAttachFromTreasury={p.onAttachFromTreasury}
            onAttachFromLibrary={p.onAttachFromLibrary}
            dictation={p.dictation}
            autoReadAloud={p.autoReadAloud}
            onToggleAutoRead={p.onToggleAutoRead}
            voiceUnavailable={p.voiceUnavailable}
            onEnterLiveVoice={p.onEnterLiveVoice}
          />
        </div>
      ) : null}
    </div>
  );
}
