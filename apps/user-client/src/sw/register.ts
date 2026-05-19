// SPDX-License-Identifier: AGPL-3.0-only
import { registerSW } from 'virtual:pwa-register';
import { useUpdateStore } from '../state/update.store.js';

/** Registers the service worker and wires update events to the update store. */
export function registerServiceWorker(): void {
  const update = registerSW({
    immediate: false,
    onNeedRefresh() {
      useUpdateStore.getState().setNeedRefresh(true, () => {
        void update(true);
      });
    },
    onOfflineReady() {
      /* informational; we are local-first regardless */
    },
  });
}
