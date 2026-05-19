// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

export type Connectivity =
  | { kind: 'local_offline' }
  | { kind: 'local_online' }
  | { kind: 'linked_online' }
  | { kind: 'server_unreachable' }
  | { kind: 'server_auth_failed' };

interface ConnectivityState {
  state: Connectivity;
  setState(s: Connectivity): void;
  onNetworkOnline(): void;
  onNetworkOffline(): void;
  onServerOk(): void;
  onServerUnreachable(): void;
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
      s.kind === 'server_unreachable'
    )
      set({ state: { kind: 'server_unreachable' } });
    if (s.kind === 'local_online') set({ state: { kind: 'local_offline' } });
  },
  onServerOk: () => set({ state: { kind: 'linked_online' } }),
  onServerUnreachable: () => set({ state: { kind: 'server_unreachable' } }),
  onServerAuthFailed: () => set({ state: { kind: 'server_auth_failed' } }),
}));

let listenersAttached = false;

export function attachConnectivityListeners(): void {
  if (typeof window === 'undefined') return;
  if (listenersAttached) return;
  listenersAttached = true;
  window.addEventListener('online', () => useConnectivityStore.getState().onNetworkOnline());
  window.addEventListener('offline', () => useConnectivityStore.getState().onNetworkOffline());
  if (!navigator.onLine) useConnectivityStore.getState().onNetworkOffline();
}
