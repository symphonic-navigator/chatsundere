// SPDX-License-Identifier: AGPL-3.0-only
import { type DEK, getLocalAccount, identityTagFromDek } from '@chatsundere/crypto';
import Dexie from 'dexie';
import { DB_NAME, closeClientDataDb, openClientDataDb } from './client-data-db.js';
import { VECTORS_DB_NAME, closeKnowledgeVectorsDb } from './knowledge-vectors-db.js';

/**
 * HKDF context for the client-data identity tag. Versioned so a future rebinding
 * scheme can be introduced without colliding with existing tags.
 */
export const CLIENT_DATA_IDENTITY_CONTEXT = 'client-data/identity-binding-v1';

/**
 * The slice of a `MasterKeySession` the guard needs: the encapsulated
 * `deriveDek`. Taking this (not the raw MasterKey) means the guard works on
 * EVERY unlock path — including passkey unlock, which never surfaces the raw
 * MasterKey to the app (the biometric flow returns a `MasterKeySession` and the
 * raw-MK store slice is not set on that path).
 */
export interface IdentityDeriver {
  deriveDek(context: string): Promise<DEK>;
}

/**
 * Close and delete BOTH local Dexie stores that hold MasterKey-sealed data.
 * Mirrors the client-data portion of `wipeDevice` (close-before-delete so the
 * delete is not aborted by an open handle — the false-completion bug that let a
 * store SURVIVE a wipe). `Dexie.delete` closes its own handle and awaits real
 * completion.
 *
 * Onboarding paths call this BEFORE persisting the new identity's crypto account,
 * so a device carrying a previous identity's rows is cleared with no window in
 * which a partially-onboarded device could later be adopted (Larissa LOW-1).
 */
export async function wipeClientDataStores(): Promise<void> {
  closeClientDataDb();
  closeKnowledgeVectorsDb();
  await Dexie.delete(DB_NAME);
  await Dexie.delete(VECTORS_DB_NAME);
}

/**
 * The onboarding pre-persist wipe, gated on the device being genuinely fresh.
 *
 * Onboarding wipes local data BEFORE persisting the new identity's crypto
 * account (so an interrupted onboarding leaves no adoptable orphan rows — LOW-1).
 * But it must NEVER wipe when a local account ALREADY exists: onboarding over an
 * existing account is refused by the crypto flow's `conflict` backstop, and
 * wiping before that refusal would destroy a returning user's data (Larissa
 * HIGH-1 — the three onboarding routes local / recover / pairing carry no
 * account-guard, so the wipe itself must be the wall). A fresh device (no local
 * account) is wiped; a device with an account is left untouched, and the crypto
 * flow then rejects the operation without data loss.
 */
export async function wipeClientDataForFreshOnboarding(cryptoDb: IDBDatabase): Promise<void> {
  if (await getLocalAccount(cryptoDb)) return;
  await wipeClientDataStores();
}

/**
 * Bind the local client-data store to the identity that owns it, run once at
 * boot AFTER the MasterKey is available and BEFORE the app reads or writes
 * client-data.
 *
 * The client-data DB has a fixed name and is not per-user, so establishing a new
 * identity on a device (register / recover / join) would otherwise leave the
 * previous identity's rows in place — sealed under a now-superseded MasterKey,
 * undecryptable, and resurrected on the next login. We store a non-secret,
 * one-way tag of the owning MasterKey on the settings singleton and enforce it:
 *
 * - tag absent (fresh or legacy pre-tag store) → adopt: stamp the current tag,
 *   keep the data (a legitimate single-identity user must not be nuked).
 * - tag matches → same identity, untouched.
 * - tag differs → the store belongs to a different identity → wipe client-data
 *   AND knowledge-vectors, reopen empty, stamp the current tag.
 *
 * Binding to the MasterKey (not the auth flow) covers every path that changes
 * the identity, including offline linked-login, while leaving username /
 * passphrase / recovery-key changes (same MasterKey) untouched.
 */
export async function enforceClientDataIdentity(session: IdentityDeriver): Promise<void> {
  const currentTag = await identityTagFromDek(
    await session.deriveDek(CLIENT_DATA_IDENTITY_CONTEXT),
  );

  let db = await openClientDataDb();
  const storedTag = (await db.settings.get(1))?.identityTag;

  if (storedTag !== undefined && storedTag !== currentTag) {
    await wipeClientDataStores();
    // Reopen fresh — this re-seeds the default settings singleton the tag below
    // is stamped onto. If the wipe failed the delete would throw and we would
    // NOT reach the stamp, so a foreign store is never re-tagged as ours.
    db = await openClientDataDb();
  }

  await db.settings.update(1, { identityTag: currentTag });
}
