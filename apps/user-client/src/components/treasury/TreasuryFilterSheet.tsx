// SPDX-License-Identifier: AGPL-3.0-only
import type { PersonaRow } from '../../boot/client-data-db.js';
import { TagEditor } from '../artefact/TagEditor.js';
import { PersonaFilterDropdown } from '../history/PersonaFilterDropdown.js';

interface Props {
  personas: PersonaRow[];
  personaId: string | null;
  onPersonaChange: (next: string | null) => void;
  allTags: string[];
  selectedTags: string[];
  onTagsChange: (next: string[]) => void;
  favourite: boolean;
  onFavouriteChange: (next: boolean) => void;
  onClose: () => void;
}

/** The Treasury ⚙ filter sheet — persona, tags, favourites, and a reserved project row. */
export function TreasuryFilterSheet(p: Props): JSX.Element {
  return (
    <div className="treasury-sheet-root">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a dismiss surface; the × is the keyboard path */}
      <div
        className="treasury-backdrop"
        data-testid="treasury-filter-backdrop"
        onClick={p.onClose}
      />
      <aside className="treasury-sheet" aria-label="Filters">
        <header className="treasury-sheet-header">
          <span className="treasury-sheet-title">Filters</span>
          <button
            type="button"
            className="treasury-sheet-close"
            aria-label="Close"
            onClick={p.onClose}
          >
            <span aria-hidden>×</span>
          </button>
        </header>

        <section className="treasury-filter-group">
          <h3 className="treasury-filter-label">Persona</h3>
          <PersonaFilterDropdown
            personas={p.personas}
            selectedId={p.personaId}
            onChange={p.onPersonaChange}
          />
        </section>

        <section className="treasury-filter-group">
          <h3 className="treasury-filter-label">Tags</h3>
          <TagEditor
            mode="pick"
            value={p.selectedTags}
            suggestions={p.allTags}
            onChange={p.onTagsChange}
          />
        </section>

        <section className="treasury-filter-group">
          <button
            type="button"
            className="treasury-fav-toggle"
            data-on={p.favourite || undefined}
            aria-pressed={p.favourite}
            onClick={() => p.onFavouriteChange(!p.favourite)}
          >
            <span aria-hidden>{p.favourite ? '★' : '☆'}</span> Favourites only
          </button>
        </section>

        <section
          className="treasury-filter-group treasury-filter-disabled"
          aria-disabled="true"
          title="Coming soon"
        >
          <h3 className="treasury-filter-label">Projects</h3>
          <span className="treasury-filter-note">Coming soon</span>
        </section>
      </aside>
    </div>
  );
}
