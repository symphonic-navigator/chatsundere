// SPDX-License-Identifier: AGPL-3.0-only
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { computeTransformOrigin } from '../lib/origin-zoom.js';
import { useNavTransitionStore } from '../state/nav-transition.store.js';

/**
 * Wraps the route outlet and drives the bidirectional Unified-Experience zoom
 * (spec §7). PUSH (rein, from a NavTile): the entering route grows out of the
 * armed rect (`cs-zoom-in`). Raus (back via PUSH or POP): when navigation
 * returns to the path the tile lived on, the leaving view is held as an overlay
 * and collapses into the same rect (`cs-zoom-out`) before the new route shows.
 * Central — the shared topbar and every destination screen are untouched.
 */
export default function NavTransitionOutlet(): JSX.Element {
  const location = useLocation();
  const outlet = useOutlet();
  const consume = useNavTransitionStore((s) => s.consume);
  const peekLast = useNavTransitionStore((s) => s.peekLast);
  const clearLast = useNavTransitionStore((s) => s.clearLast);

  const stageRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
  const prevPath = useRef(location.pathname);
  const prevOutlet = useRef<ReactNode>(outlet);

  const [enterZoom, setEnterZoom] = useState(false);
  const [exit, setExit] = useState<{ node: ReactNode; origin: string } | null>(null);

  // Transition effect: runs before paint so origins are set without a flash.
  // Reads prevOutlet.current (the leaving view) BEFORE the keep-fresh effect
  // below overwrites it — declaration order matters.
  useLayoutEffect(() => {
    if (location.pathname === prevPath.current) return;
    const stage = stageRef.current;
    const enterRect = consume();
    if (enterRect) {
      const zoom = zoomRef.current;
      if (zoom) {
        zoom.style.transformOrigin = computeTransformOrigin(
          enterRect,
          zoom.getBoundingClientRect(),
        );
        setEnterZoom(true);
      }
    } else {
      const last = peekLast();
      if (last && location.pathname === last.path) {
        clearLast();
        const origin = stage
          ? computeTransformOrigin(last.rect, stage.getBoundingClientRect())
          : '50% 50%';
        setExit({ node: prevOutlet.current, origin });
      }
    }
    prevPath.current = location.pathname;
  }, [location.pathname, consume, peekLast, clearLast]);

  // Keep the "previous outlet" pointer fresh; declared AFTER the transition
  // effect so the transition reads the pre-change value first.
  useLayoutEffect(() => {
    prevOutlet.current = outlet;
  }, [outlet]);

  return (
    <div ref={stageRef} className="cs-transition-stage">
      <div
        key={location.pathname}
        ref={zoomRef}
        className={enterZoom ? 'cs-zoom-in' : undefined}
        onAnimationEnd={() => setEnterZoom(false)}
      >
        {outlet}
      </div>
      {exit ? (
        <div
          className="cs-exit-layer cs-zoom-out"
          style={{ transformOrigin: exit.origin }}
          onAnimationEnd={() => setExit(null)}
          aria-hidden="true"
        >
          {exit.node}
        </div>
      ) : null}
    </div>
  );
}
