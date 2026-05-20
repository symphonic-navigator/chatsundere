// SPDX-License-Identifier: AGPL-3.0-only

import { useSessionStore } from '@chatsundere/ui-shared';
import { env } from '../env.js';
import type { Role } from '../lib/self-target.js';
import { HybridAdminApi, type SelfSnapshot } from './admin-api.hybrid.js';
import type { AdminApi } from './admin-api.js';
import { LiveAdminApi } from './admin-api.live.js';
import { MockAdminApi } from './admin-api.mock.js';

let singleton: AdminApi | null = null;

function readSessionSnapshot(): SelfSnapshot {
  const session = useSessionStore.getState().session;
  return {
    userId: session?.userId ?? null,
    username: session?.username ?? null,
    role: (session?.role ?? null) as Role | null,
  };
}

/** Resolve the AdminApi implementation chosen by VITE_ADMIN_API_MODE. */
export function getAdminApi(): AdminApi {
  if (singleton) return singleton;
  const mode = env.VITE_ADMIN_API_MODE;
  if (mode === 'mock') {
    singleton = new MockAdminApi();
  } else if (mode === 'live') {
    singleton = new LiveAdminApi(env.VITE_AUTH_URL);
  } else {
    singleton = new HybridAdminApi(
      new LiveAdminApi(env.VITE_AUTH_URL),
      new MockAdminApi(),
      readSessionSnapshot,
    );
  }
  return singleton;
}

export type { AdminApi };
export * from './admin-api.js';
