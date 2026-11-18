// SPDX-License-Identifier: AGPL-3.0-only
import { triggerDownload } from './download.js';

/** How `deliverFile` handed the file over. */
export type DeliveryResult = 'shared' | 'downloaded' | 'cancelled';

/** The file in the first type the share sheet accepts, or null when sharing is not on offer. */
function shareableCopy(file: File): File | null {
  // A coarse pointer stands in for "a phone": desktop share sheets exist but
  // offer no "save to files" target, so a download serves the desktop better.
  if (!window.matchMedia?.('(pointer: coarse)').matches) return null;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return null;
  }
  // Some share targets refuse text/markdown but take the same bytes as text/plain.
  const candidates = [file, new File([file], file.name, { type: 'text/plain' })];
  for (const candidate of candidates) {
    try {
      if (navigator.canShare({ files: [candidate] })) return candidate;
    } catch {
      // A throwing canShare means "not this one"; try the next type.
    }
  }
  return null;
}

function download(file: File): 'downloaded' {
  triggerDownload(file, file.name);
  return 'downloaded';
}

const isAbort = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';

/**
 * Hands a file to the user: the share sheet on phones, a download elsewhere.
 * Everything up to the `navigator.share` call runs synchronously, because iOS
 * refuses a share that no longer sits inside the user's tap. A cancelled share
 * resolves `'cancelled'`; any other share failure falls back to the download.
 * Rejects only when the download itself fails.
 */
export function deliverFile(file: File, title: string): Promise<DeliveryResult> {
  const shareable = shareableCopy(file);
  if (shareable === null) {
    try {
      return Promise.resolve(download(file));
    } catch (e) {
      return Promise.reject(e);
    }
  }
  let sharing: Promise<void>;
  try {
    sharing = navigator.share({ files: [shareable], title });
  } catch {
    return Promise.resolve().then(() => download(file));
  }
  return sharing.then(
    (): DeliveryResult => 'shared',
    (e: unknown): DeliveryResult => (isAbort(e) ? 'cancelled' : download(file)),
  );
}
