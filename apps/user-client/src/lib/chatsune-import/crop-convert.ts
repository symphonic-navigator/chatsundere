// SPDX-License-Identifier: AGPL-3.0-only

import type { AvatarCrop } from '../../boot/client-data-db.js';
import type { ChatsuneProfileCrop } from './types.js';

/** Diameter of chatsune's circular crop region on its 280px editor canvas. */
export const CHATSUNE_CROP_DIAMETER = 220;

/**
 * Convert a chatsune `profile_crop` into Chatsundere's `AvatarCrop`.
 *
 * chatsune: x/y are pixel offsets from the canvas centre; zoom multiplies the
 * natural size (1 = unscaled), the crop region being a 220px circle.
 * Chatsundere: x/y are fractions of the display box; zoom multiplies the
 * cover-scale (1 = covers the box). The default chatsune framing
 * (zoom = 220 / shortSide) maps exactly to zoom 1; a below-cover zoom cannot be
 * represented and clamps to 1.
 */
export function convertChatsuneCrop(c: ChatsuneProfileCrop): AvatarCrop {
  const shortSide = Math.max(1, Math.min(c.width, c.height));
  const rawZoom = (c.zoom * shortSide) / CHATSUNE_CROP_DIAMETER;
  const zoom = Math.min(3, Math.max(1, rawZoom));
  return {
    x: c.x / CHATSUNE_CROP_DIAMETER,
    y: c.y / CHATSUNE_CROP_DIAMETER,
    zoom,
  };
}
