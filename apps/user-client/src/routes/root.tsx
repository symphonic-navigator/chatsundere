import { useSessionStore } from '@chatsundere/ui-shared';
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { ConnectivityBadge } from '../components/ConnectivityBadge.js';
import { SplashContext } from '../components/SplashContext.js';
import { SplashOverlay } from '../components/SplashOverlay.js';
import { UpdateBanner } from '../components/UpdateBanner.js';
import { copy } from '../lib/copy.js';
import { useBootStore } from '../state/boot.store.js';
import { useStagingBannerStore } from '../state/staging-banner.store.js';

/**
 * Root layout wrapper. Renders the header, global banners, and the page outlet.
 *
 * Banners rendered here appear across every route inside the Root layout:
 * - UpdateBanner: service-worker update available.
 * - StagingRollbackBanner: shown once per boot when the previous passphrase
 *   change did not complete and was silently rolled back on start-up.
 *
 * Also hosts the cold-start splash overlay (SplashOverlay) and the context
 * the overlay reads to measure the topbar logo's position for its FLIP
 * migration. The topbar logo is held at opacity 0 until either the FLIP
 * completes or the splash dismisses without one (polled fallback).
 */
export function Root() {
  const session = useSessionStore((s) => s.session);
  const phase = useBootStore((s) => s.phase);
  const dismissed = useStagingBannerStore((s) => s.dismissed);
  const dismissBanner = useStagingBannerStore((s) => s.dismiss);

  const showRolledBackBanner =
    phase.kind === 'ready' && phase.staging.kind === 'rolled_back' && !dismissed;

  // useRef MUST be called once per Root mount (not inlined in JSX). The
  // SplashOverlay's FLIP effect depends on a stable ref identity; a fresh
  // object each render would re-arm its 1.5s timer endlessly.
  const topbarLogoRef = useRef<HTMLElement | null>(null);
  const [topbarLogoVisible, setTopbarLogoVisible] = useState<boolean>(() => {
    // Topbar logo is hidden during the splash; visible immediately otherwise
    // (no splash this session, or reduced motion).
    if (typeof window === 'undefined') return true;
    if (sessionStorage.getItem('splashShown') !== null) return true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    return false;
  });

  useEffect(() => {
    if (topbarLogoVisible) return;
    const onFlipDone = () => setTopbarLogoVisible(true);
    window.addEventListener('chatsundere:splash-flip-done', onFlipDone);
    // Safety: if the splash dismisses without a FLIP (tap-to-skip, hard timeout),
    // still reveal the topbar logo so the user never sees a blank header.
    // sessionStorage events don't fire in the same document, so we poll.
    let elapsed = 0;
    const pollId = window.setInterval(() => {
      if (sessionStorage.getItem('splashShown') !== null) {
        setTopbarLogoVisible(true);
        window.clearInterval(pollId);
      }
      elapsed += 150;
      if (elapsed > 3500) window.clearInterval(pollId);
    }, 150);
    return () => {
      window.removeEventListener('chatsundere:splash-flip-done', onFlipDone);
      window.clearInterval(pollId);
    };
  }, [topbarLogoVisible]);

  return (
    <SplashContext.Provider value={{ topbarLogoRef }}>
      <div className="relative isolate min-h-dvh overflow-x-hidden">
        <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 backdrop-blur-sm lg:px-6 lg:py-4">
          {/* Logo — gradient wordmark + twinkle, sized via .brand-logo CSS */}
          <Link to="/" className="brand-logo" style={{ opacity: topbarLogoVisible ? 1 : 0 }}>
            <span
              ref={(el) => {
                topbarLogoRef.current = el;
              }}
              className="brand-logo-text"
            >
              Chatsundere
            </span>
            <span className="brand-logo-twinkle" aria-hidden="true">
              ✦
            </span>
          </Link>
          <div className="flex items-center gap-2 lg:gap-3">
            {/* Username hidden on mobile — too cramped at 380 px */}
            {session && (
              <span className="hidden font-mono text-xs text-paper-soft lg:inline">
                {session.username}
              </span>
            )}
            <ConnectivityBadge />
          </div>
        </header>
        <UpdateBanner />
        {showRolledBackBanner && (
          <div className="flex items-center justify-between gap-4 bg-warning/10 px-6 py-2 ring-1 ring-inset ring-warning/30">
            <p className="font-mono text-xs text-warning">{copy.stagingBanner.rolledBack}</p>
            <button
              type="button"
              onClick={dismissBanner}
              className="shrink-0 font-mono text-xs uppercase tracking-wider text-warning/70 hover:text-warning"
            >
              {copy.stagingBanner.dismissCta}
            </button>
          </div>
        )}
        <main className="mx-auto w-full max-w-[420px] px-6 pb-12 lg:max-w-[640px]">
          <Outlet />
        </main>
        <SplashOverlay />
      </div>
    </SplashContext.Provider>
  );
}
