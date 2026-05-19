// SPDX-License-Identifier: AGPL-3.0-only

import { create } from 'zustand';
import type { InvitationQrPayload } from '../lib/qr.js';

interface LinkingState {
  /** Parsed invitation payload from QR scan or paste. Null when not yet captured. */
  payload: InvitationQrPayload | null;
  setPayload(payload: InvitationQrPayload): void;
  clear(): void;
}

export const useLinkingStore = create<LinkingState>((set) => ({
  payload: null,
  setPayload: (payload) => set({ payload }),
  clear: () => set({ payload: null }),
}));
