// SPDX-License-Identifier: AGPL-3.0-only

import { type RefObject, createContext } from 'react';

interface SplashContextValue {
  /** Ref to the topbar's brand-logo-text span. Read by SplashOverlay
   *  to compute the FLIP target position. May be null briefly during
   *  mount or in tests that don't render the Root layout. */
  topbarLogoRef: RefObject<HTMLElement | null>;
}

export const SplashContext = createContext<SplashContextValue>({
  topbarLogoRef: { current: null },
});
