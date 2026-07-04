// SPDX-License-Identifier: AGPL-3.0-only
import { deleteLinkedAccount } from '@chatsundere/crypto';
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { getDb } from '../boot/open-db.js';
import { resetEngineStateForLocalOnly } from '../sync/link-reset.js';
import { logoutCurrentSession } from './auth-logout.js';

/**
 * Make THIS device local-only (spec: sync-lifecycle hardening). Revokes the
 * device's server session, drops the local link, flips the account-link
 * store, and resets sync-engine state — the server account and all user data
 * are untouched; this never calls `deleteServerAccount` or `DELETE
 * /api/v1/me`.
 *
 * Step 1 (session revoke) is best-effort: it must never strand the device
 * half-decoupled, so steps 2-4 always run regardless of its outcome. The
 * caller receives `sessionRevoked` to show a constructive "session will
 * expire on its own · retry" note when the revoke didn't land.
 */
export async function decoupleDevice(): Promise<{ sessionRevoked: boolean }> {
  let sessionRevoked: boolean;
  try {
    sessionRevoked = await logoutCurrentSession();
  } catch {
    // logoutCurrentSession is documented never to throw; this guard exists
    // purely so a future regression there cannot block the unlink below.
    sessionRevoked = false;
  }

  await deleteLinkedAccount(getDb());
  useAccountLinkStore.getState().setLocalOnly();
  await resetEngineStateForLocalOnly();

  return { sessionRevoked };
}
