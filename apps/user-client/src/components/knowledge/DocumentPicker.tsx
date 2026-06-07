// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { LibraryRow } from '../../boot/client-data-db.js';
import { getClientDataDb } from '../../boot/client-data-db.js';
import { useAddDocumentReferences } from '../../data/attachments.js';
import { listDocuments, useFilteredLibraries } from '../../data/knowledge.js';
import { QK } from '../../data/queryKeys.js';
import { HistorySearchBar } from '../history/HistorySearchBar.js';

interface Props {
  chatId: string;
  onClose: () => void;
}

/**
 * Accordion-tree picker: attach knowledge-library documents (their full content) to
 * the chat's next message. Libraries expand in place to reveal their documents (no
 * drill-down — Chris's call); selection is multi-select across libraries, mirroring the
 * Treasury ArtefactPicker. Source is all libraries, NSFW-gated via useFilteredLibraries.
 * Documents are attached as copy-on-write references regardless of embedding status.
 */
export function DocumentPicker(p: Props): JSX.Element {
  const { data: libraries = [] } = useFilteredLibraries();
  const addRefs = useAddDocumentReferences(p.chatId);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string): void {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function attach(): Promise<void> {
    if (selected.size === 0) return;
    const db = getClientDataDb();
    const docs = (await Promise.all([...selected].map((id) => db.documents.get(id)))).filter(
      (d): d is NonNullable<typeof d> => d != null,
    );
    if (docs.length === 0) return; // all selected documents vanished — keep the sheet open
    await addRefs.mutateAsync(docs);
    p.onClose();
  }

  return (
    <div className="document-picker-root">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a dismiss surface; the × is the keyboard path */}
      <div
        className="document-picker-backdrop"
        data-testid="document-picker-backdrop"
        onClick={p.onClose}
      />
      <aside className="document-picker" aria-label="Attach from knowledge">
        <header className="document-picker-header">
          <span className="document-picker-title">Attach from knowledge</span>
          <button
            type="button"
            className="document-picker-close"
            aria-label="Close"
            onClick={p.onClose}
          >
            <span aria-hidden>×</span>
          </button>
        </header>
        <HistorySearchBar value={query} onChange={setQuery} placeholder="Search documents…" />
        {libraries.length > 0 ? (
          <ul className="document-picker-list">
            {libraries.map((lib) => (
              <LibraryAccordion
                key={lib.id}
                library={lib}
                query={query}
                selected={selected}
                onToggle={toggle}
              />
            ))}
          </ul>
        ) : (
          <p className="document-picker-empty">No libraries yet.</p>
        )}
        <div className="document-picker-actions">
          <button
            type="button"
            className="document-picker-attach"
            disabled={selected.size === 0 || addRefs.isPending}
            onClick={() => void attach()}
          >
            Attach ({selected.size})
          </button>
        </div>
      </aside>
    </div>
  );
}

function LibraryAccordion(props: {
  library: LibraryRow;
  query: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
}): JSX.Element {
  const { library, query, selected, onToggle } = props;
  const [open, setOpen] = useState(false);
  // A search query force-opens every group so its documents load and filter.
  const expanded = open || query.trim().length > 0;
  const { data: docs = [] } = useQuery({
    queryKey: QK.documents(library.id),
    queryFn: () => listDocuments(library.id),
    enabled: expanded,
  });
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? docs.filter((d) => d.title.toLowerCase().includes(q)) : docs),
    [docs, q],
  );

  return (
    <li className="document-picker-group" data-open={expanded || undefined}>
      <button
        type="button"
        className="document-picker-group-head"
        aria-expanded={expanded}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="document-picker-caret" aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
        <span className="document-picker-group-name">{library.name}</span>
      </button>
      {expanded ? (
        filtered.length > 0 ? (
          <ul className="document-picker-docs">
            {filtered.map((d) => {
              const on = selected.has(d.id);
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    className="document-picker-doc"
                    aria-pressed={on}
                    data-selected={on || undefined}
                    onClick={() => onToggle(d.id)}
                  >
                    <span className="document-picker-check" data-on={on || undefined} aria-hidden>
                      {on ? '☑' : '☐'}
                    </span>
                    <span className="document-picker-doc-name">{d.title}.md</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="document-picker-group-empty">{q ? 'No matches.' : 'No documents yet.'}</p>
        )
      ) : null}
    </li>
  );
}
