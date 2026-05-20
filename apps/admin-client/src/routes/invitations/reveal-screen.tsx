// SPDX-License-Identifier: AGPL-3.0-only
import QRCode from 'qrcode';
import { useEffect, useRef } from 'react';
import { copy } from '../../copy.js';
import type { InvitationCreated } from '../../data/admin-api.js';

interface Props {
  invitation: InvitationCreated;
  onClose: () => void;
}

export function InvitationRevealScreen({ invitation, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (canvasRef.current) {
      void QRCode.toCanvas(canvasRef.current, invitation.qr_payload, { width: 240 });
    }
  }, [invitation.qr_payload]);

  return (
    <dialog
      open
      aria-labelledby="reveal-title"
      className="space-y-4 rounded-md bg-[var(--color-mantle)] p-6"
    >
      <h2 id="reveal-title" className="text-2xl">
        {copy.invitations.reveal.title}
      </h2>
      <p className="text-[var(--color-yellow)]">{copy.invitations.reveal.warning}</p>
      <canvas ref={canvasRef} className="mx-auto block" />
      <label className="block text-sm">
        {copy.invitations.reveal.urlLabel}
        <input
          readOnly
          aria-label={copy.invitations.reveal.urlLabel}
          value={invitation.url}
          className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-base)] px-2 py-1 font-mono text-xs"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(invitation.url)}
          className="rounded-md bg-[var(--color-base)] px-3 py-1"
        >
          {copy.invitations.reveal.copyUrl}
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
