// SPDX-License-Identifier: AGPL-3.0-only
import { setProxyAuthSource } from '@chatsundere/llm-unified';
import { initAccountLinkFromDb, maybeProbeLinkedServer } from '@chatsundere/ui-shared';
import { proxyAuthSource } from '../lib/proxy-auth.js';
import { getDb } from './open-db.js';

/**
 * WS-0 boot wiring (spec §7): register the late-binding proxy auth source,
 * populate the central account-link gate from the crypto IDB, then fire the
 * initial discovery probe. The probe is a no-op when local-only or offline,
 * so calling it unconditionally is safe.
 */
export async function initServerFoundation(): Promise<void> {
  setProxyAuthSource(proxyAuthSource);
  await initAccountLinkFromDb(getDb());
  maybeProbeLinkedServer();
}
