// SPDX-License-Identifier: AGPL-3.0-only

import { gunzip, untar } from '../chatsune-import/archive-reader.js';
import { type DetectedFormat, detectArchiveFormat } from './manifest.js';

/**
 * Gunzip and untar just the manifest entry from the archive, then return the
 * raw parsed JSON. Returns `null` on any error so callers can branch safely.
 */
export async function readManifestJson(file: Blob): Promise<unknown | null> {
  try {
    const raw = new Uint8Array(await file.arrayBuffer());
    const tarBytes = await gunzip(raw);
    const entries = untar(tarBytes);
    const entry = entries.find((e) => e.name === 'manifest.json');
    if (!entry) return null;
    return JSON.parse(new TextDecoder().decode(entry.bytes)) as unknown;
  } catch {
    return null;
  }
}

/**
 * Detect the format of a Chatsundere or Chatsune archive from its manifest.
 *
 * Gunzips and untars only the manifest entry, parses it, and delegates to
 * `detectArchiveFormat`. Swallows all errors — always returns a `DetectedFormat`,
 * never throws.
 */
export async function readManifestFormat(file: Blob): Promise<DetectedFormat> {
  const manifest = await readManifestJson(file);
  return detectArchiveFormat(manifest);
}
