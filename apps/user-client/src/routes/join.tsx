// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import { MonitorSmartphone, Ticket } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { NavTile } from '../components/ui/NavTile.js';
import { parseJoinUrl } from '../lib/qr.js';
import { useOnboardingStore } from '../state/onboarding.store.js';
import { toastStore } from '../state/toast.store.js';

/**
 * `/join` — the landing surface a scanned Chatsundere QR resolves to (spec
 * §2.5(2)-(3)). It parses `window.location` (both the client-origin
 * `?server=…#code` and the legacy `…/join#code` forms via `parseJoinUrl`) and
 * routes by device state:
 *
 * - **Session-holder** → straight to `/app` with a constructive toast; a
 *   session-holder scanning a code has no useful join intent here (both would
 *   dead-end at the existing confirm-flow guards), so we never show the chooser.
 * - **No session, valid parse** → a minimal chooser (Welcome eyebrow + wordmark
 *   + one sentence + the two account-backed intents as gold `NavTile`s). Tapping
 *   a tile seeds the onboarding store exactly as the `kind_mismatch` handoff does
 *   (`invitation_input` / `pairing_input` with `{ baseUrl, code }`) and navigates
 *   to the flow **root** — never a `/confirm` deep-link.
 * - **No session, invalid parse** → a calm notice whose single action is
 *   labelled for its destination.
 *
 * Following the folded Laura HARD, the tiles stay ENABLED unconditionally —
 * there is deliberately no disabled-tiles state. This route runs no probe of
 * its own: the flow root is itself the prefilled form (it reads the seeded
 * store into its fields and probes on its own Continue, owning the retry /
 * unreachable copy), so an unreachable server always surfaces there, never
 * here. This route never wipes client data (Larissa INFO 2026-07-06 honoured).
 */
export function JoinLanding(): JSX.Element | null {
  const navigate = useNavigate();
  const session = useSessionStore((s) => s.session);
  const linkStatus = useAccountLinkStore((s) => s.linkStatus);
  const setOnboardingState = useOnboardingStore((s) => s.setState);

  // Parse once from the address bar — the fragment carries the code, so we read
  // the raw href rather than the router location.
  const parsed = useMemo(() => parseJoinUrl(window.location.href), []);

  // Session-holders get no chooser: redirect to /app with copy that branches on
  // link state (Laura SOFT). Runs in an effect so navigation happens after the
  // first paint, not during render.
  useEffect(() => {
    if (!session) return;
    const message =
      linkStatus === 'linked'
        ? 'This device is already linked to your account.'
        : "You're already set up on this device. Joining a server from a local-only account isn't available yet — it's on the way.";
    toastStore.show({ message, tone: 'info', durationMs: 6000 });
    navigate('/app', { replace: true });
  }, [session, linkStatus, navigate]);

  // Redirecting — render nothing rather than a flash of the chooser.
  if (session) return null;

  if (!parsed.ok) {
    return (
      <main className="flex min-h-dvh flex-col justify-center gap-4 px-4 py-6 text-center">
        <ChooserHeader />
        <p className="text-sm text-paper-soft">That link didn't carry a valid code.</p>
        <Link
          to="/onboarding"
          className="mx-auto block rounded-[var(--radius-card)] bg-aurora-700 px-6 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
        >
          Choose how to join
        </Link>
      </main>
    );
  }

  const { baseUrl, code } = parsed.value;

  const seedAndGo = (kind: 'invitation_input' | 'pairing_input', to: string) => (): void => {
    setOnboardingState({ kind, baseUrl, code });
    navigate(to);
  };

  return (
    <main className="flex min-h-dvh flex-col justify-center gap-3 px-4 py-6">
      <ChooserHeader />
      <p className="mb-2 text-center text-sm text-paper-soft">You scanned a Chatsundere code.</p>

      <NavTile
        colour="pink"
        gold
        icon={Ticket}
        label="I have an invitation"
        meta="From your operator"
        onActivate={seedAndGo('invitation_input', '/onboarding/invitation')}
      />
      <NavTile
        colour="pink"
        gold
        icon={MonitorSmartphone}
        label="Link this device to my account"
        meta="I'm already a user"
        onActivate={seedAndGo('pairing_input', '/onboarding/pairing')}
      />
    </main>
  );
}

/** The shared "Welcome" eyebrow + Chatsundere wordmark (onboarding-matrix chrome). */
function ChooserHeader(): JSX.Element {
  return (
    <header className="mb-2 text-center">
      <div className="text-[10px] uppercase tracking-[0.3em] text-paper-soft">Welcome</div>
      <div className="relative mt-1 inline-flex items-baseline">
        <span className="brand-logo-text font-display text-4xl">Chatsundere</span>
        <span className="brand-logo-twinkle" aria-hidden="true" style={{ fontSize: '1.1rem' }}>
          ✦
        </span>
      </div>
    </header>
  );
}
