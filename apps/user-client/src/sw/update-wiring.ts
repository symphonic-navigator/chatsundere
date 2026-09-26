// SPDX-License-Identifier: AGPL-3.0-only
import { type UpdateCheckResult, isApplyingHere, useAppUpdateStore } from './app-update.store.js';
import { startPresenceResponder } from './presence.js';

/** How often an open client re-checks for a new deploy (spec 2026-09-26 §2.3). */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** What wireAppUpdates needs from the page — injected so tests never touch the real container. */
export interface WireOptions {
  /** navigator.serviceWorker, or undefined where service workers are unsupported. */
  container: ServiceWorkerContainer | undefined;
  swUrl: string;
  scope: string;
  type: WorkerType;
  /** Stops this tab writing once another tab's update strands it. */
  quiesce: () => Promise<void>;
  reload?: () => void;
}

/** Reports whether a new version is waiting, installing, or absent — no network, no install. */
export function peekRegistration(reg: ServiceWorkerRegistration): UpdateCheckResult {
  if (reg.waiting) {
    // A worker can be waiting before our updatefound listener saw it install.
    useAppUpdateStore.getState().markUpdateReady();
    return 'ready';
  }
  return reg.installing ? 'installing' : 'none';
}

/** Runs one update check and reports whether a new version is waiting, installing, or absent. */
export async function checkRegistration(
  reg: ServiceWorkerRegistration,
): Promise<UpdateCheckResult> {
  if (navigator.onLine) {
    try {
      await reg.update();
    } catch {
      // Background freshness probe — a transient network error must not surface.
    }
  }
  return peekRegistration(reg);
}

/**
 * Registers the service worker and connects it to the app-update store, the
 * check cadence and the presence responder. We own the registration rather
 * than using vite-plugin-pwa's registerSW, whose prompt mode reloads every tab
 * that saw a waiting worker once any tab applies it — reloading unlocked
 * sessions, which we never do (spec 2026-09-26 §2).
 */
export async function wireAppUpdates({
  container,
  swUrl,
  scope,
  type,
  quiesce,
  reload = () => location.reload(),
}: WireOptions): Promise<void> {
  startPresenceResponder();
  if (!container) return;

  const controllerAtWiring = container.controller;
  // First-ever install gains a controller too; only a *replacement* strands this tab.
  const hadController = controllerAtWiring !== null;
  const strand = (): void => {
    if (useAppUpdateStore.getState().updatedElsewhere) return;
    useAppUpdateStore.getState().markUpdatedElsewhere();
    void quiesce();
  };

  container.addEventListener('controllerchange', () => {
    if (isApplyingHere()) {
      reload();
      return;
    }
    if (!hadController) return;
    strand();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // A frozen or backgrounded tab can miss both the presence ping and the
    // controllerchange event; the controller identity still tells the truth.
    if (hadController && !isApplyingHere() && container.controller !== controllerAtWiring) strand();
  });

  let reg: ServiceWorkerRegistration;
  try {
    reg = await container.register(swUrl, { scope, type });
  } catch (err) {
    console.error('[app-update] service worker registration failed', err);
    return;
  }

  useAppUpdateStore.getState().bind({
    apply: () => {
      const waiting = reg.waiting;
      if (!waiting) return false;
      // Handled by the generated sw.js (registerType 'prompt') via self.skipWaiting().
      waiting.postMessage({ type: 'SKIP_WAITING' });
      return true;
    },
    check: () => checkRegistration(reg),
    peek: () => peekRegistration(reg),
  });

  // A waiting worker only means "update" when something already controls this
  // page; on a first install there is nothing to update from.
  if (reg.waiting && container.controller) useAppUpdateStore.getState().markUpdateReady();
  reg.addEventListener('updatefound', () => {
    const incoming = reg.installing;
    if (!incoming) return;
    incoming.addEventListener('statechange', () => {
      if (incoming.state === 'installed' && container.controller)
        useAppUpdateStore.getState().markUpdateReady();
    });
  });

  void checkRegistration(reg);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !useAppUpdateStore.getState().updatedElsewhere)
      void checkRegistration(reg);
  });
  setInterval(() => void checkRegistration(reg), UPDATE_CHECK_INTERVAL_MS);
}
