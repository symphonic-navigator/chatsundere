// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { parseJoinUrl, scanWithCamera } from '../../../lib/qr.js';
import { useOnboardingStore } from '../../../state/onboarding.store.js';

type ScanState = { kind: 'starting' } | { kind: 'scanning' } | { kind: 'permission_denied' };

/**
 * `/onboarding/invitation/scan` — camera scan route. On a successful scan
 * of a /join#CODE URL, pre-fills the invitation form's store state and
 * navigates back to the form (which can then proceed to confirm).
 */
export function InvitationScan() {
  const navigate = useNavigate();
  const setOnboardingState = useOnboardingStore((s) => s.setState);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanState, setScanState] = useState<ScanState>({ kind: 'starting' });

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const el = videoRef.current;
      if (!el) return;
      try {
        cleanup = await scanWithCamera(el, (raw) => {
          if (cancelled) return;
          const result = parseJoinUrl(raw);
          if (!result.ok) return;
          cancelled = true;
          cleanup?.();
          cleanup = null;
          setOnboardingState({
            kind: 'invitation_input',
            baseUrl: result.value.baseUrl,
            code: result.value.code,
          });
          navigate('/onboarding/invitation', { replace: true });
        });
        if (!cancelled) setScanState({ kind: 'scanning' });
      } catch {
        if (!cancelled) setScanState({ kind: 'permission_denied' });
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [navigate, setOnboardingState]);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
      <Link to="/onboarding/invitation" aria-label="Back" className="text-2xl text-paper-soft">
        ←
      </Link>

      <h1 className="mt-4 font-display text-3xl italic">Scan QR code</h1>

      {scanState.kind === 'permission_denied' ? (
        <>
          <div className="mt-4 rounded-[var(--radius-card)] bg-warning/10 px-4 py-4 ring-1 ring-inset ring-warning/30">
            <p className="font-medium text-warning">Camera unavailable</p>
            <p className="mt-1 text-sm text-paper-soft">
              Use the form instead, or grant camera permission and reload.
            </p>
          </div>
          <Link
            to="/onboarding/invitation"
            className="mt-4 block rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-center text-sm font-medium text-paper transition-opacity hover:opacity-90"
          >
            Use the form instead
          </Link>
        </>
      ) : (
        <div className="relative mt-4 overflow-hidden rounded-[var(--radius-card)] bg-ink ring-1 ring-inset ring-aurora-700/30">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            playsInline
            muted
            className="aspect-square w-full object-cover"
            aria-label="Camera viewfinder"
          />
          {scanState.kind === 'starting' && (
            <div className="absolute inset-0 flex items-center justify-center bg-ink/60">
              <p className="font-mono text-xs text-paper-soft">Starting camera…</p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
