// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

interface UpdateState {
  needRefresh: boolean;
  doRefresh: (() => void) | null;
  setNeedRefresh(value: boolean, doRefresh: () => void): void;
  reset(): void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  needRefresh: false,
  doRefresh: null,
  setNeedRefresh: (value, doRefresh) => set({ needRefresh: value, doRefresh }),
  reset: () => set({ needRefresh: false, doRefresh: null }),
}));
