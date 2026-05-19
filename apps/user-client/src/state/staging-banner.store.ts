// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

/**
 * Tracks whether the user has dismissed the boot-time staging rollback banner.
 * Resets to `false` on every page load (no persistence — Zustand default).
 */
interface StagingBannerState {
  dismissed: boolean;
  dismiss(): void;
}

export const useStagingBannerStore = create<StagingBannerState>((set) => ({
  dismissed: false,
  dismiss: () => set({ dismissed: true }),
}));
