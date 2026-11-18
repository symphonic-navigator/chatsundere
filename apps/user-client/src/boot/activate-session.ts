// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import { type AppSession, useSessionStore } from '@chatsundere/ui-shared';
import { purgeExpiredTrash } from '../trash/purge.js';
import { enforceClientDataIdentity } from './client-data-identity.js';

/**
 * Activate a freshly-unlocked session.
 *
 * Enforces client-data identity isolation BEFORE the session goes active — so
 * the app shell, the sync engine and every TanStack query only ever observe the
 * current identity's rows, never a previous identity's (which are sealed under a
 * superseded MasterKey and would otherwise resurface / throw `OperationError` on
 * decrypt). The guard runs against the session's encapsulated `deriveDek`.
 *
 * Every unlock path (passphrase, passkey, recovery, and the invitation / pairing
 * / local-account onboarding joins) must go through here rather than calling
 * `setSession` directly, so the guard cannot be bypassed. Every unlock path
 * holds the MK it just unwrapped and passes it here; the passkey path does too
 * since 0.5.0.
 *
 * If the identity guard throws, the session is closed (zeroing the MK of this
 * unlock) and the error is rethrown; the store is left untouched. This closes
 * only the session it was handed, and only before it reached the store.
 *
 * ONBOARDING paths (a brand-new identity taking over the device) additionally
 * call `wipeClientDataStores()` BEFORE persisting the new crypto account, so a
 * device carrying a previous identity's data is cleared with no adoption window;
 * by the time they reach here the store is already clean and the guard simply
 * stamps the current identity.
 */
export async function activateSession(session: AppSession, mk: MasterKey): Promise<void> {
  try {
    await enforceClientDataIdentity(session);
  } catch (error) {
    session.close();
    throw error;
  }
  useSessionStore.getState().setSession(session, mk);
  // Housekeeping only: it must never delay or fail an unlock. Runs for every
  // account, so local-only users get their expired trash purged without sync.
  void purgeExpiredTrash().catch((e: unknown) => {
    console.warn('Could not purge expired trash on unlock', e);
  });
}
