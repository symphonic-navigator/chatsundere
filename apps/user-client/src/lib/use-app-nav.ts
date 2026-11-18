// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { claimTraversal, trailOf } from '../state/nav-trail.store.js';
import { type Trail, findReturnDepth } from './nav-trail.js';

/** The app's ways of going back (spec "Back means one thing", "Three moves"). */
export interface AppNav {
  /** One step back when an in-app entry is behind; else replace with `fallback`. */
  back: (fallback: string) => void;
  /** Unwind to the nearest entry behind with `to`'s pathname; else replace with `to`. */
  returnTo: (to: string) => void;
  /** The pathnames behind the current entry, oldest first. */
  trail: () => Trail;
}

/** `‹`, crumbs, save-then-leave and returns all go through here, so they agree. */
export function useAppNav(): AppNav {
  const navigate = useNavigate();
  const { key } = useLocation();
  return useMemo(
    () => ({
      back(fallback) {
        if (trailOf(key).length === 0) navigate(fallback, { replace: true });
        else if (claimTraversal(key)) navigate(-1);
      },
      returnTo(to) {
        const depth = findReturnDepth(trailOf(key), to);
        if (depth === null) navigate(to, { replace: true });
        else if (claimTraversal(key)) navigate(-depth);
      },
      trail: () => trailOf(key),
    }),
    [navigate, key],
  );
}
