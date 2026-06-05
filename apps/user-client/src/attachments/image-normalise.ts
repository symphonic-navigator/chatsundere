// SPDX-License-Identifier: AGPL-3.0-only

/** Longest edge cap in pixels — images larger than this are downscaled, never upscaled. */
export const MAX_EDGE = 1024;

/** JPEG quality for the normalised output (matches chatsune's server-side rule). */
export const JPEG_QUALITY = 0.85;

export interface NormalisedImage {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Pure resize maths — clamps the longest edge to MAX_EDGE, preserves aspect ratio,
 * and never upscales. Returns the original dimensions when no resize is needed.
 */
export function targetSize(
  w: number,
  h: number,
): { width: number; height: number; resized: boolean } {
  const longest = Math.max(w, h);
  if (longest <= MAX_EDGE) return { width: w, height: h, resized: false };
  const scale = MAX_EDGE / longest;
  return { width: Math.round(w * scale), height: Math.round(h * scale), resized: true };
}

/**
 * Normalise an uploaded image in the browser: EXIF orientation applied via
 * `createImageBitmap` options, longest edge clamped to 1024 px, alpha channel flattened
 * onto white (JPEG carries no transparency), re-encoded as JPEG at q0.85, metadata stripped.
 * Animated GIFs are reduced to their first frame — canvas draws one frame inherently.
 *
 * Ported from chatsune's server-side `_image_normaliser.py` rules; runs client-side here —
 * nothing reaches the server except the normalised ciphertext blob.
 *
 * NOT unit-testable in jsdom (no real canvas). Covered by manual verification per the spec
 * §15 step 10.
 */
export async function normaliseImageForLlm(file: File): Promise<NormalisedImage> {
  // `imageOrientation: 'from-image'` applies EXIF rotation before we touch the pixels.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = targetSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  // Flatten any alpha onto white — JPEG encodes no transparency channel.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new Error('image normalisation failed (toBlob returned null)');
  return { blob, width, height };
}
