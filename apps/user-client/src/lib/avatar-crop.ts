// SPDX-License-Identifier: AGPL-3.0-only

import type { AvatarCrop } from '../boot/client-data-db.js';

/** Downscale dimensions so the longest edge is at most `max`, preserving aspect. */
export function fitDimensions(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * CSS background props that reproduce a crop inside a square box of `size` px.
 * Model: cover the box, multiply by `zoom`, then pan by a fraction of `size`.
 */
export function cropToBackground(
  naturalWidth: number,
  naturalHeight: number,
  crop: AvatarCrop,
  size: number,
): { backgroundSize: string; backgroundPosition: string } {
  const coverScale = Math.max(size / naturalWidth, size / naturalHeight);
  const scale = coverScale * crop.zoom;
  const bgW = naturalWidth * scale;
  const bgH = naturalHeight * scale;
  const bgX = (size - bgW) / 2 + crop.x * size;
  const bgY = (size - bgH) / 2 + crop.y * size;
  return {
    backgroundSize: `${bgW}px ${bgH}px`,
    backgroundPosition: `${bgX}px ${bgY}px`,
  };
}
