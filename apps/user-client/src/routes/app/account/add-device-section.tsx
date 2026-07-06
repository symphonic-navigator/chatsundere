// SPDX-License-Identifier: AGPL-3.0-only

import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { copy } from '../../../lib/copy.js';
import { HttpError } from '../../../lib/fetch.js';
import {
  type PairingCode,
  createPairingCode,
  listPairingCodes,
  revokePairingCode,
} from '../../../lib/pairing-codes.js';

const STAMP_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function formatStamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : STAMP_FORMAT.format(date);
}

/** A cancelled step-up ceremony surfaces as a 403 `step_up_required` — the user chose to cancel. */
function isCancelledStepUp(err: unknown): boolean {
  return err instanceof HttpError && err.status === 403 && err.code === 'step_up_required';
}

interface RevealCardProps {
  reveal: PairingCode;
  onDone: () => void;
}

/** Transient once-only reveal of a freshly created pairing code (QR + code + expiry). */
function RevealCard({ reveal, onDone }: RevealCardProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (canvasRef.current && reveal.qr_url) {
      void QRCode.toCanvas(canvasRef.current, reveal.qr_url, { width: 240 });
    }
  }, [reveal.qr_url]);

  return (
    <dialog
      open
      aria-label={copy.addDevice.heading}
      className="mx-auto mt-4 w-full max-w-sm rounded-[var(--radius-card)] bg-ink-soft px-5 py-4 ring-1 ring-inset ring-aurora-700/20"
    >
      <h3 className="font-display text-lg italic text-paper">{copy.addDevice.heading}</h3>
      <p className="mt-1 text-sm text-paper-soft">{copy.addDevice.shownOnce}</p>

      {reveal.qr_url && <canvas ref={canvasRef} className="mx-auto mt-4 block" />}

      {reveal.code && (
        <div className="mt-4 space-y-1">
          <p className="text-xs uppercase tracking-widest text-paper-soft">
            {copy.addDevice.codeLabel}
          </p>
          <p className="rounded-[var(--radius-card)] bg-ink px-3 py-2 text-center font-mono text-base tracking-widest text-paper">
            {reveal.code}
          </p>
        </div>
      )}

      <p className="mt-3 text-[11px] text-paper-soft">
        {`${copy.addDevice.expiresPrefix} ${formatStamp(reveal.expires_at)}`}
      </p>

      <button
        type="button"
        onClick={onDone}
        className="mt-4 w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90"
      >
        {copy.addDevice.doneCta}
      </button>
    </dialog>
  );
}

interface Props {
  baseUrl: string;
}

/**
 * "Add a device" section on the server-linking page. Lists the caller's active
 * pairing codes, and creates fresh ones on demand — each shown exactly once in a
 * transient reveal overlay (QR + code), because the server stores only a
 * fingerprint. Creating a code is tier-1 gated server-side; the apiFetch step-up
 * gate handles the confirmation prompt, and a cancelled ceremony is silent.
 */
export function AddDeviceSection({ baseUrl }: Props): JSX.Element {
  const [codes, setCodes] = useState<PairingCode[]>([]);
  const [listError, setListError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);
  const [reveal, setReveal] = useState<PairingCode | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await listPairingCodes(baseUrl);
      setCodes(list);
      setListError(false);
    } catch {
      setListError(true);
    }
  }, [baseUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate(): Promise<void> {
    setCreating(true);
    setCreateError(false);
    try {
      const created = await createPairingCode(baseUrl);
      setReveal(created);
    } catch (err) {
      // A cancelled step-up is the user's choice — stay silent.
      if (!isCancelledStepUp(err)) setCreateError(true);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string): Promise<void> {
    try {
      await revokePairingCode(baseUrl, id);
    } catch {
      // Best-effort; the refresh reflects the server's actual state.
    }
    await refresh();
  }

  function handleDone(): void {
    setReveal(null);
    void refresh();
  }

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-xs uppercase tracking-widest text-paper-soft">
          {copy.addDevice.heading}
        </h2>
        <p className="text-[11px] text-paper-soft">{copy.addDevice.body}</p>
      </div>

      <button
        type="button"
        onClick={() => void handleCreate()}
        disabled={creating}
        className="w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {creating ? copy.addDevice.creating : copy.addDevice.createCta}
      </button>

      {createError && <p className="text-xs text-danger">{copy.addDevice.createError}</p>}

      {reveal && <RevealCard reveal={reveal} onDone={handleDone} />}

      <p className="text-[11px] text-paper-soft">{copy.addDevice.standingNote}</p>

      <div className="space-y-2">
        <h3 className="text-xs uppercase tracking-widest text-paper-soft">
          {copy.addDevice.listHeading}
        </h3>

        {listError ? (
          <p className="text-xs text-danger">{copy.addDevice.listError}</p>
        ) : codes.length === 0 ? (
          <p className="text-[11px] text-paper-soft">{copy.addDevice.emptyList}</p>
        ) : (
          <ul className="space-y-2">
            {codes.map((code) => (
              <li
                key={code.id}
                className="flex items-center justify-between gap-4 rounded-[var(--radius-card)] bg-ink-soft px-3 py-2 ring-1 ring-inset ring-aurora-700/20"
              >
                <dl className="space-y-0.5 text-[11px] text-paper-soft">
                  <div>{`${copy.addDevice.createdPrefix} ${formatStamp(code.created_at)}`}</div>
                  <div>{`${copy.addDevice.expiresPrefix} ${formatStamp(code.expires_at)}`}</div>
                </dl>
                <button
                  type="button"
                  onClick={() => void handleRevoke(code.id)}
                  className="rounded-[var(--radius-card)] bg-ink px-3 py-1.5 text-xs font-medium text-paper-soft ring-1 ring-inset ring-aurora-700/20 transition-opacity hover:text-paper"
                >
                  {copy.addDevice.revokeCta}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
