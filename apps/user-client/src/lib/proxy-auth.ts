// SPDX-License-Identifier: AGPL-3.0-only
import type { ProxyAuthSource } from '@chatsundere/llm-unified';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { refreshAccessToken } from './fetch.js';
import { deriveServerGate } from './server-gate.js';
import { effectiveProxyUrl } from './server-urls.js';

function proxyUrl(): string | null {
  if (useAccountLinkStore.getState().linkStatus !== 'linked') return null;
  const config = useDiscoveryStore.getState().config;
  if (config === null || !config.features.includes('proxy')) return null;
  // Availability is discovery-gated above; the URL itself honours the dev-only
  // VITE_PROXY_URL override (server-urls.ts) and falls back to discovery.
  return effectiveProxyUrl();
}

/** The app's late-binding proxy credentials (spec §3); registered at boot. */
export const proxyAuthSource: ProxyAuthSource = {
  getUrl: proxyUrl,
  getToken: () => useSessionStore.getState().session?.accessToken ?? null,
  refreshToken: async () => {
    const baseUrl = useAccountLinkStore.getState().baseUrl;
    if (baseUrl === null) return null;
    const ok = await refreshAccessToken(baseUrl);
    return ok ? (useSessionStore.getState().session?.accessToken ?? null) : null;
  },
};

/** Non-hook mirror of useServerGate('proxy').enabled for send-path code. */
export function isProxyAvailable(): boolean {
  return deriveServerGate({
    linkStatus: useAccountLinkStore.getState().linkStatus,
    connectivity: useConnectivityStore.getState().state.kind,
    discoveryStatus: useDiscoveryStore.getState().status,
    config: useDiscoveryStore.getState().config,
    feature: 'proxy',
    // Enabled-ness never depends on the invite URL; it only picks tooltip copy.
    hasInviteUrl: false,
  }).enabled;
}
