// SPDX-License-Identifier: AGPL-3.0-only

import { fitDimensions } from './avatar-crop.js';

export const AVATAR_MAX_EDGE = 512;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export interface NormalisedImage {
  blob: Blob;
  mime: 'image/webp';
  width: number;
  height: number;
}

/**
 * Decode a picked image file, downscale its longest edge to AVATAR_MAX_EDGE,
 * and re-encode as WebP. Rejects files over AVATAR_MAX_BYTES or that fail to
 * decode. Browser-only (uses Image + canvas).
 */
export async function normaliseAvatar(file: File): Promise<NormalisedImage> {
  if (file.size > AVATAR_MAX_BYTES) {
    throw new Error('That image is over 5 MB — please pick a smaller one.');
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight, AVATAR_MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process the image — canvas unavailable.');
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.9),
    );
    if (!blob) throw new Error('Could not encode the image.');
    return { blob, mime: 'image/webp', width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file couldn't be read as an image."));
    img.src = src;
  });
}
