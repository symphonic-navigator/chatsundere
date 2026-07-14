// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { env } from '../env.js';

/**
 * Mirrors apps/user-client/src/lib/server-urls.ts: the VITE_* values are
 * dev-only overrides, honoured exclusively under the Vite dev server, so a
 * production build can never pin a stale URL and tests never inherit a
 * developer's `.env`.
 */
function devOverridesActive(): boolean {
  return import.meta.env.DEV && import.meta.env.MODE !== 'test';
}

/**
 * The auth-service base URL for this session, taken from the linked account
 * row that the pre-login decision tree publishes.
 *
 * Throws rather than returning null: the decision tree guarantees a linked row
 * before the login form renders, and every data-layer call runs after login. A
 * missing value here is a wiring fault (a route past the login), not a user
 * state, and naming it at the point of failure beats twelve null-checks that
 * defer the diagnosis (spec §5).
 */
export function effectiveAuthUrl(): string {
  const override = devOverridesActive() ? env.VITE_AUTH_URL : undefined;
  const url = override ?? useAccountLinkStore.getState().baseUrl;
  if (!url) {
    throw new Error('No linked account — the pre-login decision tree must run first');
  }
  return url;
}
