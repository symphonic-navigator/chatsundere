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
 * Where the whole image lands inside a square box of `size` px under a crop, in
 * box pixels. Model: cover the box, multiply by `zoom`, then pan by a fraction
 * of `size`. The one source for both the CSS background and canvas renders.
 */
export function cropToRect(
  naturalWidth: number,
  naturalHeight: number,
  crop: AvatarCrop,
  size: number,
): { x: number; y: number; width: number; height: number } {
  const coverScale = Math.max(size / naturalWidth, size / naturalHeight);
  const scale = coverScale * crop.zoom;
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    x: (size - width) / 2 + crop.x * size,
    y: (size - height) / 2 + crop.y * size,
    width,
    height,
  };
}

/** CSS background props that reproduce a crop inside a square box of `size` px. */
export function cropToBackground(
  naturalWidth: number,
  naturalHeight: number,
  crop: AvatarCrop,
  size: number,
): { backgroundSize: string; backgroundPosition: string } {
  const rect = cropToRect(naturalWidth, naturalHeight, crop, size);
  return {
    backgroundSize: `${rect.width}px ${rect.height}px`,
    backgroundPosition: `${rect.x}px ${rect.y}px`,
  };
}
