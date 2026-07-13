// SPDX-License-Identifier: LGPL-3.0-only
import { create } from 'zustand';

export type Connectivity =
  | { kind: 'local_offline' }
  | { kind: 'local_online' }
  | { kind: 'linked_online' }
  | { kind: 'server_unreachable' }
  // Server answered 429: reachable but throttling us. Distinct from
  // server_unreachable so the badge can tell the honest "too many attempts,
  // this resumes shortly" story instead of falsely claiming the server is down.
  // The sync engine treats it exactly like offline (paused) — see server-gate.
  // `retryAt` is the absolute epoch-ms instant the server said a slot frees
  // (from its Retry-After header); the badge derives the remaining wait at
  // render so it never goes stale. Absent when the server gave no hint.
  | { kind: 'server_rate_limited'; retryAt?: number }
  | { kind: 'server_auth_failed' };

interface ConnectivityState {
  state: Connectivity;
  setState(s: Connectivity): void;
  onNetworkOnline(): void;
  onNetworkOffline(): void;
  onServerOk(): void;
  onServerUnreachable(): void;
  onServerRateLimited(retryAfterSeconds?: number): void;
  onServerAuthFailed(): void;
}

export const useConnectivityStore = create<ConnectivityState>((set, get) => ({
  state: { kind: 'local_offline' },
  setState: (state) => set({ state }),
  onNetworkOnline: () => {
    const s = get().state;
    // Linked states wait for the next server probe to re-establish reachability;
    // we do not optimistically transition to linked_online on the network event.
    if (s.kind === 'local_offline') set({ state: { kind: 'local_online' } });
  },
  onNetworkOffline: () => {
    const s = get().state;
    if (
      s.kind === 'linked_online' ||
      s.kind === 'server_auth_failed' ||
      s.kind === 'server_rate_limited' ||
      s.kind === 'server_unreachable'
    )
      set({ state: { kind: 'server_unreachable' } });
    if (s.kind === 'local_online') set({ state: { kind: 'local_offline' } });
  },
  onServerOk: () => set({ state: { kind: 'linked_online' } }),
  onServerUnreachable: () => set({ state: { kind: 'server_unreachable' } }),
  onServerRateLimited: (retryAfterSeconds) =>
    set({
      state: {
        kind: 'server_rate_limited',
        retryAt:
          retryAfterSeconds && retryAfterSeconds > 0
            ? Date.now() + retryAfterSeconds * 1000
            : undefined,
      },
    }),
  onServerAuthFailed: () => set({ state: { kind: 'server_auth_failed' } }),
}));

let listenersAttached = false;

export interface ConnectivityListenerOptions {
  /**
   * Invoked once per regain event — window 'online' and document
   * visibility→visible (spec §7: exactly one probe per regain event; the
   * probe itself is single-flight, so double events are harmless). The
   * callback is injected so this module never imports the discovery or
   * account-link stores.
   */
  onRegain?: () => void;
}

export function attachConnectivityListeners(opts: ConnectivityListenerOptions = {}): void {
  if (typeof window === 'undefined') return;
  if (listenersAttached) return;
  listenersAttached = true;
  window.addEventListener('online', () => {
    useConnectivityStore.getState().onNetworkOnline();
    opts.onRegain?.();
  });
  window.addEventListener('offline', () => useConnectivityStore.getState().onNetworkOffline());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') opts.onRegain?.();
  });
  if (!navigator.onLine) useConnectivityStore.getState().onNetworkOffline();
}
