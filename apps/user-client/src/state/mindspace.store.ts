// SPDX-License-Identifier: AGPL-3.0-only

import { create } from 'zustand';
import type { MindspaceRow, MindspaceTexture } from '../boot/client-data-db.js';
import {
  type ResolvedMindspace,
  type ResolverArgs,
  resolveMindspace,
} from './mindspace-resolver.js';

interface MindspaceState {
  resolved: ResolvedMindspace | null;
  update: (args: ResolverArgs) => void;
  reset: () => void;
}

/**
 * Holds the currently-resolved mindspace for the active context.
 * Updated by surfaces when persona / default / mindspaces change;
 * MindspaceLayer subscribes and writes CSS custom properties.
 */
export const useMindspaceStore = create<MindspaceState>((set) => ({
  resolved: null,
  update: (args) => set({ resolved: resolveMindspace(args) }),
  reset: () => set({ resolved: null }),
}));

export type { MindspaceTexture, MindspaceRow, ResolvedMindspace };
