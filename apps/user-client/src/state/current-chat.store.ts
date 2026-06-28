// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';
import type { ReasoningState } from '../lib/reasoning-resolver.js';

export interface ChatHeader {
  personaId: string;
  name: string;
  colour: string;
  title: string;
}

interface CurrentChatStore {
  chatId: string | null;
  pendingPersonaId: string | null;
  expandedMessageId: string | null;
  autoFollowEnabled: boolean;
  isInteractionMode: boolean;
  isLiveVoice: boolean;
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
  /** Persona + title of the active chat, published by chat-page for the
   *  read-only brand bar. `null` when not in a chat. */
  chatHeader: ChatHeader | null;
  reasoning: ReasoningState;
  webSearchTierId: string | null;
  askExpert: boolean;
  /** Artefact lightbox: the id of the artefact currently open, or null. */
  openArtefactId: string | null;
  /** Whether the artefact sidebar sheet is open. */
  isArtefactSheetOpen: boolean;

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
  setLiveVoice: (on: boolean) => void;
  setInputFocused: (focused: boolean) => void;
  setChatPersonaIsAdult: (isAdult: boolean | null) => void;
  setChatHeader: (header: ChatHeader | null) => void;
  togglePin: () => void;
  setReasoning: (r: ReasoningState) => void;
  setWebSearchTierId: (id: string | null) => void;
  setAskExpert: (on: boolean) => void;
  /** Open an artefact in the lightbox; closes the sidebar sheet. */
  openArtefact: (id: string) => void;
  /** Close the artefact lightbox. */
  closeArtefact: () => void;
  /** Open or close the artefact sidebar sheet. */
  setArtefactSheetOpen: (open: boolean) => void;
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
  | 'setLiveVoice'
  | 'setInputFocused'
  | 'setChatPersonaIsAdult'
  | 'setChatHeader'
  | 'togglePin'
  | 'setReasoning'
  | 'setWebSearchTierId'
  | 'setAskExpert'
  | 'openArtefact'
  | 'closeArtefact'
  | 'setArtefactSheetOpen'
  | 'reset'
>;

const initial: InitialState = {
  chatId: null,
  pendingPersonaId: null,
  expandedMessageId: null,
  autoFollowEnabled: true,
  isInteractionMode: false,
  isLiveVoice: false,
  isPinned: false,
  inputFocused: false,
  chatPersonaIsAdult: null,
  chatHeader: null,
  reasoning: { kind: 'off' },
  webSearchTierId: null,
  askExpert: false,
  openArtefactId: null,
  isArtefactSheetOpen: false,
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
  setLiveVoice: (on) => set({ isLiveVoice: on }),
  setInputFocused: (focused) => set({ inputFocused: focused }),
  setChatPersonaIsAdult: (isAdult) => set({ chatPersonaIsAdult: isAdult }),
  setChatHeader: (header) => set({ chatHeader: header }),
  togglePin: () => set((s) => ({ isPinned: !s.isPinned })),
  setReasoning: (r) => set({ reasoning: r }),
  setWebSearchTierId: (id) => set({ webSearchTierId: id }),
  setAskExpert: (on) => set({ askExpert: on }),
  openArtefact: (id) => set({ openArtefactId: id, isArtefactSheetOpen: false }),
  closeArtefact: () => set({ openArtefactId: null }),
  setArtefactSheetOpen: (open) => set({ isArtefactSheetOpen: open }),
  reset: () => set({ ...initial }),
}));
