// SPDX-License-Identifier: LGPL-3.0-only
import type { StepUpTier } from '@chatsundere/shared-types';
import { create } from 'zustand';

interface PendingStepUp {
  tier: StepUpTier;
  resolvers: Array<(confirmed: boolean) => void>;
}

interface StepUpState {
  pending: PendingStepUp | null;
}

/**
 * Promise gate between the apiFetch interceptor (non-React) and the mounted
 * StepUpModal (React). One pending request at a time; concurrent callers
 * coalesce onto the same resolution (spec §7.1 — mixed-tier surfaces must
 * re-key this per tier before any Tier-3 user-client UI lands).
 */
export const useStepUpStore = create<StepUpState>(() => ({ pending: null }));

/** Requests a step-up confirmation; resolves true when the user confirmed. */
export function requestStepUp(tier: StepUpTier): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const { pending } = useStepUpStore.getState();
    if (pending) {
      pending.resolvers.push(resolve);
      return;
    }
    useStepUpStore.setState({ pending: { tier, resolvers: [resolve] } });
  });
}

/** Called by the modal on confirm (true) or cancel (false). */
export function resolveStepUp(confirmed: boolean): void {
  const { pending } = useStepUpStore.getState();
  if (!pending) return;
  useStepUpStore.setState({ pending: null });
  for (const resolve of pending.resolvers) resolve(confirmed);
}
