// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

interface NavTransitionState {
  /** Rect for the next enter-zoom; cleared by consume(). */
  originRect: DOMRect | null;
  /** The last tile origin (rect + the path the tile lived on); drives the
   *  matching exit-collapse when navigation returns to that path. */
  lastOrigin: { rect: DOMRect; path: string } | null;
  /** Record a tile activation: its rect and the path it was tapped from. */
  armFrom: (rect: DOMRect, path: string) => void;
  /** Enter path: return originRect and clear it (single-use). */
  consume: () => DOMRect | null;
  /** Exit decision: read the last origin WITHOUT clearing. */
  peekLast: () => { rect: DOMRect; path: string } | null;
  /** Clear the last origin once an exit has been chosen. */
  clearLast: () => void;
}

export const useNavTransitionStore = create<NavTransitionState>((set, get) => ({
  originRect: null,
  lastOrigin: null,
  armFrom: (rect, path) => set({ originRect: rect, lastOrigin: { rect, path } }),
  consume: () => {
    const { originRect } = get();
    if (originRect) set({ originRect: null });
    return originRect;
  },
  peekLast: () => get().lastOrigin,
  clearLast: () => set({ lastOrigin: null }),
}));
