// SPDX-License-Identifier: AGPL-3.0-only
import { motion } from '@chatsundere/ui-shared';
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useNavTransitionStore } from '../state/nav-transition.store.js';

/** Blink duration before navigation, so the gold trigger-blink is seen
 *  (matches the `cs-tile-blink` CSS at 0.26s). Tunable on device. */
export const NAV_BLINK_MS = 260;

/**
 * Returns an `activate(el, to)` that performs the Unified-Experience tile
 * activation (spec §3.1, §7): record the element's rect + current path so the
 * destination zooms out of it and the matching back collapses into it, play the
 * gold trigger-blink on the element, then navigate after the blink. Under
 * reduced motion it navigates immediately with no blink.
 */
export function useNavZoom(): (el: HTMLElement, to: string) => void {
  const navigate = useNavigate();
  const location = useLocation();
  const arm = useNavTransitionStore((s) => s.armFrom);
  return useCallback(
    (el, to) => {
      arm(el.getBoundingClientRect(), location.pathname);
      if (motion.respectsReducedMotion()) {
        navigate(to);
        return;
      }
      el.classList.add('cs-tile-blink');
      window.setTimeout(() => navigate(to), NAV_BLINK_MS);
    },
    [navigate, location.pathname, arm],
  );
}
