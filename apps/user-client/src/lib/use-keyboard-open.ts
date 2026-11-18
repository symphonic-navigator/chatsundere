// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';

/** How far the visual viewport must shrink below the layout viewport to count
 *  as a software keyboard rather than browser chrome (the URL bar's collapse
 *  is well under this). */
const KEYBOARD_THRESHOLD_PX = 120;

/** The attribute on `<html>` the CSS keys off. */
export const KEYBOARD_OPEN_ATTRIBUTE = 'data-keyboard-open';

/**
 * Marks `<html>` with `data-keyboard-open` while the software keyboard is up,
 * judged by the visual viewport shrinking more than 120 px below the window.
 *
 * Some iOS versions and standalone modes keep reporting a non-zero
 * `safe-area-inset-bottom` while the keyboard is up, which would leave a dead
 * band between the composer and the keyboard; the CSS drops the inset under
 * this attribute. Without `visualViewport` it does nothing. The attribute is
 * removed on unmount.
 */
export function useKeyboardOpen(): void {
  useEffect(() => {
    const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = (): void => {
      if (vv.height < window.innerHeight - KEYBOARD_THRESHOLD_PX) {
        root.setAttribute(KEYBOARD_OPEN_ATTRIBUTE, '');
      } else root.removeAttribute(KEYBOARD_OPEN_ATTRIBUTE);
    };
    update();
    vv.addEventListener('resize', update);
    return () => {
      vv.removeEventListener('resize', update);
      root.removeAttribute(KEYBOARD_OPEN_ATTRIBUTE);
    };
  }, []);
}
