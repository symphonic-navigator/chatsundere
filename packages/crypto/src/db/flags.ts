// SPDX-License-Identifier: LGPL-3.0-only

import { reqPromise, txDone } from './open.js';
import { type FlagsRow, STORE_FLAGS } from './schema.js';

/**
 * Read whether the post-onboarding biometric prompt has already been shown
 * (or dismissed / completed) on this device.
 *
 * Returns `false` when:
 * - No row exists yet (fresh install, never reached /app after linking).
 * - The row exists with `shown: false` (prompt is due).
 *
 * Returns `true` when the row exists with `shown: true` (prompt already handled).
 */
export async function getBiometricPromptShown(db: IDBDatabase): Promise<boolean> {
  const tx = db.transaction(STORE_FLAGS, 'readonly');
  const row = (await reqPromise(tx.objectStore(STORE_FLAGS).get('biometric_prompt'))) as
    | FlagsRow
    | undefined;
  await txDone(tx);
  return row?.shown ?? false;
}

/**
 * Mark the biometric prompt as due — call this at the end of every
 * linked-account join/link flow, just before navigating to `/app`.
 *
 * Idempotent: if a row already exists with `shown: true` (the prompt has
 * already been handled), this write is a no-op and the user will NOT be
 * prompted again.
 */
export async function setBiometricPromptDue(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE_FLAGS, 'readwrite');
  const store = tx.objectStore(STORE_FLAGS);
  const existing = (await reqPromise(store.get('biometric_prompt'))) as FlagsRow | undefined;
  // Never reset a flag that was already dismissed — once shown, always shown.
  if (!existing?.shown) {
    const row: FlagsRow = { key: 'biometric_prompt', shown: false };
    await reqPromise(store.put(row));
  }
  await txDone(tx);
}

/**
 * Mark the biometric prompt as handled — call this when the user dismisses
 * ("Maybe later") or completes ("Set up now") the prompt.
 */
export async function setBiometricPromptShown(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE_FLAGS, 'readwrite');
  const row: FlagsRow = { key: 'biometric_prompt', shown: true };
  await reqPromise(tx.objectStore(STORE_FLAGS).put(row));
  await txDone(tx);
}
