// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState } from 'react';
import { useAllArtefacts } from '../../data/artefacts.js';
import { useAddArtefactSnapshots } from '../../data/attachments.js';
import { useFilteredPersonas } from '../../data/personas.js';
import { formatGlyph } from '../../lib/artefact-sections.js';
import { type TreasuryType, applyTreasuryFilters } from '../../lib/treasury-filter.js';
import { HistorySearchBar } from '../history/HistorySearchBar.js';
import { TypeTabs } from '../treasury/TypeTabs.js';

interface Props {
  chatId: string;
  onClose: () => void;
}

/**
 * Slim Treasury picker: pick existing artefacts to attach (as snapshots) to the
 * current chat's next message. Search-first; type tabs narrow by kind. Selection
 * only — no in-picker preview (inspect in the Treasury). NSFW gating mirrors the
 * Treasury via useFilteredPersonas, so an adult persona's artefacts never appear
 * in SFW mode.
 * Selections persist across tab and search changes; the full selection is
 * always snapshotted, not just the currently visible subset.
 */
export function ArtefactPicker(p: Props): JSX.Element {
  const { data: rows = [] } = useAllArtefacts();
  const personas = useFilteredPersonas();
  const addSnapshots = useAddArtefactSnapshots(p.chatId);

  const [type, setType] = useState<TreasuryType>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visiblePersonaIds = useMemo(
    () => new Set((personas.data ?? []).map((pp) => pp.id)),
    [personas.data],
  );
  const visibleRows = useMemo(
    () => rows.filter((r) => visiblePersonaIds.has(r.personaId)),
    [rows, visiblePersonaIds],
  );
  const filtered = useMemo(
    () =>
      applyTreasuryFilters(visibleRows, {
        type,
        personaId: null,
        tags: [],
        favourite: false,
        query,
      }),
    [visibleRows, type, query],
  );

  function toggle(id: string): void {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function attach(): Promise<void> {
    const chosen = visibleRows.filter((r) => selected.has(r.id));
    if (chosen.length === 0) return;
    await addSnapshots.mutateAsync(chosen);
    p.onClose();
  }

  return (
    <div className="artefact-picker-root">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a dismiss surface; the × is the keyboard path */}
      <div
        className="artefact-picker-backdrop"
        data-testid="artefact-picker-backdrop"
        onClick={p.onClose}
      />
      <aside className="artefact-picker" aria-label="Attach from Treasury">
        <header className="artefact-picker-header">
          <span className="artefact-picker-title">Attach from Treasury</span>
          <button
            type="button"
            className="artefact-picker-close"
            aria-label="Close"
            onClick={p.onClose}
          >
            <span aria-hidden>×</span>
          </button>
        </header>
        <TypeTabs value={type} onChange={setType} />
        <HistorySearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search artefacts by name…"
        />
        {filtered.length > 0 ? (
          <ul className="artefact-picker-list">
            {filtered.map((r) => {
              const g = formatGlyph(r.format);
              const on = selected.has(r.id);
              return (
                <li key={r.id} className="artefact-picker-row" data-selected={on || undefined}>
                  <button
                    type="button"
                    className="artefact-picker-row-body"
                    aria-pressed={on}
                    onClick={() => toggle(r.id)}
                  >
                    <span className={`artefact-glyph ${g.cls}`} aria-hidden>
                      {g.glyph}
                    </span>
                    <span className="artefact-picker-row-title">{r.title}</span>
                    <span className="artefact-picker-row-chip">{r.format.toUpperCase()}</span>
                    <span className="artefact-picker-check" data-on={on || undefined} aria-hidden>
                      {on ? '✓' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="artefact-picker-empty">
            {visibleRows.length === 0 ? 'No artefacts yet.' : 'No matches.'}
          </p>
        )}
        <div className="artefact-picker-actions">
          <button
            type="button"
            className="artefact-picker-attach"
            disabled={selected.size === 0 || addSnapshots.isPending}
            onClick={() => void attach()}
          >
            Attach ({selected.size})
          </button>
        </div>
      </aside>
    </div>
  );
}
