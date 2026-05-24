// SPDX-License-Identifier: AGPL-3.0-only

import { useContext, useEffect, useRef, useState } from 'react';
import { SplashContext } from './SplashContext.js';

// Detect hard-reload (Ctrl+F5 / Ctrl+Shift+R). Browsers route hard-reloads
// around the Service Worker, so the navigation entry's transferSize is > 0;
// soft-reloads (F5) hit the SW cache and report transferSize === 0. Clearing
// splashShown here means the splash gating below sees a fresh session and
// replays the animation.
if (typeof window !== 'undefined') {
  try {
    const navEntry = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (navEntry?.type === 'reload' && (navEntry.transferSize ?? 0) > 0) {
      sessionStorage.removeItem('splashShown');
    }
  } catch {
    // Performance API or sessionStorage unavailable — degrade silently.
  }
}

const STORAGE_KEY = 'splashShown';
const HARD_TIMEOUT_MS = 3000;

/**
 * Cold-start splash overlay. Renders only when sessionStorage has not yet
 * marked the splash as shown. Layered above the routing tree at z-100;
 * the underlying route mounts and hydrates as normal while the overlay
 * is up.
 *
 * Skip paths:
 *   - click/tap anywhere in the overlay
 *   - Escape key
 *   - HARD_TIMEOUT_MS hard cap, independent of animation state
 *   - prefers-reduced-motion: handled in the CSS (no movement, just fade)
 *
 * Note: animation timing and FLIP migration are pure CSS + a single
 * imperative effect; this file owns the lifecycle only.
 */
export function SplashOverlay(): JSX.Element | null {
  const splashLogoRef = useRef<HTMLDivElement>(null);
  const { topbarLogoRef } = useContext(SplashContext);
  const [show, setShow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(STORAGE_KEY) === null;
  });

  useEffect(() => {
    if (!show) return;
    const dismiss = () => {
      sessionStorage.setItem(STORAGE_KEY, '1');
      setShow(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    const timeout = window.setTimeout(dismiss, HARD_TIMEOUT_MS);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('keydown', onKey);
    };
  }, [show]);

  useEffect(() => {
    if (!show) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let cancelled = false;
    const flipTimer = window.setTimeout(() => {
      if (cancelled) return;
      const splash = splashLogoRef.current;
      const topbar = topbarLogoRef.current;
      if (!splash || !topbar) return; // safety: cannot migrate without targets
      const splashRect = splash.getBoundingClientRect();
      const topbarRect = topbar.getBoundingClientRect();
      if (splashRect.width === 0 || topbarRect.width === 0) return;
      const scale = topbarRect.width / splashRect.width;
      const dx = topbarRect.left - splashRect.left;
      const dy = topbarRect.top - splashRect.top;
      splash.style.transformOrigin = 'top left';
      splash.style.transition = 'transform 500ms ease-in-out';
      splash.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      // After the migration completes, signal the topbar to reveal itself.
      window.setTimeout(() => {
        if (!cancelled) window.dispatchEvent(new Event('chatsundere:splash-flip-done'));
      }, 500);
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(flipTimer);
    };
  }, [show, topbarLogoRef]);

  if (!show) return null;

  const dismiss = () => {
    sessionStorage.setItem(STORAGE_KEY, '1');
    setShow(false);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: full-viewport interactive backdrop wrapping its own content; a native <button> wrapping rich content is semantically wrong
    <div
      role="button"
      aria-label="Skip intro"
      tabIndex={0}
      onClick={dismiss}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') dismiss();
      }}
      className="splash-overlay fixed inset-0 z-[100] flex items-center justify-center cursor-pointer"
    >
      <div className="splash-content flex flex-col items-center gap-6 text-center px-6">
        <div ref={splashLogoRef} className="splash-logo relative inline-flex items-baseline">
          <span className="brand-logo-text font-display text-5xl">Chatsundere</span>
          <span className="brand-logo-twinkle" aria-hidden="true" style={{ fontSize: '1.4rem' }}>
            ✦
          </span>
        </div>
        <p className="splash-tagline text-base text-paper">
          <span style={{ color: '#ff4dc8', fontWeight: 600 }}>Tsuntsun</span> towards regulation.{' '}
          <span style={{ color: '#ffd56b', fontWeight: 600 }}>Deredere</span> towards you.
        </p>
      </div>
    </div>
  );
}
