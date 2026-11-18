// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';
import { type WakeReason, holdScreen, letScreen } from './screen-wake-lock.js';

/** Holds the screen awake for `reason` while `active`; lets it go on unmount. */
export function useScreenWakeLock(reason: WakeReason, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    holdScreen(reason);
    return () => letScreen(reason);
  }, [reason, active]);
}
