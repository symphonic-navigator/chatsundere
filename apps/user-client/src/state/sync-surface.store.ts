// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

/**
 * Cross-cutting sync UI signals that outlive any single route (spec §7.3/§11).
 * Currently just the "currently-viewed record was tombstoned elsewhere"
 * breadcrumb flag — the chat surface reads it to show one calm inline notice.
 */
interface SyncSurfaceStore {
  /** The chat id whose record was tombstoned from another device while viewed. */
  tombstonedChatId: string | null;
  /** Record that the given chat's record was tombstoned elsewhere. */
  markChatTombstoned: (chatId: string) => void;
  /** Clear the breadcrumb flag (on chat change or acknowledgement). */
  clearTombstoned: () => void;
}

export const useSyncSurfaceStore = create<SyncSurfaceStore>((set) => ({
  tombstonedChatId: null,
  markChatTombstoned: (chatId) => set({ tombstonedChatId: chatId }),
  clearTombstoned: () => set({ tombstonedChatId: null }),
}));
