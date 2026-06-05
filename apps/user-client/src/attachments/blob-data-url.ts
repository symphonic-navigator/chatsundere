// SPDX-License-Identifier: AGPL-3.0-only

/** Read a Blob into a base64 `data:` URL via FileReader (browser-only; covered by manual verification). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
