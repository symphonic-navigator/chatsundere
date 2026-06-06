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

/** Two-line Treasury row: glyph · title · star / persona · format · size · age. */
export function TreasuryRow(p: Props): JSX.Element {
  const g = formatGlyph(p.row.format);
  return (
    <li
      className="treasury-row"
      data-treasury-row={p.row.id}
      data-selected={p.selected || undefined}
    >
      {p.selectMode ? (
        <span className="treasury-check" data-on={p.selected || undefined} aria-hidden>
          {p.selected ? '✓' : ''}
        </span>
      ) : (
        <span className={`treasury-glyph ${g.cls}`} aria-hidden>
          {g.glyph}
        </span>
      )}
      <button
        type="button"
        className="treasury-row-body"
        onClick={() => (p.selectMode ? p.onToggleSelect(p.row.id) : p.onOpen(p.row.id))}
      >
        <span className="treasury-row-title">{p.row.title}</span>
        <span className="treasury-row-meta">
          <span style={{ color: p.personaColour, opacity: 0.8 }}>{p.personaName}</span>
          {' · '}
          {p.row.format.toUpperCase()}
          {' · '}
          {formatBytes(artefactSize(p.row))}
          {' · '}
          {relativeTimeLabel(p.row.createdAt)}
        </span>
      </button>
      {!p.selectMode ? (
        <button
          type="button"
          className="treasury-row-star"
          data-active={p.row.favourite || undefined}
          aria-label={p.row.favourite ? 'Remove favourite' : 'Add favourite'}
          onClick={() => p.onToggleFavourite(p.row.id)}
        >
          <span aria-hidden>{p.row.favourite ? '★' : '☆'}</span>
        </button>
      ) : null}
    </li>
  );
}
