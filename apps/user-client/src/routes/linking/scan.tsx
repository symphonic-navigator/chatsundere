// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { copy } from '../../lib/copy.js';
import { parseInvitationPayload, scanWithCamera } from '../../lib/qr.js';
import { useLinkingStore } from '../../state/linking.store.js';

type ScanState =
  | { kind: 'starting' }
  | { kind: 'scanning' }
  | { kind: 'permission_denied' }
  | { kind: 'done' };

/**
 * `/linking/scan` — QR camera scan screen.
 *
 * On a successful scan that yields a valid invitation payload, stores it in
 * the linking Zustand store and navigates to `/linking/confirm`.
 * On permission denial, offers the paste fallback.
 */
export function LinkingScan() {
  const navigate = useNavigate();
  const setPayload = useLinkingStore((s) => s.setPayload);
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
          const result = parseInvitationPayload(raw);
          if (!result.ok) return; // Ignore unrecognised QR codes silently.
          if (cancelled) return;
          cancelled = true; // Prevent further callbacks.
          cleanup?.();
          cleanup = null;
          setPayload(result.value);
          setScanState({ kind: 'done' });
          navigate('/linking/confirm', { replace: true });
        });
        if (!cancelled) setScanState({ kind: 'scanning' });
      } catch (err) {
        if (cancelled) return;
        // Treat any getUserMedia / camera access failure as permission denied.
        void err;
        setScanState({ kind: 'permission_denied' });
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [navigate, setPayload]);

  const c = copy.linking.scan;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="font-display text-3xl italic tracking-tight text-aurora-200 lg:text-4xl">
          {c.title}
        </h1>

        {(scanState.kind === 'starting' || scanState.kind === 'scanning') && (
          <>
            <p className="text-sm leading-relaxed text-paper-soft">{c.body}</p>

            {/* Camera viewport */}
            <div className="relative overflow-hidden rounded-[var(--radius-card)] bg-ink ring-1 ring-inset ring-aurora-700/30">
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
              {/* Aiming reticle */}
              {scanState.kind === 'scanning' && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                >
                  <div className="h-48 w-48 rounded-lg ring-2 ring-aurora-400/60" />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <Link
                to="/linking/paste"
                className="rounded-[var(--radius-card)] bg-ink-soft px-4 py-3 text-center text-sm font-medium text-paper ring-1 ring-inset ring-aurora-700/30 transition-opacity hover:opacity-80"
              >
                {c.pasteFallbackCta}
              </Link>
              <Link
                to="/settings/server-linking"
                className="text-center text-sm text-paper-soft underline-offset-2 hover:text-paper hover:underline"
              >
                {c.cancelCta}
              </Link>
            </div>
          </>
        )}

        {scanState.kind === 'permission_denied' && (
          <div className="space-y-5">
            <div className="rounded-[var(--radius-card)] bg-warning/10 px-4 py-4 ring-1 ring-inset ring-warning/30">
              <p className="font-medium text-warning">{c.permissionDeniedTitle}</p>
              <p className="mt-1 text-sm leading-relaxed text-paper-soft">
                {c.permissionDeniedBody}
              </p>
            </div>
            <Link
              to="/linking/paste"
              className="block rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-center text-sm font-medium text-paper transition-opacity hover:opacity-90"
            >
              {c.pasteFallbackCta}
            </Link>
            <Link
              to="/settings/server-linking"
              className="block text-center text-sm text-paper-soft underline-offset-2 hover:text-paper hover:underline"
            >
              {c.cancelCta}
            </Link>
          </div>
        )}

        {/* 'done' state is transient — the navigate() fires immediately. */}
      </div>
    </div>
  );
}
