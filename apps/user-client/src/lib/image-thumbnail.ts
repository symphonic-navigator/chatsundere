// SPDX-License-Identifier: AGPL-3.0-only

/** Longest-edge target for chat-stream/Treasury thumbnails (380 px bubble budget × ~2 dpr). */
export const THUMB_MAX_EDGE = 640;
const THUMB_JPEG_QUALITY = 0.8;

export interface ImageThumbnail {
  thumbBlob: Blob;
  width: number;
  height: number;
}

/**
 * Measure a generated image and produce its thumbnail. Returns the ORIGINAL
 * dimensions (width/height) plus a downscaled JPEG whose longest edge is
 * THUMB_MAX_EDGE (never upscaled). Mirrors `image-normalise.ts` canvas rules.
 * NOT unit-testable in jsdom (no real canvas) — covered by manual verification.
 */
export async function thumbnailFromBlob(bytes: Blob): Promise<ImageThumbnail> {
  const bitmap = await createImageBitmap(bytes);
  const { width, height } = bitmap;
  const longest = Math.max(width, height);
  const scale = longest > THUMB_MAX_EDGE ? THUMB_MAX_EDGE / longest : 1;
  const tw = Math.round(width * scale);
  const th = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tw, th);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, tw, th);
  bitmap.close();
  const thumbBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', THUMB_JPEG_QUALITY),
  );
  if (!thumbBlob) throw new Error('thumbnail encoding failed (toBlob returned null)');
  return { thumbBlob, width, height };
}
