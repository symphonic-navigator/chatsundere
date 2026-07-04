// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';

/**
 * The start-over erase (spec §4.3): the named, constructive exit for the
 * lost-both-keys terminal state. Deletes every local database — the crypto
 * account store, the client data, and the knowledge vectors — then reloads into
 * onboarding. A synced server account is a separate thing and is NOT touched (no
 * server call is made; no token exists in this state anyway).
 */

// The three IndexedDB databases the client owns. Names verified against source:
// crypto account store (`packages/crypto/src/db/schema.ts` → 'chatsundere'),
// Dexie client data (`boot/client-data-db.ts` → 'chatsundere_client_data'),
// and knowledge vectors (`boot/knowledge-vectors-db.ts` →
// 'chatsundere-knowledge-vectors').
const DB_NAMES = ['chatsundere', 'chatsundere_client_data', 'chatsundere-knowledge-vectors'];

/**
 * Best-effort delete of a single IndexedDB database. Resolves on success, error,
 * and blocked alike — an open handle in another tab would fire `onblocked`, but
 * the reload that follows releases every handle this context holds, so the
 * delete completes once the page is gone. We never reject: a stuck delete must
 * not strand the user in the locked state they came here to escape.
 */
function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = globalThis.indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

/**
 * Wipe every local database and reload into onboarding. Zeroes the in-memory
 * master key first via `closeAndForget`, deletes each database best-effort, then
 * navigates so the fresh boot sees no account.
 */
export async function wipeDevice(): Promise<void> {
  useSessionStore.getState().closeAndForget();
  for (const name of DB_NAMES) await deleteDatabase(name);
  window.location.assign('/onboarding');
}
