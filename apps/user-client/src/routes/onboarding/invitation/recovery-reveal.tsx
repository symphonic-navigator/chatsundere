// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppNav } from '../../../lib/use-app-nav.js';
import { useOnboardingStore } from '../../../state/onboarding.store.js';
import { StepRecoveryReveal } from '../local/step-recovery-reveal.js';
import { useReturnUrl } from './_return-url.js';

/**
 * `/onboarding/invitation/recovery` — mandatory recovery-key reveal for the
 * fresh-PWA invitation path. Late-link skips this screen (recovery already
 * exists on the device).
 */
export function InvitationRecoveryReveal() {
  const navigate = useNavigate();
  const nav = useAppNav();
  const returnUrl = useReturnUrl();
  const state = useOnboardingStore((s) => s.state);

  useEffect(() => {
    if (state.kind !== 'invitation_recovery') {
      nav.returnTo(returnUrl);
    }
  }, [state.kind, nav, returnUrl]);

  if (state.kind !== 'invitation_recovery') return null;

  return (
    <StepRecoveryReveal
      recoveryKey={state.recoveryKeyString}
      onDone={() => {
        useOnboardingStore.getState().reset();
        // The first run ends here: its steps leave the history.
        nav.resetTo('/app');
      }}
    />
  );
}
