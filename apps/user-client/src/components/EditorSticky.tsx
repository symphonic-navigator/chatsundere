// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

/**
 * Sticky wrapper for the top-of-page action bar on editor-class routes.
 * Children stay anchored to the viewport top as the surrounding content
 * scrolls. A backdrop-blur + hairline border lets underlying content
 * shimmer through, so the sticky region reads as a tool palette rather
 * than a solid header.
 *
 * Negative horizontal margin + padding extends the blur to the full
 * route gutter; consuming routes use px-4 today, so -mx-4 px-4 wins.
 *
 * The sticky offset (top-11 / lg:top-14) matches the root header's
 * measured height so the sticky region anchors just below the brand
 * bar rather than colliding with it (root has z-20, this has z-10).
 *
 * Spacing between multiple children is each consumer's responsibility;
 * this wrapper sets only its own outer padding (pt-1 pb-2).
 */
export function EditorSticky({ children }: Props): JSX.Element {
  return (
    <div
      data-editor-sticky=""
      className="sticky top-11 lg:top-14 z-10 -mx-4 px-4 pb-2 pt-1 bg-ink/80 backdrop-blur-sm border-b border-paper-soft/15"
    >
      {children}
    </div>
  );
}
