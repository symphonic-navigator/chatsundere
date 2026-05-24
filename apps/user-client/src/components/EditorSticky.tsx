// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

/**
 * Sticky wrapper for the top-of-page action bar on editor-class routes.
 * Children stay anchored to the viewport top as the surrounding content
 * scrolls. A backdrop-blur + hairline border lets underlying content
 * shimmer through, so the sticky region reads as a transparent tool
 * palette rather than a solid header.
 *
 * The sticky offset (top-11 / lg:top-14) matches the root header's
 * measured height so the sticky region anchors just below the brand
 * bar rather than colliding with it (root has z-20, this has z-10).
 *
 * The -mt-4 cancels the consumer route's standard `<section pt-4>`
 * padding so the sticky region's box-top sits flush with the brand-bar
 * bottom (= main-top). Without it there is a ~16 px scroll-lag before
 * sticky engages. Consumers must continue to use pt-4 on their section
 * wrapper for this to work; pt-4 inside EditorSticky restores the same
 * 16 px of breathing room above the children that the consumer's pt-4
 * used to provide.
 *
 * Negative horizontal margin + padding (-mx-4 px-4) extends the blur
 * to the full route gutter; consuming routes use px-4 today.
 *
 * Spacing between multiple children is each consumer's responsibility;
 * this wrapper sets only its own outer padding (pt-4 pb-2).
 */
export function EditorSticky({ children }: Props): JSX.Element {
  return (
    <div
      data-editor-sticky=""
      className="sticky top-11 lg:top-14 z-10 -mt-4 -mx-4 px-4 pb-2 pt-4 backdrop-blur-sm border-b border-paper-soft/15"
    >
      {children}
    </div>
  );
}
