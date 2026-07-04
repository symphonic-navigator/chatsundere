// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import Dexie from 'dexie';
import { closeClientDataDb } from '../boot/client-data-db.js';
import { closeKnowledgeVectorsDb } from '../boot/knowledge-vectors-db.js';
import { closeDb } from '../boot/open-db.js';
import { logoutCurrentSession } from './auth-logout.js';

/**
 * The complete-wipe erase (spec §4.3 + sync-lifecycle hardening Unit 4): the
 * named, constructive exit from a device — the terminal state after losing both
 * keys, and the deliberate "erase this device" trust claim. It must leave the
 * device as if the account had never been on it: every local database gone,
 * every plaintext-bearing surface cleared, and the server session revoked.
 *
 * Ordering is load-bearing (see `wipeDevice` below); the previous version
 * deleted the client-data DB while its Dexie handle was still open, so the
 * browser fired `onblocked`, the code mistook blocked for done and navigated
 * away — and the delete was aborted. The database (personas and all) SURVIVED.
 *
 * Every deletion below is best-effort: closing the handles first (step 3) is
 * what makes each delete actually complete in the normal case, but if one
 * still fails, the wipe must keep going rather than reject. The original wipe
 * deliberately never rejected — a stuck delete must not strand the user in
 * the locked state they came here to escape — and that guarantee holds here
 * too, on top of the close-before-delete fix.
 */

// The raw crypto account store (`packages/crypto/src/db/schema.ts` →
// 'chatsundere'). The two Dexie databases are named inline where we delete
// them, since `Dexie.delete` takes the name directly.
const CRYPTO_DB_NAME = 'chatsundere';

// Upper bound on how long we wait for a blocked raw-DB delete before giving up,
// so a wedged connection cannot strand the user in the state they came here to
// escape. The navigation that follows releases every handle this context holds.
const RAW_DELETE_TIMEOUT_MS = 3000;

/**
 * Delete a raw IndexedDB database completion-aware. Resolves on real
 * completion (`onsuccess`) AND, best-effort, on `onerror` — the wipe is the
 * user's deliberate escape from a locked device, so a single delete failure
 * must never abort the remaining steps (surface clear + navigation) and
 * strand them mid-erase. `onblocked` is the one case that deliberately does
 * NOT resolve: an open handle elsewhere would abort the delete outright, so
 * treating blocked as done is exactly the bug this function exists to avoid.
 * Instead we wait: the request stays pending and fires `onsuccess` once the
 * blocker releases, or the bounded timeout below resolves so a permanently
 * wedged connection can never hang the wipe forever.
 */
function deleteRawDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = globalThis.indexedDB.deleteDatabase(name);
    const timer = setTimeout(() => resolve(), RAW_DELETE_TIMEOUT_MS);
    req.onsuccess = () => {
      clearTimeout(timer);
      resolve();
    };
    req.onerror = () => {
      clearTimeout(timer);
      resolve();
    };
    // Deliberately no onblocked → resolve: we wait for onsuccess (or the
    // timeout) rather than silently abandoning a still-open delete.
  });
}

/**
 * Delete a Dexie-managed database best-effort. `Dexie.delete` already closes
 * the handle and awaits real completion, so this only exists to swallow a
 * rejection: the wipe is the user's deliberate escape from a locked device,
 * and a single failed delete must not abort `clearNonIndexedDbSurfaces()` or
 * the final navigation and strand them mid-erase.
 */
async function deleteDexieDb(name: string): Promise<void> {
  try {
    await Dexie.delete(name);
  } catch {
    // Best-effort: fall through and let the wipe continue regardless.
  }
}

/**
 * Clear every non-IndexedDB surface that can hold plaintext: Web Storage (chat
 * drafts live in localStorage), Cache Storage (the PWA shell + any cached
 * responses), and the service-worker registration. Cache Storage and the
 * service worker are guarded — they are undefined in the jsdom/Node test env.
 *
 * Every clear here is per-surface best-effort, mirroring the deletes above: a
 * throw from any one surface (a rejected `caches.delete`, a failing
 * `registration.unregister`, even a `localStorage.clear` in a locked-down env)
 * must NOT propagate out of `wipeDevice` and skip the terminal navigation — that
 * would strand the user un-navigated on a half-wiped app, the very "must not
 * strand" failure the deletes deliberately guard against. We clear what we can
 * and fall through regardless; the navigation that follows releases everything.
 */
async function clearNonIndexedDbSurfaces(): Promise<void> {
  try {
    localStorage.clear();
  } catch {
    // Best-effort: continue to the remaining surfaces regardless.
  }
  try {
    sessionStorage.clear();
  } catch {
    // Best-effort: continue to the remaining surfaces regardless.
  }

  try {
    if (globalThis.caches) {
      for (const key of await globalThis.caches.keys()) {
        await globalThis.caches.delete(key);
      }
    }
  } catch {
    // Best-effort: a rejected Cache Storage op must not abort the wipe.
  }

  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    for (const registration of registrations) {
      await registration.unregister();
    }
  } catch {
    // Best-effort: a failing service-worker unregister must not abort the wipe.
  }
}

/**
 * Wipe every local surface and reload into onboarding. The order is exact and
 * each step depends on the one before:
 *
 * 1. Revoke the server session FIRST — it needs the still-live in-memory bearer
 *    token, which step 2 zeroes. Best-effort: `logoutCurrentSession` never
 *    throws, so a network failure does not strand the wipe.
 * 2. Zero the in-memory master key.
 * 3. Close ALL permanent handles BEFORE deleting — the two Dexie handles AND the
 *    boot-retained raw crypto handle (`boot/open-db.ts`) — so every delete sees
 *    no open connection and runs to completion instead of tripping `onblocked`.
 * 4. Delete the two Dexie DBs completion-aware (`Dexie.delete` closes + awaits),
 *    each best-effort: a rejection is caught so it cannot abort the remaining
 *    steps.
 * 5. Delete the raw crypto DB, waiting for real completion and best-effort on
 *    error (never resolving on blocked — see `deleteRawDb`).
 * 6. Clear the non-IndexedDB surfaces (Web Storage, Cache Storage, SW).
 * 7. Navigate — only after every (now best-effort) deletion has settled.
 */
export async function wipeDevice(): Promise<void> {
  await logoutCurrentSession();
  useSessionStore.getState().closeAndForget();

  closeClientDataDb();
  closeKnowledgeVectorsDb();
  // The raw crypto account DB has its OWN boot-retained handle
  // (`boot/open-db.ts`), separate from the two Dexie handles above. It must be
  // released here too: an open connection would block `deleteRawDb` below on
  // `onblocked`, the timeout would elapse, and the navigation would abort the
  // pending delete — leaving the wrapped master key, passkey-PRF-wrapped MK and
  // local-account record ALIVE on a device the user was told is erased. That is
  // the exact false-completion this wipe exists to prevent, so ALL handles close
  // before ANY delete runs.
  closeDb();

  // Best-effort: closing the handles above is what makes each delete complete
  // in the normal case, but a rejection here must not strand the user with
  // Web Storage intact and no navigation — so we catch and continue.
  await deleteDexieDb('chatsundere_client_data');
  await deleteDexieDb('chatsundere-knowledge-vectors');
  await deleteRawDb(CRYPTO_DB_NAME);

  await clearNonIndexedDbSurfaces();

  window.location.assign('/onboarding');
}
