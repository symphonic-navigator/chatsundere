// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import { type AppSession, useSessionStore } from '@chatsundere/ui-shared';
import { enforceClientDataIdentity } from './client-data-identity.js';

/**
 * Activate a freshly-unlocked session.
 *
 * Enforces client-data identity isolation BEFORE the session goes active — so
 * the app shell, the sync engine and every TanStack query only ever observe the
 * current identity's rows, never a previous identity's (which are sealed under a
 * superseded MasterKey and would otherwise resurface / throw `OperationError` on
 * decrypt). The guard runs against the session's encapsulated `deriveDek`, so it
 * works on every unlock path including passkey unlock (which never surfaces the
 * raw MasterKey).
 *
 * Every unlock path (passphrase, passkey, recovery, and the invitation / pairing
 * / local-account onboarding joins) must go through here rather than calling
 * `setSession` directly, so the guard cannot be bypassed. Passing `mk` mirrors
 * `setSession(session, mk?)`: omit it to preserve the existing raw-MK slice
 * (e.g. the passkey path, which sets no raw MK).
 *
 * ONBOARDING paths (a brand-new identity taking over the device) additionally
 * call `wipeClientDataStores()` BEFORE persisting the new crypto account, so a
 * device carrying a previous identity's data is cleared with no adoption window;
 * by the time they reach here the store is already clean and the guard simply
 * stamps the current identity.
 */
export async function activateSession(session: AppSession, mk?: MasterKey): Promise<void> {
  await enforceClientDataIdentity(session);
  useSessionStore.getState().setSession(session, mk);
}
