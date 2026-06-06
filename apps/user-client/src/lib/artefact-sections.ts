// SPDX-License-Identifier: AGPL-3.0-only
import type { ArtefactRow } from '../boot/client-data-db.js';

export interface ArtefactSections {
  favourites: ArtefactRow[];
  inChat: ArtefactRow[];
}

/** Favourites = starred (newest first); inChat = all (newest first). A starred
 *  artefact appears in both (lossless, like the ToC pinned+timeline). */
export function buildArtefactSections(rows: ArtefactRow[]): ArtefactSections {
  const ordered = [...rows].sort((a, b) => b.createdAt - a.createdAt);
  return { favourites: ordered.filter((r) => r.favourite), inChat: ordered };
}

/** Format → glyph + colour class for the compact row. */
export function formatGlyph(format: ArtefactRow['format']): { glyph: string; cls: string } {
  if (format === 'markdown') return { glyph: 'M↓', cls: 'g-md' };
  if (format === 'code') return { glyph: '{ }', cls: 'g-code' };
  return { glyph: '</>', cls: 'g-html' };
}
