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
  reasoning: ReasoningState;

  /** Open a persisted chat by ID. Clears any pending lazy-open persona. */
  setChatId: (id: string | null) => void;
  /** Lazy-open: record which persona to use when the chat is created. */
  setLazy: (personaId: string) => void;
  /** Toggle a single expanded message. Opening a new one closes the previous. */
  toggleExpanded: (messageId: string) => void;
  setAutoFollow: (enabled: boolean) => void;
  setInteractionMode: (on: boolean) => void;
  togglePin: () => void;
  setReasoning: (r: ReasoningState) => void;
  /** Reset all ephemeral state to initial defaults. */
  reset: () => void;
}

type InitialState = Omit<
  CurrentChatStore,
  | 'setChatId'
  | 'setLazy'
  | 'toggleExpanded'
  | 'setAutoFollow'
  | 'setInteractionMode'
  | 'togglePin'
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
  reasoning: { mode: 'on' },
};

export const useCurrentChatStore = create<CurrentChatStore>((set) => ({
  ...initial,
  setChatId: (id) => set({ chatId: id, pendingPersonaId: null }),
  setLazy: (personaId) => set({ chatId: null, pendingPersonaId: personaId }),
  toggleExpanded: (id) =>
    set((s) => ({ expandedMessageId: s.expandedMessageId === id ? null : id })),
  setAutoFollow: (enabled) => set({ autoFollowEnabled: enabled }),
  setInteractionMode: (on) => set({ isInteractionMode: on }),
  togglePin: () => set((s) => ({ isPinned: !s.isPinned })),
  setReasoning: (r) => set({ reasoning: r }),
  reset: () => set({ ...initial }),
}));
