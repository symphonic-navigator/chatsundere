// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

interface ModelProgressStore {
  /** True from the first embed request until the engine reports ready. */
  loading: boolean;
  /** 0..1 download/compile progress, or null when indeterminate. */
  progress: number | null;
  /** Set once the engine has loaded successfully (banner never shows again). */
  ready: boolean;
  setLoading: (loading: boolean) => void;
  setProgress: (progress: number | null) => void;
  setReady: () => void;
}

export const useModelProgressStore = create<ModelProgressStore>((set) => ({
  loading: false,
  progress: null,
  ready: false,
  setLoading: (loading) => set({ loading }),
  setProgress: (progress) => set({ progress }),
  setReady: () => set({ ready: true, loading: false, progress: 1 }),
}));
