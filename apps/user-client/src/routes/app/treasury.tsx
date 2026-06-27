// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TagEditor } from '../../components/artefact/TagEditor.js';
import { HistorySearchBar } from '../../components/history/HistorySearchBar.js';
import { Lightbox } from '../../components/lightbox/Lightbox.js';
import { artefactToViewable } from '../../components/lightbox/viewable-item.js';
import { TreasuryFilterSheet } from '../../components/treasury/TreasuryFilterSheet.js';
import { TreasuryRow } from '../../components/treasury/TreasuryRow.js';
import { TypeTabs } from '../../components/treasury/TypeTabs.js';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { useHelp } from '../../content/help/use-help.js';
import {
  useAddTagsToArtefacts,
  useAllArtefacts,
  useDeleteArtefacts,
  useRenameArtefactGlobal,
  useSetArtefactFavouriteGlobal,
  useSetArtefactTags,
  useUpdateArtefactContentGlobal,
} from '../../data/artefacts.js';
import { useFilteredPersonas } from '../../data/personas.js';
import { treasuryCountLabel } from '../../lib/treasury-count.js';
import { type TreasuryType, applyTreasuryFilters, collectTags } from '../../lib/treasury-filter.js';

export function Treasury(): JSX.Element {
  const [search, setSearch] = useSearchParams();
  const { data: rows = [] } = useAllArtefacts();
  const personas = useFilteredPersonas();
  const { onHelp, helpOverlay } = useHelp('treasury');

  const [type, setType] = useState<TreasuryType>((search.get('type') as TreasuryType) ?? 'all');
  const [personaId, setPersonaId] = useState<string | null>(search.get('personaId'));
  const [tags, setTags] = useState<string[]>([]);
  const [favourite, setFavourite] = useState(false);
  const [query, setQuery] = useState(search.get('query') ?? '');
  const [filterOpen, setFilterOpen] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagging, setTagging] = useState(false);
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const setFav = useSetArtefactFavouriteGlobal();
  const setArtefactTags = useSetArtefactTags();
  const addTags = useAddTagsToArtefacts();
  const removeMany = useDeleteArtefacts();
  const renameGlobal = useRenameArtefactGlobal();
  const editGlobal = useUpdateArtefactContentGlobal();

  const personaById = useMemo(() => {
    const m = new Map<string, { name: string; colour: string }>();
    for (const p of personas.data ?? []) m.set(p.id, { name: p.name, colour: p.colour });
    return m;
  }, [personas.data]);
  const visiblePersonaIds = useMemo(
    () => new Set((personas.data ?? []).map((p) => p.id)),
    [personas.data],
  );

  const visibleRows = useMemo(
    () => rows.filter((r) => visiblePersonaIds.has(r.personaId)),
    [rows, visiblePersonaIds],
  );
  const allTags = useMemo(() => collectTags(visibleRows), [visibleRows]);
  const filtered = useMemo(
    () => applyTreasuryFilters(visibleRows, { type, personaId, tags, favourite, query }),
    [visibleRows, type, personaId, tags, favourite, query],
  );

  const items = useMemo(() => filtered.map(artefactToViewable), [filtered]);
  const openIndex = openId ? filtered.findIndex((r) => r.id === openId) : -1;

  function mirrorUrl(next: {
    type?: TreasuryType;
    personaId?: string | null;
    query?: string;
  }): void {
    setSearch(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next.type !== undefined) {
          if (next.type === 'all') params.delete('type');
          else params.set('type', next.type);
        }
        if (next.personaId !== undefined) {
          if (next.personaId) params.set('personaId', next.personaId);
          else params.delete('personaId');
        }
        if (next.query !== undefined) {
          if (next.query.trim() !== '') params.set('query', next.query.trim());
          else params.delete('query');
        }
        return params;
      },
      { replace: true },
    );
  }

  // Auto-reset the persona filter to All when the selected persona stops being
  // visible (e.g. NSFW → SFW flip while an adult persona was selected).
  // `mirrorUrl` is intentionally omitted from deps — it closes over no changing
  // state relevant here and is stable enough for this guard; mirroring History.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    if (!personaId || !personas.data) return;
    if (!personas.data.some((p) => p.id === personaId)) {
      setPersonaId(null);
      mirrorUrl({ personaId: null });
    }
  }, [personaId, personas.data]);

  function toggleSelect(id: string): void {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function exitSelect(): void {
    setSelectMode(false);
    setSelected(new Set());
    setTagging(false);
    setBulkTags([]);
    setConfirmDelete(false);
  }

  const activeFilterCount = (personaId ? 1 : 0) + (favourite ? 1 : 0) + tags.length;

  return (
    <PageScaffold crumbs={[{ label: 'My Treasury' }]} back="/app" onHelp={onHelp}>
      {helpOverlay}
      <div className="flex min-h-[80dvh] flex-col gap-3 px-4 pb-24 pt-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-widest text-paper-soft">
            {treasuryCountLabel(visibleRows.length, filtered.length)}
          </span>
          <button
            type="button"
            className="rounded-md border border-aurora-700 bg-white/[0.02] px-3 py-1 text-xs text-aurora-200"
            aria-pressed={selectMode}
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          >
            {selectMode ? 'Cancel' : 'Select'}
          </button>
        </div>

        <TypeTabs
          value={type}
          onChange={(t) => {
            setType(t);
            mirrorUrl({ type: t });
          }}
        />

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <HistorySearchBar
              value={query}
              onChange={(v) => {
                setQuery(v);
                mirrorUrl({ query: v });
              }}
              placeholder="Search by name…"
            />
          </div>
          <button
            type="button"
            className="relative shrink-0 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-paper-soft"
            aria-label={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'}
            onClick={() => setFilterOpen(true)}
          >
            ⚙
            {activeFilterCount > 0 ? (
              <span className="ml-1 rounded-full bg-aurora-700 px-1.5 text-[10px] text-paper">
                {activeFilterCount}
              </span>
            ) : null}
          </button>
        </div>

        {activeFilterCount > 0 ? (
          <div className="flex flex-wrap gap-2">
            {personaId ? (
              <button
                type="button"
                className="tag-chip"
                onClick={() => {
                  setPersonaId(null);
                  mirrorUrl({ personaId: null });
                }}
              >
                {personaById.get(personaId)?.name ?? 'Persona'} ✕
              </button>
            ) : null}
            {favourite ? (
              <button type="button" className="tag-chip" onClick={() => setFavourite(false)}>
                ★ Favourites ✕
              </button>
            ) : null}
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                className="tag-chip"
                onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
              >
                #{t} ✕
              </button>
            ))}
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <div className="mt-8 grid place-items-center text-center text-paper-soft">
            <p className="font-display text-lg italic text-paper">
              {visibleRows.length === 0 ? 'No artefacts yet.' : 'No artefacts match your filters.'}
            </p>
            {visibleRows.length === 0 ? (
              <p className="mt-2 max-w-xs text-sm">Artefacts a persona builds will collect here.</p>
            ) : (
              <button
                type="button"
                className="mt-2 rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper"
                onClick={() => {
                  setType('all');
                  setPersonaId(null);
                  setTags([]);
                  setFavourite(false);
                  setQuery('');
                  mirrorUrl({ type: 'all', personaId: null, query: '' });
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((r) => {
              const persona = personaById.get(r.personaId);
              return (
                <TreasuryRow
                  key={r.id}
                  row={r}
                  personaName={persona?.name ?? '—'}
                  personaColour={persona?.colour ?? '#8d6dff'}
                  selectMode={selectMode}
                  selected={selected.has(r.id)}
                  onOpen={setOpenId}
                  onToggleSelect={toggleSelect}
                  onToggleFavourite={(id) => setFav.mutate({ id, favourite: !r.favourite })}
                />
              );
            })}
          </div>
        )}

        {filterOpen ? (
          <TreasuryFilterSheet
            personas={personas.data ?? []}
            personaId={personaId}
            onPersonaChange={(id) => {
              setPersonaId(id);
              mirrorUrl({ personaId: id });
            }}
            allTags={allTags}
            selectedTags={tags}
            onTagsChange={setTags}
            favourite={favourite}
            onFavouriteChange={setFavourite}
            onClose={() => setFilterOpen(false)}
          />
        ) : null}

        {selectMode ? (
          <div className="treasury-actionbar">
            <span className="treasury-actionbar-count">{selected.size} selected</span>
            {confirmDelete ? (
              <>
                <span className="treasury-actionbar-confirm">
                  Delete {selected.size}? Cannot be undone.
                </span>
                <button
                  type="button"
                  className="treasury-actionbar-btn danger"
                  onClick={() => {
                    removeMany.mutate([...selected]);
                    exitSelect();
                  }}
                >
                  Delete {selected.size}
                </button>
                <button
                  type="button"
                  className="treasury-actionbar-btn"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="treasury-actionbar-btn"
                  disabled={selected.size === 0}
                  onClick={() => setTagging(true)}
                >
                  🏷 Tag
                </button>
                <button
                  type="button"
                  className="treasury-actionbar-btn danger"
                  disabled={selected.size === 0}
                  onClick={() => setConfirmDelete(true)}
                >
                  🗑 Delete
                </button>
              </>
            )}
          </div>
        ) : null}

        {tagging ? (
          <div className="treasury-sheet-root">
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; buttons are the keyboard path */}
            <div
              className="treasury-backdrop"
              onClick={() => {
                setTagging(false);
                setBulkTags([]);
              }}
            />
            <aside className="treasury-sheet" aria-label="Tag selected">
              <header className="treasury-sheet-header">
                <span className="treasury-sheet-title">Tag {selected.size} artefacts</span>
                <button
                  type="button"
                  className="treasury-sheet-close"
                  aria-label="Close"
                  onClick={() => {
                    setTagging(false);
                    setBulkTags([]);
                  }}
                >
                  <span aria-hidden>×</span>
                </button>
              </header>
              <TagEditor
                mode="edit"
                value={bulkTags}
                suggestions={allTags}
                onChange={setBulkTags}
              />
              <button
                type="button"
                className="treasury-actionbar-btn"
                disabled={bulkTags.length === 0}
                onClick={() => {
                  addTags.mutate({ ids: [...selected], tags: bulkTags });
                  exitSelect();
                }}
              >
                Apply tags
              </button>
            </aside>
          </div>
        ) : null}

        {openId !== null && openIndex >= 0 ? (
          <Lightbox
            items={items}
            index={openIndex}
            getOriginRect={(id) =>
              document
                .querySelector<HTMLElement>(`[data-treasury-row="${CSS.escape(id)}"]`)
                ?.getBoundingClientRect() ?? null
            }
            tagSuggestions={allTags}
            onSetTags={(id, t) => setArtefactTags.mutate({ id, tags: t })}
            onRename={(id, patch) => renameGlobal.mutate({ id, patch })}
            onRemove={() => {}}
            onEditText={(id, text) => editGlobal.mutate({ id, content: text })}
            onDelete={(id) => {
              removeMany.mutate([id]);
              setOpenId(null);
            }}
            onClose={() => setOpenId(null)}
          />
        ) : null}
      </div>
    </PageScaffold>
  );
}
