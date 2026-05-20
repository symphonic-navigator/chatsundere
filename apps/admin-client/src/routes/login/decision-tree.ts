// SPDX-License-Identifier: AGPL-3.0-only
import { getLinkedAccount, getLocalAccount, openLocalDb } from '@chatsundere/crypto';

export type PreLoginBranch = 'no_account' | 'no_link' | 'offline' | 'ready';

export interface PreLoginResult {
  branch: PreLoginBranch;
}

/**
 * Pre-login decision tree per spec §6.2 steps 1-3. The login itself (step 4)
 * and the role check (step 5) run after the user submits.
 *
 * The connectivity check uses `navigator.onLine` because the connectivity
 * store only transitions to `linked_online` after a successful server
 * round-trip — which is what login does. A pre-login store-state check
 * would refuse to even render the form on the very first visit. The login
 * submit then exercises the actual server reachability and surfaces a
 * meaningful error if the server is unreachable.
 */
export async function runDecisionTreePreLogin(): Promise<PreLoginResult> {
  const db = await openLocalDb();
  try {
    const local = await getLocalAccount(db);
    if (!local) return { branch: 'no_account' };
    const linked = await getLinkedAccount(db);
    if (!linked) return { branch: 'no_link' };
    if (!navigator.onLine) return { branch: 'offline' };
    return { branch: 'ready' };
  } finally {
    db.close();
  }
}

export type PostLoginBranch = 'role_not_admin' | 'admin_ok';

/**
 * Classify whether the authenticated role grants admin access.
 * Both `admin` and `primary_admin` are accepted.
 */
export function classifyPostLogin(role: string): PostLoginBranch {
  if (role === 'admin' || role === 'primary_admin') return 'admin_ok';
  return 'role_not_admin';
}
