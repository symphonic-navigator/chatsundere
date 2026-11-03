// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

/** What the chat's sign-in overlay was opened for. */
export interface McpSignInTarget {
  serverId: string;
  /** Scopes a challenge asked for; the sign-in requests the union with those already granted. */
  extraScopes: string[];
}

interface McpSignInOverlayState {
  target: McpSignInTarget | null;
  open(target: McpSignInTarget): void;
  close(): void;
}

/**
 * Whether the sign-in overlay above the chat is open, and for which server. Opening it
 * only sets state: the overlay's own *Continue* is the gesture that opens the window.
 */
export const useMcpSignInOverlay = create<McpSignInOverlayState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));
