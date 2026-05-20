// SPDX-License-Identifier: LGPL-3.0-only
import type { MasterKey, MasterKeySession } from '@chatsundere/crypto';
import { create } from 'zustand';

// AppSession adds in-memory mutable fields on top of the read-only
// MasterKeySession from packages/crypto. Per ADR-discussion 2026-05-18 the
// crypto package stays pure; rotation is an app-layer concern.
//
// `mk` is kept in memory alongside the session so that features like recovery-key
// regeneration (which operate on the raw master key bytes) can operate without
// requiring re-authentication. It is never written to any persistent storage.
export type AppSession = MasterKeySession & { accessToken?: string; mk?: MasterKey };

interface SessionState {
  session: AppSession | null;
  setSession(session: AppSession): void;
  updateAccessToken(token: string): void;
  closeAndForget(): void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  session: null,
  setSession: (session) => set({ session }),
  updateAccessToken: (token) => {
    const current = get().session;
    if (!current) return;
    // Spread to a new object so React re-renders subscribers; mutate
    // accessToken in place is fine for the underlying crypto session.
    set({ session: { ...current, accessToken: token } });
  },
  closeAndForget: () => {
    const current = get().session;
    if (current) current.close();
    set({ session: null });
  },
}));
