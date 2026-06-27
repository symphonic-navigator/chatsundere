// SPDX-License-Identifier: AGPL-3.0-only
import type { ArtefactRow } from '../../boot/client-data-db.js';
import { formatGlyph } from '../../lib/artefact-sections.js';
import { relativeTimeLabel } from '../../lib/relative-time.js';
import { artefactSize, formatBytes } from '../../lib/treasury-filter.js';

interface Props {
  row: ArtefactRow;
  personaName: string;
  personaColour: string;
  selectMode: boolean;
  selected: boolean;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onToggleFavourite: (id: string) => void;
}

/**
 * Treasury row in the shared `cs-row` grammar: leading glyph (or a check in
 * select mode) · title + `persona · FORMAT · size · age` · inline favourite
 * star. `data-treasury-row` is load-bearing — the lightbox reads it for the
 * open/close zoom origin.
 */
export function TreasuryRow(p: Props): JSX.Element {
  const g = formatGlyph(p.row.format);
  return (
    <div className="cs-row" data-treasury-row={p.row.id} data-selected={p.selected || undefined}>
      <button
        type="button"
        className="cs-row-main"
        onClick={() => (p.selectMode ? p.onToggleSelect(p.row.id) : p.onOpen(p.row.id))}
      >
        <span className="cs-row-leading">
          {p.selectMode ? (
            <span className="treasury-check" data-on={p.selected || undefined} aria-hidden>
              {p.selected ? '✓' : ''}
            </span>
          ) : (
            <span className={`treasury-glyph ${g.cls}`} aria-hidden>
              {g.glyph}
            </span>
          )}
        </span>
        <span className="cs-row-body">
          <span className="cs-row-title">{p.row.title}</span>
          <span className="cs-row-subtitle">
            <span style={{ color: p.personaColour, opacity: 0.8 }}>{p.personaName}</span>
            {' · '}
            {p.row.format.toUpperCase()}
            {' · '}
            {formatBytes(artefactSize(p.row))}
            {' · '}
            {relativeTimeLabel(p.row.createdAt)}
          </span>
        </span>
      </button>
      {!p.selectMode ? (
        // biome-ignore lint/a11y/useKeyWithClickEvents: wrapper only stops bubbling; the star button carries the semantics
        <span className="cs-row-trailing" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="treasury-row-star"
            data-active={p.row.favourite || undefined}
            aria-label={p.row.favourite ? 'Remove favourite' : 'Add favourite'}
            onClick={() => p.onToggleFavourite(p.row.id)}
          >
            <span aria-hidden>{p.row.favourite ? '★' : '☆'}</span>
          </button>
        </span>
      ) : null}
    </div>
  );
}
