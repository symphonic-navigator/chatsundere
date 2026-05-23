// SPDX-License-Identifier: AGPL-3.0-only

import { create } from 'zustand';
import type { MindspaceRow, PersonaRow } from '../boot/client-data-db.js';
import { resolveMindspace } from './mindspace-resolver.js';

interface UpdateArgs {
  persona: PersonaRow | null;
  defaultMindspaceId: string;
  mindspaces: ReadonlyArray<MindspaceRow>;
}

interface MindspaceStoreState {
  resolved: MindspaceRow | null;
  update: (args: UpdateArgs) => void;
  reset: () => void;
}

/**
 * Holds the currently-resolved mindspace for the active context.
 * Updated by surfaces when persona / default / mindspaces change;
 * MindspaceLayer subscribes and writes CSS custom properties.
 */
export const useMindspaceStore = create<MindspaceStoreState>((set) => ({
  resolved: null,
  update: (args) => {
    if (args.mindspaces.length === 0) {
      // Defensive: built-ins aren't seeded yet — keep null.
      set({ resolved: null });
      return;
    }
    set({ resolved: resolveMindspace(args) });
  },
  reset: () => set({ resolved: null }),
}));
