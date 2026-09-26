// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import { useEffect } from 'react';
import { useAppUpdateStore } from './app-update.store.js';
import { otherClientsOpen } from './presence.js';

/**
 * Applies a waiting update while the login form is untouched and no other
 * client is open — the one moment a reload costs nothing (spec 2026-09-26 §2.4).
 */
export function useApplyUpdateWhenPristine(isPristine: boolean): void {
  const updateReady = useAppUpdateStore((s) => s.updateReady);
  useEffect(() => {
    if (!updateReady || !isPristine) return;
    let cancelled = false;
    void otherClientsOpen().then((othersOpen) => {
      // Re-read the session at apply time: an unlock can land during the presence
      // wait, and a reload then would drop the freshly derived master key.
      if (cancelled || othersOpen || useSessionStore.getState().session !== null) return;
      useAppUpdateStore.getState().applyUpdate();
    });
    return () => {
      cancelled = true;
    };
  }, [updateReady, isPristine]);
}
