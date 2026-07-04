// SPDX-License-Identifier: AGPL-3.0-only
import { getSyncState, setAttention } from '../sync/watermark.js';

/**
 * The auth-degraded latch (spec §5.2): set when the auth service DEFINITIVELY
 * refused a token refresh on a background path. While set, the sync engine stays
 * stopped (worker/gate/doorbell consult it synchronously) and the persistent
 * `auth_degraded` attention carries the relink affordance. Local work continues
 * — the server never had authority over the local session.
 */
let degraded = false;

/** Whether the auth-degraded latch is set (consulted synchronously by the sync engine). */
export function isAuthDegraded(): boolean {
  return degraded;
}

/**
 * Set or clear the latch. Setting persists the `auth_degraded` attention so the
 * relink affordance survives a reload; clearing removes it, but only if it is
 * still the current attention (never stamps over an unrelated one).
 */
export async function setAuthDegraded(value: boolean): Promise<void> {
  degraded = value;
  if (value) {
    await setAttention({ kind: 'auth_degraded' });
  } else {
    const state = await getSyncState();
    if (state.attention?.kind === 'auth_degraded') await setAttention(null);
  }
}

/** Boot re-arm: the attention persists in Dexie; the in-memory latch does not. */
export async function armAuthDegradeFromBoot(): Promise<void> {
  const state = await getSyncState();
  degraded = state.attention?.kind === 'auth_degraded';
}

/** Test seam. */
export function _resetAuthDegradeForTests(): void {
  degraded = false;
}
