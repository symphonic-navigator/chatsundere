// SPDX-License-Identifier: AGPL-3.0-only
import { quiesceStrandedTab } from './quiesce.js';
import { wireAppUpdates } from './update-wiring.js';

/**
 * Registers the service worker with the raw navigator.serviceWorker API
 * (vite.config.ts sets injectRegister: false; we never import
 * virtual:pwa-register). We never reload an unlocked session on our own: a
 * reload drops the in-memory master key (zero-knowledge) and forces a
 * re-unlock. A waiting update is therefore applied only from the pristine login
 * screen when no other client is open, or on explicit request from a blocking
 * surface such as the cockpit fallback (spec 2026-09-26). Active checks make
 * sure long-lived clients learn about new deploys at all.
 */
export function registerServiceWorker(): void {
  const base = import.meta.env.BASE_URL;
  void wireAppUpdates({
    container: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    // Mirrors vite-plugin-pwa 0.21: the build emits `${base}sw.js`; the dev
    // server serves the generateSW worker at `${base}dev-sw.js?dev-sw`, and
    // forces it to a classic worker for the generateSW strategy.
    swUrl: import.meta.env.DEV ? `${base}dev-sw.js?dev-sw` : `${base}sw.js`,
    scope: base,
    type: 'classic',
    quiesce: quiesceStrandedTab,
  });
}
