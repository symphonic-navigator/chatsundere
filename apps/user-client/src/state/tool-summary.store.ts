// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

interface ToolSummaryStore {
  /** Pill ids whose background summary is queued or running (in memory only). */
  pending: ReadonlySet<string>;
  add: (id: string) => void;
  remove: (id: string) => void;
}

/** Pending tool-result summaries, so the pill can announce the swap (spec §6.3). */
export const useToolSummaryStore = create<ToolSummaryStore>((set) => ({
  pending: new Set(),
  add: (id) => set((s) => ({ pending: new Set(s.pending).add(id) })),
  remove: (id) =>
    set((s) => {
      if (!s.pending.has(id)) return s;
      const next = new Set(s.pending);
      next.delete(id);
      return { pending: next };
    }),
}));
