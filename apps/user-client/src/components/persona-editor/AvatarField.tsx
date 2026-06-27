// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import type { AvatarCrop } from '../../boot/client-data-db.js';
import { cropToBackground } from '../../lib/avatar-crop.js';
import { PersonaAvatar } from '../PersonaAvatar.js';

/** Pending avatar state. An object = crop confirmed but not yet persisted; 'remove' = user
 *  wants the existing avatar deleted on next save; null = no pending change. */
export type PendingAvatar =
  | { blob: Blob; mime: string; width: number; height: number; crop: AvatarCrop }
  | 'remove'
  | null;

/**
 * Presentational avatar picker strip. Shows a preview (pending blob), the
 * saved avatar via PersonaAvatar, or a two-letter monogram when in create
 * mode or after an explicit remove. Exported for the avatar test.
 */
export function AvatarField({
  personaId,
  name,
  colour,
  pending,
  onPick,
  onRemove,
}: {
  personaId: string | null;
  name: string;
  colour: string;
  pending: PendingAvatar;
  onPick: (file: File) => void;
  onRemove: () => void;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  // Hold the preview object URL in state so it is created once per blob and
  // revoked on cleanup — computing it inline would leak a URL on every render
  // (PersonaEditor re-renders on each keystroke).
  const pendingData = pending && pending !== 'remove' ? pending : null;
  const pendingBlob = pendingData?.blob ?? null;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingBlob) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingBlob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingBlob]);
  // Reproduce the confirmed crop in the preview exactly as PersonaAvatar does
  // for the saved image (CSS background-size/position). Without this the
  // preview fell back to bg-cover and briefly showed the whole, uncropped image
  // until a reload re-rendered it through PersonaAvatar.
  const previewBg =
    pendingData && previewUrl
      ? cropToBackground(pendingData.width, pendingData.height, pendingData.crop, 48)
      : null;
  return (
    <div className="mb-3 flex items-center gap-3">
      {previewUrl && previewBg ? (
        <div
          className="h-12 w-12 shrink-0 overflow-hidden rounded-md"
          style={{
            backgroundImage: `url(${previewUrl})`,
            backgroundSize: previewBg.backgroundSize,
            backgroundPosition: previewBg.backgroundPosition,
            backgroundRepeat: 'no-repeat',
          }}
          data-avatar-preview
        />
      ) : pending === 'remove' || !personaId ? (
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-md font-display"
          style={{ background: `${colour}1f`, color: colour, border: `1px solid ${colour}33` }}
        >
          {name.trim().slice(0, 2).toUpperCase() || '??'}
        </div>
      ) : (
        <PersonaAvatar personaId={personaId} name={name} colour={colour} size={48} />
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        aria-label="Change avatar"
        onClick={() => inputRef.current?.click()}
        className="rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
      >
        Change avatar
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="text-[11px] uppercase tracking-wider text-paper-soft hover:text-paper"
      >
        Remove
      </button>
    </div>
  );
}
