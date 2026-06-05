// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useState } from 'react';
import type { AvatarCrop } from '../boot/client-data-db.js';
import { cropToBackground } from '../lib/avatar-crop.js';

const BOX = 280;

/**
 * Rounded-square crop window. Drag to pan, slider to zoom. Operates purely on
 * CSS background (the same maths the display uses), so the preview is exact.
 */
export function AvatarCropModal({
  imageUrl,
  naturalWidth,
  naturalHeight,
  initialCrop,
  onConfirm,
  onCancel,
}: {
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  initialCrop: AvatarCrop;
  onConfirm: (crop: AvatarCrop) => void;
  onCancel: () => void;
}): JSX.Element {
  const [crop, setCrop] = useState<AvatarCrop>(initialCrop);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  );

  const bg = cropToBackground(naturalWidth, naturalHeight, crop, BOX);

  function onPointerDown(e: React.PointerEvent): void {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: crop.x, baseY: crop.y };
  }
  function onPointerMove(e: React.PointerEvent): void {
    const d = dragRef.current;
    if (!d) return;
    setCrop((c) => ({
      ...c,
      x: d.baseX + (e.clientX - d.startX) / BOX,
      y: d.baseY + (e.clientY - d.startY) / BOX,
    }));
  }
  function onPointerUp(): void {
    dragRef.current = null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      data-avatar-crop-modal
    >
      <div className="w-full max-w-sm rounded-t-2xl bg-ink p-4 sm:rounded-2xl">
        <h2 className="mb-3 text-center font-display text-sm text-paper">Position your avatar</h2>
        <div className="mx-auto select-none touch-none">
          <div
            className="mx-auto overflow-hidden rounded-2xl border border-white/15 bg-black/40"
            style={{
              width: BOX,
              height: BOX,
              backgroundImage: `url(${imageUrl})`,
              backgroundSize: bg.backgroundSize,
              backgroundPosition: bg.backgroundPosition,
              backgroundRepeat: 'no-repeat',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        </div>
        <label
          className="mt-4 block text-xs uppercase tracking-widest text-paper-soft"
          htmlFor="avatar-zoom"
        >
          Zoom
        </label>
        <input
          id="avatar-zoom"
          aria-label="Zoom"
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={crop.zoom}
          onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))}
          className="w-full"
        />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-md border border-paper-soft/30 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(crop)}
            className="flex-1 rounded-md border border-paper bg-paper/20 px-3 py-2 text-xs uppercase tracking-wider text-paper"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
