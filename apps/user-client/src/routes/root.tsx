import { useSessionStore } from '@chatsundere/ui-shared';
import { ArrowLeft } from 'lucide-react';
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AdultModeToggle } from '../components/AdultModeToggle.js';
import { BackgroundStreamBadge } from '../components/BackgroundStreamBadge.js';
import { ConnectivityBadge } from '../components/ConnectivityBadge.js';
import NavTransitionOutlet from '../components/NavTransitionOutlet.js';
import { PersonaAvatar } from '../components/PersonaAvatar.js';
import { SplashContext } from '../components/SplashContext.js';
import { SplashOverlay } from '../components/SplashOverlay.js';
import { SyncSurfaceHost } from '../components/SyncSurfaceHost.js';
import { Toast } from '../components/Toast.js';
import { ScreenEffectsOverlay } from '../components/effects/ScreenEffectsOverlay.js';
import { copy } from '../lib/copy.js';
import { useBootStore } from '../state/boot.store.js';
import { useCurrentChatStore } from '../state/current-chat.store.js';
import { useStagingBannerStore } from '../state/staging-banner.store.js';

/** True only for the chat surface itself (`/app/chat/:chatId` or `/app/chat/new`),
 *  not its cockpit sub-pages — so those fall back to standard page chrome. */
export function isExactChatRoute(pathname: string): boolean {
  return /^\/app\/chat\/[^/]+$/.test(pathname);
}

/**
 * Root layout wrapper. Renders the header, global banners, and the page outlet.
 *
 * Banners rendered here appear across every route inside the Root layout:
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
  const location = useLocation();
  const navigate = useNavigate();
  const isInteractionMode = useCurrentChatStore((s) => s.isInteractionMode);
  const chatHeader = useCurrentChatStore((s) => s.chatHeader);

  // Chrome trims down inside a chat: the username + connectivity badge drop
  // away in both chat sub-modes (reading and cockpit-open); in read-only mode
  // the logo also goes and the bar collapses to a thin strip to reclaim
  // vertical space (paired with .chat-page[data-mode="reading"] top in CSS).
  // The adult-mode pill is suppressed on the login screen.
  const isChatRoute = isExactChatRoute(location.pathname);
  const isReadingChat = isChatRoute && !isInteractionMode;
  const isLoginRoute = location.pathname.startsWith('/login');

  // Dim the body aurora on /app subroutes (chat, circle, persona-editor,
  // settings, account) so the mindspace texture is the visually dominant
  // background layer. The aurora stays as a faint atmospheric presence
  // underneath. Exactly /app (Entrance Hall), /, login, onboarding and
  // /change-passphrase keep the full aurora.
  useEffect(() => {
    const dim = /^\/app\/.+/.test(location.pathname);
    document.body.classList.toggle('dim-ambient', dim);
  }, [location.pathname]);

  useEffect(() => {
    return () => document.body.classList.remove('dim-ambient');
  }, []);

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
      <div className="relative isolate min-h-dvh overflow-x-clip">
        <header
          className={`sticky top-0 z-20 flex items-center justify-between gap-2 backdrop-blur-sm ${
            isChatRoute
              ? // Inside a chat the brand bar is constrained to the chat column
                // (floats over the aurora like .chat-page), 0.75rem inline
                // padding so the logo lines up with the hamburger below. In
                // interaction mode it takes the dark fill (matching the chat
                // topbar) at a middle height and sits flush against it (no gap
                // — see .chat-page top). Reading mode stays ultra-thin and
                // transparent (a dark strip there reads oddly over the quiet
                // reading surface). Paired with .chat-page top in index.css.
                `mx-auto w-full max-w-[420px] px-3 lg:max-w-[640px] ${
                  isReadingChat ? 'py-1 lg:py-1.5' : 'bg-black/40 py-2 lg:py-2.5'
                }`
              : 'px-4 py-3 lg:px-6 lg:py-4'
          }`}
        >
          {/* Left cluster — exit/logo + persona avatar (reading-chat mode) +
              transient background-stream badge. In reading-chat mode the logo
              shrinks to the small variant and gains an arrow prefix, making the
              whole affordance an explicit "leave chat" tap to the Entrance Hall.
              The avatar button navigates to the persona hub. */}
          <div className="flex min-w-0 items-center gap-2">
            <Link
              to={isReadingChat ? '/app' : '/'}
              className={`brand-logo${isReadingChat ? ' brand-logo-small' : ''} flex items-center gap-1`}
              style={{ opacity: topbarLogoVisible ? 1 : 0 }}
              aria-label={isReadingChat ? 'Leave chat' : 'Chatsundere home'}
            >
              {isReadingChat && <ArrowLeft size={18} aria-hidden="true" />}
              <span
                ref={(el) => {
                  topbarLogoRef.current = el;
                }}
                className="brand-logo-text"
              >
                Chatsundere
              </span>
              {!isReadingChat && (
                <span className="brand-logo-twinkle" aria-hidden="true">
                  ✦
                </span>
              )}
            </Link>
            {isReadingChat && chatHeader ? (
              <button
                type="button"
                className="topbar-persona-link"
                aria-label={`Go to ${chatHeader.name}`}
                onClick={() =>
                  // Thread the chat as the return path so the persona page's
                  // back control comes straight back here (mirrors the chat's
                  // own "open persona" nav — chat-page onOpenPersonaEditor).
                  navigate(
                    `/app/persona/${chatHeader.personaId}?return=${encodeURIComponent(
                      `${location.pathname}${location.search}`,
                    )}`,
                  )
                }
              >
                <PersonaAvatar
                  personaId={chatHeader.personaId}
                  name={chatHeader.name}
                  colour={chatHeader.colour}
                  size={28}
                />
              </button>
            ) : null}
            <BackgroundStreamBadge />
          </div>
          {/* Right cluster — chat title (reading mode, plain display only), then
              adult-mode pill kept off-centre (away from device cameras), then
              identity. Username + connectivity drop away inside a chat; the
              pill also hides on the login screen. */}
          <div className="flex min-w-0 items-center gap-2 lg:gap-3">
            {isReadingChat && chatHeader ? (
              <span
                className="max-w-[140px] truncate text-xs text-paper-soft"
                title={chatHeader.title}
              >
                {chatHeader.title}
              </span>
            ) : null}
            {!isLoginRoute && <AdultModeToggle />}
            {/* Username hidden on mobile — too cramped at 380 px */}
            {!isChatRoute && session && (
              <span className="hidden font-mono text-xs text-paper-soft lg:inline">
                {session.username}
              </span>
            )}
            {!isChatRoute && <ConnectivityBadge />}
          </div>
        </header>
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
          <NavTransitionOutlet />
        </main>
        <SplashOverlay />
        <ScreenEffectsOverlay />
        <SyncSurfaceHost />
        <Toast />
      </div>
    </SplashContext.Provider>
  );
}
