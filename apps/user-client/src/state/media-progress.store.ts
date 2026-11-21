// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

interface MediaProgressStore {
  /** Bytes read so far per media key; `total` is null when the server sent no length. */
  byKey: Record<string, { done: number; total: number | null }>;
  set(key: string, done: number, total: number | null): void;
  clear(key: string): void;
}

/** In-memory download progress of media saves, keyed by `MediaRef.key`. */
export const useMediaProgress = create<MediaProgressStore>((set) => ({
  byKey: {},
  set: (key, done, total) => set((s) => ({ byKey: { ...s.byKey, [key]: { done, total } } })),
  clear: (key) =>
    set((s) => {
      if (!(key in s.byKey)) return s;
      const { [key]: _gone, ...rest } = s.byKey;
      return { byKey: rest };
    }),
}));
