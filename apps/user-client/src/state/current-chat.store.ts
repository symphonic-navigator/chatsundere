// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';
import type { ReasoningState } from '../lib/reasoning-resolver.js';

interface CurrentChatStore {
  chatId: string | null;
  pendingPersonaId: string | null;
  expandedMessageId: string | null;
  autoFollowEnabled: boolean;
  isInteractionMode: boolean;
  isPinned: boolean;
  /** True while the cockpit textarea holds focus. Drives the DimOverlay, which
   *  lives at chat-page level (not inside InteractionMode) so the un-dim fade
   *  survives the moment InteractionMode unmounts on close. */
  inputFocused: boolean;
  /** Whether the active chat's persona is adult, published by chat-page.
   *  `null` = not in a chat. The brand-bar AdultModeToggle hides itself when
   *  this is `false` (chat view + SFW persona) for a calmer screen — see
   *  AdultModeToggle. Shown otherwise (`null` outside chats, `true` for an
   *  adult persona where the mode indicator is still wanted). */
  chatPersonaIsAdult: boolean | null;
  /** Reading-mode floating tool-strip: separate from `isPinned` (the cockpit). */
  isToolStripExpanded: boolean;
  isToolStripPinned: boolean;
  reasoning: ReasoningState;

  /** Open a persisted chat by ID. Clears any pending lazy-open persona. */
  setChatId: (id: string | null) => void;
  /** Lazy-open: record which persona to use when the chat is created. */
  setLazy: (personaId: string) => void;
  /** Toggle a single expanded message. Opening a new one closes the previous. */
  toggleExpanded: (messageId: string) => void;
  /** Clear any expanded-message selection. Used when the compose intent takes
   *  over (e.g. the prompt input gains focus): reading and writing are separate
   *  mental modes, so focusing the cockpit tidies the reading selection away. */
  clearExpanded: () => void;
  setAutoFollow: (enabled: boolean) => void;
  setInteractionMode: (on: boolean) => void;
  setInputFocused: (focused: boolean) => void;
  setChatPersonaIsAdult: (isAdult: boolean | null) => void;
  togglePin: () => void;
  setToolStripExpanded: (open: boolean) => void;
  toggleToolStripPin: () => void;
  /** Collapse the strip unless the user pinned it open. */
  collapseToolStripIfUnpinned: () => void;
  setReasoning: (r: ReasoningState) => void;
  /** Reset all ephemeral state to initial defaults. */
  reset: () => void;
}

type InitialState = Omit<
  CurrentChatStore,
  | 'setChatId'
  | 'setLazy'
  | 'toggleExpanded'
  | 'clearExpanded'
  | 'setAutoFollow'
  | 'setInteractionMode'
  | 'setInputFocused'
  | 'setChatPersonaIsAdult'
  | 'togglePin'
  | 'setToolStripExpanded'
  | 'toggleToolStripPin'
  | 'collapseToolStripIfUnpinned'
  | 'setReasoning'
  | 'reset'
>;

const initial: InitialState = {
  chatId: null,
  pendingPersonaId: null,
  expandedMessageId: null,
  autoFollowEnabled: true,
  isInteractionMode: false,
  isPinned: false,
  inputFocused: false,
  chatPersonaIsAdult: null,
  isToolStripExpanded: false,
  isToolStripPinned: false,
  reasoning: { kind: 'off' },
};

export const useCurrentChatStore = create<CurrentChatStore>((set) => ({
  ...initial,
  setChatId: (id) => set({ chatId: id, pendingPersonaId: null }),
  setLazy: (personaId) => set({ chatId: null, pendingPersonaId: personaId }),
  toggleExpanded: (id) =>
    set((s) => ({ expandedMessageId: s.expandedMessageId === id ? null : id })),
  clearExpanded: () => set({ expandedMessageId: null }),
  setAutoFollow: (enabled) => set({ autoFollowEnabled: enabled }),
  setInteractionMode: (on) =>
    // Opening the cockpit collapses any expanded-message state. The user's
    // attention shifts to the new compose intent; leaving an old message
    // expanded would (a) clutter the smaller chat surface and (b) interact
    // badly with scrollIntoView, which can fight cockpit-open layout shifts.
    // inputFocused is reset on every mode flip: opening starts un-dimmed until
    // the cockpit autofocuses (which re-dims), and closing clears it so the
    // chat-page-level DimOverlay fades back out cleanly.
    set(
      on
        ? { isInteractionMode: true, expandedMessageId: null, inputFocused: false }
        : { isInteractionMode: false, inputFocused: false },
    ),
  setInputFocused: (focused) => set({ inputFocused: focused }),
  setChatPersonaIsAdult: (isAdult) => set({ chatPersonaIsAdult: isAdult }),
  togglePin: () => set((s) => ({ isPinned: !s.isPinned })),
  setToolStripExpanded: (open) => set({ isToolStripExpanded: open }),
  toggleToolStripPin: () => set((s) => ({ isToolStripPinned: !s.isToolStripPinned })),
  collapseToolStripIfUnpinned: () =>
    set((s) => (s.isToolStripPinned ? {} : { isToolStripExpanded: false })),
  setReasoning: (r) => set({ reasoning: r }),
  reset: () => set({ ...initial }),
}));
