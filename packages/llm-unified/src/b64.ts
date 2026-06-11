// SPDX-License-Identifier: LGPL-3.0-only

/** Decode a base-64 string into a Blob with the given MIME type. */
export function b64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
