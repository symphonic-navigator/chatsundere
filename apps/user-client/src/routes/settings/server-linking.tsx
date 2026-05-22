// SPDX-License-Identifier: AGPL-3.0-only
import { Navigate } from 'react-router-dom';

/**
 * Settings → Server linking — thin redirect to /onboarding/invitation.
 * The confirm sub-screen detects existing local session and switches to
 * late-link mode (no recovery reveal, existing MK preserved).
 */
export function ServerLinking() {
  return <Navigate to="/onboarding/invitation" replace />;
}
