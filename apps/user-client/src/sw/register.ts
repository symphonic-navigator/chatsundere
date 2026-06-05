// SPDX-License-Identifier: AGPL-3.0-only
import { registerSW } from 'virtual:pwa-register';

/**
 * Registers the service worker. A new version is deliberately NEVER surfaced
 * mid-session: applying it requires a page reload, which drops the in-memory
 * master key (it is never persisted — zero-knowledge) and would force the user
 * to re-unlock. Instead the waiting worker activates silently on the next cold
 * start, so updates land automatically without a banner and without re-login.
 */
export function registerServiceWorker(): void {
  registerSW({
    immediate: false,
    onOfflineReady() {
      /* informational; we are local-first regardless */
    },
  });
}
