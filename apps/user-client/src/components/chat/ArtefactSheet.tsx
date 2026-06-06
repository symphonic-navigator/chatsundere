// SPDX-License-Identifier: AGPL-3.0-only
import type { ArtefactRow } from '../../boot/client-data-db.js';
import { useChatArtefacts, useSetArtefactFavourite } from '../../data/artefacts.js';
import { buildArtefactSections, formatGlyph } from '../../lib/artefact-sections.js';

interface Props {
  chatId: string;
  onClose: () => void;
  /** Open an artefact in the lightbox — caller closes the sheet. */
  onOpen: (artefactId: string) => void;
}

/**
 * Per-chat artefact sidebar. Deliberately lean: tap a row to open it in the
 * lightbox, star it to favourite. Renaming lives in the lightbox, not here —
 * artefacts are heavyweight (unlike a ToC entry/bookmark), so the sheet stays
 * an uncluttered "find and open" surface.
 */
export function ArtefactSheet(p: Props): JSX.Element {
  const { data: rows = [] } = useChatArtefacts(p.chatId);
  const setFav = useSetArtefactFavourite(p.chatId);
  const sections = buildArtefactSections(rows);

  const renderRow = (r: ArtefactRow): JSX.Element => {
    const g = formatGlyph(r.format);
    return (
      <li key={r.id} className="artefact-row">
        <span className={`artefact-glyph ${g.cls}`} aria-hidden>
          {g.glyph}
        </span>
        <button
          type="button"
          className="artefact-row-label"
          onClick={() => {
            p.onOpen(r.id);
            p.onClose();
          }}
        >
          {r.title}
        </button>
        <button
          type="button"
          className="artefact-row-star"
          data-active={r.favourite || undefined}
          aria-label={r.favourite ? 'Remove favourite' : 'Add favourite'}
          onClick={() => void setFav.mutateAsync({ id: r.id, favourite: !r.favourite })}
        >
          <span aria-hidden>{r.favourite ? '★' : '☆'}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="artefact-sheet-root">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a dismiss surface; the × is the keyboard path */}
      <div className="artefact-backdrop" data-testid="artefact-backdrop" onClick={p.onClose} />
      <aside className="artefact-sheet" aria-label="Artefacts">
        <header className="artefact-sheet-header">
          <span className="artefact-sheet-title">Artefacts</span>
          <span className="artefact-sheet-count">{rows.length}</span>
          <button
            type="button"
            className="artefact-sheet-close"
            aria-label="Close"
            onClick={p.onClose}
          >
            <span aria-hidden>×</span>
          </button>
        </header>
        {sections.favourites.length > 0 ? (
          <section className="artefact-section">
            <h3 className="artefact-section-title">★ Favourites</h3>
            <ul className="artefact-list">{sections.favourites.map(renderRow)}</ul>
          </section>
        ) : null}
        <section className="artefact-section">
          <h3 className="artefact-section-title">In this chat</h3>
          {sections.inChat.length > 0 ? (
            <ul className="artefact-list">{sections.inChat.map(renderRow)}</ul>
          ) : (
            <p className="artefact-empty">Artefacts you create appear here.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
