// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatsuneLibraryImport } from '../../components/knowledge/ChatsuneLibraryImport.js';
import { LibrarySheet } from '../../components/knowledge/NewLibrarySheet.js';
import { useCreateLibrary, useDocumentCounts, useFilteredLibraries } from '../../data/knowledge.js';

/** Library list — level 1 of the My Knowledge room. */
export function KnowledgeList(): JSX.Element {
  const navigate = useNavigate();
  const libraries = useFilteredLibraries();
  const counts = useDocumentCounts();
  const createLibrary = useCreateLibrary();
  const [sheetOpen, setSheetOpen] = useState(false);
  const rows = libraries.data ?? [];

  return (
    <section className="flex min-h-[80dvh] flex-col gap-4 px-4 pb-12 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-2xl">My Knowledge</h1>
        <div className="flex items-center gap-2">
          <ChatsuneLibraryImport />
          <button type="button" className="knowledge-new-btn" onClick={() => setSheetOpen(true)}>
            New library
          </button>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="text-paper-soft">No libraries yet — create one to add documents.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((lib) => (
            <li key={lib.id}>
              <button
                type="button"
                className="knowledge-library-row"
                onClick={() => navigate(`/app/knowledge/${lib.id}`)}
              >
                <span className="font-display">{lib.name}</span>
                {lib.description ? (
                  <span className="text-paper-soft text-sm">{lib.description}</span>
                ) : null}
                <span className="text-[11px] uppercase tracking-widest text-paper-soft">
                  {counts.data?.[lib.id] ?? 0} documents
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {sheetOpen ? (
        <LibrarySheet
          title="New library"
          submitLabel="Create"
          onClose={() => setSheetOpen(false)}
          onSubmit={(value) => {
            createLibrary.mutate(value);
            setSheetOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
