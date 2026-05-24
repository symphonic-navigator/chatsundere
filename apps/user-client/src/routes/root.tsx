import { useSessionStore } from '@chatsundere/ui-shared';
// SPDX-License-Identifier: AGPL-3.0-only
import { Link, Outlet } from 'react-router-dom';
import { ConnectivityBadge } from '../components/ConnectivityBadge.js';
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
 */
export function Root() {
  const session = useSessionStore((s) => s.session);
  const phase = useBootStore((s) => s.phase);
  const dismissed = useStagingBannerStore((s) => s.dismissed);
  const dismissBanner = useStagingBannerStore((s) => s.dismiss);

  const showRolledBackBanner =
    phase.kind === 'ready' && phase.staging.kind === 'rolled_back' && !dismissed;

  return (
    <div className="relative isolate min-h-dvh overflow-x-hidden">
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 backdrop-blur-sm lg:px-6 lg:py-4">
        {/* Logo — gradient wordmark + twinkle, sized via .brand-logo CSS */}
        <Link to="/" className="brand-logo">
          <span className="brand-logo-text">Chatsundere</span>
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
    </div>
  );
}
