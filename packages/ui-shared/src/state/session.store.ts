// SPDX-License-Identifier: LGPL-3.0-only
import type { MasterKey, MasterKeySession } from '@chatsundere/crypto';
import { create } from 'zustand';

// AppSession is the session metadata. `mk` is kept in a separate slice of
// the store so partial-spread updates (`setSession({ ...current, mode: ... })`)
// cannot accidentally drop it. The store owns the MK lifecycle.
export type AppSession = MasterKeySession & { accessToken?: string };

interface SessionState {
  session: AppSession | null;
  mk: MasterKey | null;
  /**
   * Replace the session metadata. If `mk` is provided, it replaces the
   * current MK. If omitted (NOT passed at all), the existing MK is
   * preserved — this is the intentional default for partial-update flows
   * like linking confirmation, where the session changes (e.g. `mode:
   * 'linked'`) but the MK must not be dropped.
   *
   * To explicitly clear `mk`, call `closeAndForget()`. The asymmetric
   * preserve-on-omit shape is deliberate; do not change it to make `mk`
   * required without auditing every call-site (the linking/confirm flow
   * specifically relies on this contract — see
   * apps/user-client/src/routes/linking/confirm.tsx).
   *
   * Omitting `mk` while the store holds none throws `Error('setSession:
   * refusing to open a session without a master key')` and changes nothing,
   * so an active session with a null MK can never be created.
   *
   * A stored session is closed only by `closeAndForget()`, which clears both
   * slices together.
   */
  setSession(session: AppSession, mk?: MasterKey): void;
  updateAccessToken(token: string): void;
  /**
   * Close the stored session (zeroing its MK) and clear both slices. Never
   * `close()` a stored session or a spread of it anywhere else; the session
   * closure and `mk` share one buffer.
   */
  closeAndForget(): void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  session: null,
  mk: null,
  setSession: (session, mk) => {
    if (mk !== undefined) {
      set({ session, mk });
    } else {
      if (get().mk === null) {
        throw new Error('setSession: refusing to open a session without a master key');
      }
      set({ session });
    }
  },
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
    set({ session: null, mk: null });
  },
}));
