// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import type { Bounds } from './visualiser-renderers.js';

export interface AnalyserBounds {
  /** Whole viewport — there is no sidebar in chatsundere. */
  chatview: Bounds;
  /** The message column (`.chat-stream`), centred-on target for the bars. */
  textColumn: Bounds;
}

function viewportBounds(): Bounds {
  return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
}

/**
 * Track the chat message-column rectangle for the spectrum analyser. Observes
 * `.chat-stream` (the scroll container) and the viewport. Falls back to the
 * viewport for `textColumn` until the element mounts. Re-measures on resize.
 */
export function useAnalyserBounds(): AnalyserBounds {
  const [bounds, setBounds] = useState<AnalyserBounds>(() => ({
    chatview: viewportBounds(),
    textColumn: viewportBounds(),
  }));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const measure = (): void => {
      const el = document.querySelector('.chat-stream');
      const chatview = viewportBounds();
      const textColumn = el
        ? (() => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          })()
        : chatview;
      setBounds({ chatview, textColumn });
    };

    rafRef.current = requestAnimationFrame(measure);

    const ro = new ResizeObserver(measure);
    const el = document.querySelector('.chat-stream');
    if (el) ro.observe(el);
    window.addEventListener('resize', measure);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return bounds;
}
