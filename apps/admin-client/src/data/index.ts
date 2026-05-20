// SPDX-License-Identifier: AGPL-3.0-only

import { env } from '../env.js';
import { HybridAdminApi } from './admin-api.hybrid.js';
import type { AdminApi } from './admin-api.js';
import { LiveAdminApi } from './admin-api.live.js';
import { MockAdminApi } from './admin-api.mock.js';

let singleton: AdminApi | null = null;

/** Resolve the AdminApi implementation chosen by VITE_ADMIN_API_MODE. */
export function getAdminApi(): AdminApi {
  if (singleton) return singleton;
  const mode = env.VITE_ADMIN_API_MODE;
  if (mode === 'mock') {
    singleton = new MockAdminApi();
  } else if (mode === 'live') {
    singleton = new LiveAdminApi(env.VITE_AUTH_URL);
  } else {
    singleton = new HybridAdminApi(new LiveAdminApi(env.VITE_AUTH_URL), new MockAdminApi());
  }
  return singleton;
}

export type { AdminApi };
export * from './admin-api.js';
