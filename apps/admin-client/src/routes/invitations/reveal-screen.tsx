// SPDX-License-Identifier: AGPL-3.0-only
import type { AdminCreateInvitationResponse } from '@chatsundere/shared-types';
import QRCode from 'qrcode';
import { useEffect, useRef } from 'react';
import { SectionLabel, StatusLed } from '../../components/console.js';
import { copy } from '../../copy.js';

interface Props {
  invitation: AdminCreateInvitationResponse;
  onClose: () => void;
}

export function InvitationRevealScreen({ invitation, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (canvasRef.current) {
      void QRCode.toCanvas(canvasRef.current, invitation.qr_url, { width: 240 });
    }
  }, [invitation.qr_url]);

  return (
    <dialog
      open
      aria-labelledby="reveal-title"
      className="space-y-4 rounded-xl border border-[var(--color-surface-0)] bg-[var(--color-mantle)] p-6"
    >
      <h2 id="reveal-title">
        <SectionLabel>{copy.invitations.reveal.title}</SectionLabel>
      </h2>
      <p className="flex items-center gap-2 text-[var(--color-yellow)]">
        <StatusLed tone="yellow" />
        {copy.invitations.reveal.warning}
      </p>
      <div className="text-center font-mono text-2xl tracking-[0.3em]">{invitation.code}</div>
      <canvas ref={canvasRef} className="mx-auto block" />
      <label className="block text-sm">
        {copy.invitations.reveal.urlLabel}
        <input
          readOnly
          aria-label={copy.invitations.reveal.urlLabel}
          value={invitation.qr_url}
          className="mt-1 w-full rounded-md border border-[var(--color-surface-0)] bg-[var(--color-crust)] px-2 py-1 font-mono text-xs"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(invitation.qr_url)}
          className="rounded-md bg-[var(--color-base)] px-3 py-1"
        >
          {copy.invitations.reveal.copyUrl}
        </button>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(invitation.code)}
          className="rounded-md bg-[var(--color-base)] px-3 py-1"
        >
          {copy.invitations.reveal.copyCode}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-[var(--color-mauve)] px-3 py-1 text-[var(--color-base)]"
        >
          {copy.invitations.reveal.close}
        </button>
      </div>
    </dialog>
  );
}
