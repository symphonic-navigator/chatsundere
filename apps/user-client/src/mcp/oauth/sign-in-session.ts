// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import { getClientDataDb } from '../../boot/client-data-db.js';
import { isProxyAvailable } from '../../lib/proxy-auth.js';
import { copyKey, createEnsureDeps } from './ensure-token.js';
import { createOAuthFetch } from './oauth-fetch.js';
import {
  type PendingSignIn,
  type SignInDeps,
  openPendingSignIn,
  recentPendingSignIn,
} from './sign-in.js';

/** The real collaborators of a sign-in, read afresh for each step. */
export async function createSignInDeps(): Promise<SignInDeps> {
  return {
    oauthFetch: createOAuthFetch(),
    hasProxy: isProxyAvailable(),
    mk: useSessionStore.getState().mk,
    origin: window.location.origin,
    ensure: await createEnsureDeps(),
  };
}

/** Opens this device's pending sign-in for `state`, or null when it is gone or not ours. */
export async function loadPendingSignIn(state: string): Promise<PendingSignIn | null> {
  const key = copyKey(useSessionStore.getState().mk);
  if (key === null) return null;
  try {
    const row = await getClientDataDb().mcpOAuthPending.get(state);
    if (!row || row.completedAt !== undefined) return null;
    return await openPendingSignIn(row, key);
  } catch {
    return null;
  } finally {
    key.fill(0);
  }
}

/** The route of the waiting screen for a pending sign-in. */
export function waitingScreenPath(state: string): string {
  return `/app/integrations/sign-in/${encodeURIComponent(state)}`;
}

/**
 * Where to go after unlocking: back to the waiting screen of a sign-in started within
 * the last 2 minutes (spec §9 "Leaving and returning"), otherwise `target`. Older
 * sign-ins wait in My Integrations.
 */
export async function postUnlockTarget(target: string): Promise<string> {
  try {
    const recent = await recentPendingSignIn();
    return recent ? waitingScreenPath(recent.state) : target;
  } catch {
    return target;
  }
}
