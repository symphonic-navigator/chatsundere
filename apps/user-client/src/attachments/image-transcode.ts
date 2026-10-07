// SPDX-License-Identifier: AGPL-3.0-only

/** JPEG quality for transcoded generated images — high, since this is art. */
const JPEG_QUALITY = 0.92;

/** Turns an image blob into a JPEG blob; injectable for tests. */
export type JpegEncoder = (blob: Blob) => Promise<Blob>;

/** Only PNGs are transcoded; JPEG and WebP are already compact. */
export function shouldTranscode(mime: string): boolean {
  return mime.toLowerCase().startsWith('image/png');
}

/**
 * Decode and re-encode as JPEG at the ORIGINAL size (no downscaling — unlike
 * attachment normalisation, a generated image is the user's artwork). Alpha is
 * flattened onto white, as in image-normalise.ts. Not testable in jsdom (no
 * canvas); covered by manual verification.
 */
export const canvasJpegEncoder: JpegEncoder = async (blob) => {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  } finally {
    bitmap.close();
  }
};

/**
 * Some image models answer with 7–10 MB PNGs; as JPEG they shrink roughly
 * tenfold, which matters for storage and the encrypted sync quota. Any failure
 * (decode, memory, missing OffscreenCanvas) keeps the original — the image is
 * never lost, only larger.
 */
export async function transcodeGeneratedImage(
  item: { bytes: Blob; mime: string },
  encode: JpegEncoder = canvasJpegEncoder,
): Promise<{ bytes: Blob; mime: string }> {
  if (!shouldTranscode(item.mime)) return item;
  try {
    return { bytes: await encode(item.bytes), mime: 'image/jpeg' };
  } catch {
    return item;
  }
}
