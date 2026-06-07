// SPDX-License-Identifier: AGPL-3.0-only
import type { LibraryRow } from '../boot/client-data-db.js';

/**
 * The libraries actually searchable for a send: the union of the persona's and
 * the chat's assigned ids, intersected with libraries that currently exist, then
 * NSFW-filtered. Order follows `allLibraries`. An empty result means the
 * knowledge tool must not be offered.
 */
export function computeEffectiveLibraries(
  personaLibraryIds: readonly string[],
  chatLibraryIds: readonly string[],
  allLibraries: readonly LibraryRow[],
  nsfwAllowed: boolean,
): LibraryRow[] {
  const wanted = new Set([...personaLibraryIds, ...chatLibraryIds]);
  return allLibraries.filter((l) => wanted.has(l.id) && (nsfwAllowed || !l.nsfw));
}
