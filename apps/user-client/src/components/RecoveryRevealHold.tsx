// SPDX-License-Identifier: AGPL-3.0-only
import { type ReactNode, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { type OnboardingState, useOnboardingStore } from '../state/onboarding.store.js';
import { toastStore } from '../state/toast.store.js';

const INVITATION_REVEAL = '/onboarding/invitation/recovery';

/** Where a held recovery key is shown, or null when none is waiting. */
export function revealHoldTarget(state: OnboardingState): string | null {
  if (state.kind === 'invitation_recovery') return INVITATION_REVEAL;
  if (state.kind === 'local_recovery') return state.at;
  return null;
}

/**
 * The recovery-key reveal is a point of no return (spec "Back means one thing",
 * Laura's spec-pass): the key is shown once, the account already exists, and on
 * Android there is no Forward. So while a key waits to be acknowledged, every
 * route the user lands on, by Back, a crumb or the logo, is replaced by the
 * reveal. Decided while rendering, so the page it replaces never mounts and its
 * effects (the Welcome screen's store reset, `/join`'s redirect) never run.
 */
export function RecoveryRevealHold({ children }: { children: ReactNode }): JSX.Element {
  const target = useOnboardingStore((s) => revealHoldTarget(s.state));
  const { pathname } = useLocation();
  if (target !== null && pathname !== target) {
    // The invitation reveal keeps the wizard's own `?return=`, held with the key.
    const held = useOnboardingStore.getState().state;
    const keep = held.kind === 'invitation_recovery' ? (held.search ?? '') : '';
    return (
      <>
        <HoldNotice />
        <Navigate to={{ pathname: target, search: keep }} replace />
      </>
    );
  }
  return <>{children}</>;
}

/** Says why the user is back on the key, so the bounce does not read as a fault. */
function HoldNotice(): null {
  useEffect(() => {
    toastStore.show({
      message: 'Save your recovery key, then Continue.',
      tone: 'info',
      durationMs: 3500,
    });
  }, []);
  return null;
}
