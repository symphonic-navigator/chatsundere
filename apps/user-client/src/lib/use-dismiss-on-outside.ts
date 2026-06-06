// SPDX-License-Identifier: AGPL-3.0-only
import { type RefObject, useEffect, useRef } from 'react';

/**
 * Close a transient popover when the user taps outside `ref` or presses Escape.
 * No-op while `open` is false. `onClose` is read through a ref so an inline
 * arrow callback does not re-subscribe the listeners on every render (preserving
 * the original `[open]`-only effect dependency).
 */
export function useDismissOnOutside(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      if (!target || !ref.current) return;
      if (ref.current.contains(target)) return;
      cb.current();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cb.current();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ref]);
}
