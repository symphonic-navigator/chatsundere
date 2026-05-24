// SPDX-License-Identifier: AGPL-3.0-only

import { useSearchParams } from 'react-router-dom';

/** Read the ?return= query param; default to /onboarding. */
export function useReturnUrl(): string {
  const [params] = useSearchParams();
  return params.get('return') ?? '/onboarding';
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
