// SPDX-License-Identifier: AGPL-3.0-only
import { useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { historyStateFor, recordLocation, trailOf } from '../state/nav-trail.store.js';

/**
 * Keeps every history entry's trail (spec "Back means one thing"). Mounted once,
 * before the route outlet: it records the trail while rendering, so a page's own
 * mount effects already see it, and mirrors it into `history.state.csTrail` so it
 * survives a reload. Pathnames only; nothing goes into the URL or storage.
 */
export function NavTrailTracker(): null {
  const location = useLocation();
  const type = useNavigationType();
  recordLocation(location, type);

  useLayoutEffect(() => {
    const state = historyStateFor(location.key);
    if (!state) return;
    const trail = trailOf(location.key);
    try {
      window.history.replaceState({ ...state, csTrail: [...trail] }, '');
    } catch {
      // A browser refusing state writes only costs the trail after a reload.
    }
  }, [location.key]);

  return null;
}
