// SPDX-License-Identifier: AGPL-3.0-only
import { useDiscoveryStore } from '@chatsundere/ui-shared';
import { env } from '../env.js';

/**
 * Discovery is the source of truth for service URLs (spec §9). The VITE_*
 * values are dev-only overrides — honoured exclusively under the Vite dev
 * server (`DEV` true, mode not `test`), so a production build can never pin a
 * stale URL and tests never inherit a developer's `.env`.
 */
function devOverridesActive(): boolean {
  return import.meta.env.DEV && import.meta.env.MODE !== 'test';
}

export function effectiveProxyUrl(): string | null {
  const override = devOverridesActive() ? env.VITE_PROXY_URL : undefined;
  return override ?? useDiscoveryStore.getState().config?.proxyUrl ?? null;
}

export function effectiveSyncUrl(): string | null {
  const override = devOverridesActive() ? env.VITE_SYNC_URL : undefined;
  return override ?? useDiscoveryStore.getState().config?.syncUrl ?? null;
}
