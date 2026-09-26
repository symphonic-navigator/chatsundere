// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

/** Outcome of an explicit update check (spec 2026-09-26 §2.2). */
export type UpdateCheckResult = 'none' | 'installing' | 'ready';

/** The service-worker operations the store delegates to once registration exists. */
export interface UpdateBindings {
  /** Asks the waiting worker to take over; false when no worker is waiting. */
  apply: () => boolean;
  /** Asks the server for a new deploy, then reports the registration's state. */
  check: () => Promise<UpdateCheckResult>;
  /** Reports the registration's state without touching the network or the install. */
  peek: () => UpdateCheckResult;
}

interface AppUpdateState {
  updateReady: boolean;
  updatedElsewhere: boolean;
  /** This tab asked the waiting worker to take over and awaits its controllerchange. */
  applying: boolean;
  applyUpdate: () => void;
  checkForUpdate: () => Promise<UpdateCheckResult>;
  peekForUpdate: () => UpdateCheckResult;
  bind: (b: UpdateBindings) => void;
  markUpdateReady: () => void;
  markUpdatedElsewhere: () => void;
}

/** How long an apply may wait for its controllerchange before the latch lets go. */
export const APPLY_TIMEOUT_MS = 5_000;

let bindings: UpdateBindings | null = null;
let applyTimer: ReturnType<typeof setTimeout> | undefined;

/** Whether this tab initiated the pending update (see update-wiring controllerchange). */
export function isApplyingHere(): boolean {
  return useAppUpdateStore.getState().applying;
}

/** Update-delivery state shared by the login, cockpit fallback and account screens. */
export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  updateReady: false,
  updatedElsewhere: false,
  applying: false,
  applyUpdate: () => {
    // The latch guards against a second apply before the reload lands, and lets
    // the controllerchange listener tell our own update apart from another tab's.
    if (get().applying || !bindings) return;
    set({ applying: true });
    if (!bindings.apply()) {
      set({ applying: false });
      return;
    }
    // A worker that never activates (killed install, another tab's race) must not
    // leave Login's unlock controls disabled for good.
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => set({ applying: false }), APPLY_TIMEOUT_MS);
  },
  checkForUpdate: async () => (bindings ? await bindings.check() : 'none'),
  peekForUpdate: () => (bindings ? bindings.peek() : 'none'),
  bind: (b) => {
    bindings = b;
  },
  markUpdateReady: () => set({ updateReady: true }),
  markUpdatedElsewhere: () => set({ updatedElsewhere: true }),
}));

/** Test-only reset of module and store state. */
export function _resetAppUpdateForTests(): void {
  bindings = null;
  clearTimeout(applyTimer);
  applyTimer = undefined;
  useAppUpdateStore.setState({ updateReady: false, updatedElsewhere: false, applying: false });
}
