// SPDX-License-Identifier: AGPL-3.0-only
import { initAccountLinkFromDb, maybeProbeLinkedServer } from '@chatsundere/ui-shared';
import { getDb } from './open-db.js';

/**
 * WS-0 boot wiring (spec §7): populate the central account-link gate from
 * the crypto IDB, then fire the initial discovery probe. The probe is a
 * no-op when local-only or offline, so calling it unconditionally is safe.
 */
export async function initServerFoundation(): Promise<void> {
  await initAccountLinkFromDb(getDb());
  maybeProbeLinkedServer();
}
