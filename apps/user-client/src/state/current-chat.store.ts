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
  /** Constructive message shown inline when a configured artefact expert was
   *  unreachable for the last artefact attempt; null = no note. Surfaced
   *  independent of the persona's own relay (spec §3.4). */
  artefactExpertError: string | null;
  /** Artefact lightbox: the id of the artefact currently open, or null. */
  openArtefactId: string | null;
  /** Edit-session transient state (spec 2026-07-18 §8). Never persisted; the
   *  edit *target* lives on ChatRow.editingMessageId, but the staged
   *  attachment removals are in-session only. */
  editStagedRemovals: string[];

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
  setArtefactExpertError: (message: string | null) => void;
  /** Open an artefact in the lightbox. */
  openArtefact: (id: string) => void;
  /** Close the artefact lightbox. */
  closeArtefact: () => void;
  /** Stage an attachment id for removal on commit (undo-able via unstageRemoval). */
  stageRemoval: (id: string) => void;
  /** Undo a staged attachment removal. */
  unstageRemoval: (id: string) => void;
  /** Clear all staged removals. Called on enter-edit, cancel, and commit. */
  resetEditSession: () => void;
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
  | 'setArtefactExpertError'
  | 'openArtefact'
  | 'closeArtefact'
  | 'stageRemoval'
  | 'unstageRemoval'
  | 'resetEditSession'
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
  artefactExpertError: null,
  openArtefactId: null,
  editStagedRemovals: [],
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
  setArtefactExpertError: (message) => set({ artefactExpertError: message }),
  openArtefact: (id) => set({ openArtefactId: id }),
  closeArtefact: () => set({ openArtefactId: null }),
  stageRemoval: (id) =>
    set((s) =>
      s.editStagedRemovals.includes(id) ? s : { editStagedRemovals: [...s.editStagedRemovals, id] },
    ),
  unstageRemoval: (id) =>
    set((s) => ({ editStagedRemovals: s.editStagedRemovals.filter((x) => x !== id) })),
  resetEditSession: () => set({ editStagedRemovals: [] }),
  reset: () => set({ ...initial }),
}));
