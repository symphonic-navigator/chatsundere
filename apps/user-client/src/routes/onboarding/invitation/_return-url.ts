// SPDX-License-Identifier: AGPL-3.0-only

import { useSearchParams } from 'react-router-dom';
import { safeReturnPath } from '../../../lib/safe-return.js';

/**
 * Read and VALIDATE the ?return= query param; default to /onboarding. The value
 * feeds a real `<a href>` (the wizard back arrow), so it must be guarded against
 * open-redirect exactly like the login unlock target — see {@link safeReturnPath}.
 */
export function useReturnUrl(): string {
  const [params] = useSearchParams();
  return safeReturnPath(params.get('return'), '/onboarding');
}

/**
 * Returns a factory that builds route-navigation target objects preserving the
 * current search string. Used by forward step navigations so the ?return= query
 * param flows through all four wizard steps.
 */
export function useNavTarget(): (pathname: string) => { pathname: string; search: string } {
  const [params] = useSearchParams();
  const search = params.toString();
  return (pathname: string) => ({ pathname, search });
}
