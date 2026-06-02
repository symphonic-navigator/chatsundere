import type { Offering } from '@chatsundere/llm-unified';
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react';
import type { ChatRow, PersonaRow } from '../../boot/client-data-db.js';
import { resolveContextWindow } from '../../lib/context-window.js';
import { useCurrentChatStore } from '../../state/current-chat.store.js';
import { Cockpit } from './Cockpit.js';
import { InteractionTopbar } from './InteractionTopbar.js';

interface Props {
  persona: PersonaRow;
  chat: ChatRow | null;
  offering: Offering;
  usedTokens: number;
  draftValue: string;
  onDraftChange: (v: string) => void;
  onSend: (text: string) => void;
  isStreamLive: boolean;
  onExit: () => void;
  onRenameChat: (next: string | null) => void;
  onOpenPersonaEditor?: () => void;
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
  const isPinned = useCurrentChatStore((s) => s.isPinned);
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
    // Pinned: the cockpit stays open, but we deliberately release input focus so
    // the user lands back in reading mode (DimOverlay off) and can read the reply
    // as it streams — rather than the input holding focus and dimming the
    // response. Focus returns only when the user taps the input again. This is
    // our slower, focus-led approach: dim what the user is not currently using.
    if (document.activeElement instanceof HTMLTextAreaElement) {
      document.activeElement.blur();
    }
  };

  return (
    <div ref={containerRef} className="interaction-mode">
      <InteractionTopbar
        persona={p.persona}
        chat={p.chat}
        usedTokens={p.usedTokens}
        contextWindow={resolveContextWindow(p.persona, p.offering)}
        onExit={p.onExit}
        onRenameChat={p.onRenameChat}
        onOpenPersonaEditor={p.onOpenPersonaEditor}
      />
      {/* Capture focus/blur on the textarea to drive DimOverlay activation
          (the overlay itself renders at chat-page level). */}
      <div
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
          persona={p.persona}
          offering={p.offering}
          draftValue={p.draftValue}
          onDraftChange={p.onDraftChange}
          onSend={handleSend}
          isStreamLive={p.isStreamLive}
        />
      </div>
    </div>
  );
}
