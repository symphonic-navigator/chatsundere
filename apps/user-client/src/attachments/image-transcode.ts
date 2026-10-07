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

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** `Blob.arrayBuffer` with a FileReader fallback for environments lacking it (jsdom). */
function readBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Whether the blob starts with the PNG signature. Declared content types are
 * unreliable (object stores often serve PNGs as `binary/octet-stream`), so the
 * bytes decide.
 */
async function hasPngSignature(blob: Blob): Promise<boolean> {
  try {
    const head = new Uint8Array(await readBuffer(blob.slice(0, PNG_SIGNATURE.length)));
    return head.length === PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => head[i] === b);
  } catch {
    return false;
  }
}

/**
 * Some image models answer with 7–10 MB PNGs; as JPEG they shrink roughly
 * tenfold, which matters for storage and the encrypted sync quota. PNGs are
 * recognised by their bytes, not the declared type. Any failure (decode,
 * memory, missing OffscreenCanvas) keeps the original — the image is never
 * lost, only larger — labelled with its true type.
 */
export async function transcodeGeneratedImage(
  item: { bytes: Blob; mime: string },
  encode: JpegEncoder = canvasJpegEncoder,
): Promise<{ bytes: Blob; mime: string }> {
  const isPng = shouldTranscode(item.mime) || (await hasPngSignature(item.bytes));
  if (!isPng) return item;
  const original = shouldTranscode(item.mime) ? item : { bytes: item.bytes, mime: 'image/png' };
  try {
    const out = await encode(item.bytes);
    if (out.type !== 'image/jpeg') return original;
    return { bytes: out, mime: 'image/jpeg' };
  } catch {
    return original;
  }
}
