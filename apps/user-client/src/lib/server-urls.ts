// SPDX-License-Identifier: AGPL-3.0-only
import { useDiscoveryStore } from '@chatsundere/ui-shared';
import { env } from '../env.js';

/**
 * Discovery is the source of truth for service URLs (spec §9). The VITE_*
 * values are dev-only overrides — honoured exclusively under
 * `import.meta.env.DEV`, so a production build can never pin a stale URL.
 */
export function effectiveProxyUrl(): string | null {
  const override = import.meta.env.DEV ? env.VITE_PROXY_URL : undefined;
  return override ?? useDiscoveryStore.getState().config?.proxyUrl ?? null;
}

export function effectiveSyncUrl(): string | null {
  const override = import.meta.env.DEV ? env.VITE_SYNC_URL : undefined;
  return override ?? useDiscoveryStore.getState().config?.syncUrl ?? null;
}
