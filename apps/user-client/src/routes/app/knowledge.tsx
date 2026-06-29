// SPDX-License-Identifier: AGPL-3.0-only
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getClientDataDb } from '../../boot/client-data-db.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { ListRow } from '../../components/ui/ListRow.js';
import { OverflowMenu } from '../../components/ui/OverflowMenu.js';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { useHelp } from '../../content/help/use-help.js';
import { importKnowledgePack } from '../../data/chatsundere-import.js';
import { importChatsuneLibrary } from '../../data/chatsune-import.js';
import { useDocumentCounts, useFilteredLibraries } from '../../data/knowledge.js';
import { QK } from '../../data/queryKeys.js';
import {
  readManifestFormat,
  readManifestJson,
} from '../../lib/chatsundere-transfer/import-detect.js';
import { readChatsuneArchive } from '../../lib/chatsune-import/archive-reader.js';
import { parseKnowledgeExport } from '../../lib/chatsune-import/knowledge-parse.js';
import { toastStore } from '../../state/toast.store.js';

export function KnowledgeList(): JSX.Element {
  const navigate = useNavigate();
  const libraries = useFilteredLibraries();
  const counts = useDocumentCounts();
  const { onHelp, helpOverlay } = useHelp('knowledge');
  const qc = useQueryClient();
  const importRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  /** Non-null when the target name collides with an existing library name. */
  const [libraryCollision, setLibraryCollision] = useState<{
    name: string;
    doImport: () => Promise<void>;
  } | null>(null);

  async function doChatsundereLibraryImport(file: File, sourceName: string): Promise<void> {
    await importKnowledgePack(file, sourceName);
    await qc.invalidateQueries({ queryKey: QK.libraries });
    await qc.invalidateQueries({ queryKey: QK.documentCounts });
    toastStore.show({
      message: `Imported the "${sourceName}" library.`,
      tone: 'success',
      durationMs: 3500,
    });
  }

  async function onPickImport(file: File): Promise<void> {
    setImportError(null);
    setLibraryCollision(null);

    const format = await readManifestFormat(file);

    if (format === 'chatsundere/knowledge') {
      try {
        const manifest = await readManifestJson(file);
        const sourceName =
          typeof manifest === 'object' &&
          manifest !== null &&
          'source' in manifest &&
          typeof (manifest as { source?: unknown }).source === 'object' &&
          (manifest as { source?: { libraryName?: unknown } }).source !== null
            ? (((manifest as { source: { libraryName?: unknown } }).source.libraryName as
                | string
                | undefined) ?? 'Imported Library')
            : 'Imported Library';

        // Check whether a library with this name already exists. If so, surface
        // an explanatory warning before proceeding — the import is non-blocking
        // and creates a second, separate library.
        const db = getClientDataDb();
        const existing = await db.libraries.filter((l) => l.name === sourceName).first();
        if (existing) {
          setLibraryCollision({
            name: sourceName,
            doImport: () => doChatsundereLibraryImport(file, sourceName),
          });
          return;
        }

        await doChatsundereLibraryImport(file, sourceName);
      } catch (e) {
        setImportError(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    if (format !== 'chatsune/knowledge') {
      setImportError('Not a valid library export.');
      return;
    }

    // Existing Chatsune flow — unchanged.
    try {
      const archive = await readChatsuneArchive(file);
      const parsed = parseKnowledgeExport(archive);
      await importChatsuneLibrary(parsed);
      await qc.invalidateQueries({ queryKey: QK.libraries });
      await qc.invalidateQueries({ queryKey: QK.documentCounts });
      toastStore.show({
        message: `Imported the "${parsed.name}" library — its documents are re-embedding now.`,
        tone: 'success',
        durationMs: 3500,
      });
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  }

  const rows = libraries.data ?? [];

  return (
    <PageScaffold crumbs={[{ label: 'My Knowledge' }]} back="/app" onHelp={onHelp}>
      {helpOverlay}
      <input
        ref={importRef}
        type="file"
        accept=".gz,.tgz,application/gzip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPickImport(f);
          e.target.value = '';
        }}
      />
      <div className="flex flex-col gap-4 px-4 pb-8 pt-2">
        <div className="flex items-center justify-between gap-3">
          <Button tone="primary" onClick={() => navigate('/app/knowledge/new')}>
            + Add
          </Button>
          <OverflowMenu
            items={[{ label: 'Import library', onSelect: () => importRef.current?.click() }]}
          />
        </div>
        {importError ? (
          <p className="text-[11px] text-amber-300/80">Import failed: {importError}</p>
        ) : null}
        {libraryCollision ? (
          <div className="rounded-md border border-paper-soft/20 bg-white/[0.02] p-3 text-[11px] text-paper-soft">
            <p>
              You already have a &ldquo;{libraryCollision.name}&rdquo;. Importing creates a second,
              separate one — nothing is merged or overwritten.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const collision = libraryCollision;
                  setLibraryCollision(null);
                  collision
                    .doImport()
                    .catch((e) => setImportError(e instanceof Error ? e.message : String(e)));
                }}
                className="rounded-md border border-paper px-3 py-1 text-xs uppercase tracking-wider text-paper hover:bg-paper/10"
              >
                Import anyway
              </button>
              <button
                type="button"
                onClick={() => setLibraryCollision(null)}
                className="rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {rows.length === 0 ? (
          <p className="text-sm text-paper-soft">No libraries yet — create one to add documents.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((lib) => (
              <ListRow
                key={lib.id}
                title={lib.name}
                subtitle={lib.description || undefined}
                trailing={
                  <span className="flex items-center gap-2">
                    {lib.nsfw ? <Badge tone="danger">NSFW</Badge> : null}
                    <Badge tone="neutral">{counts.data?.[lib.id] ?? 0} docs</Badge>
                  </span>
                }
                onOpen={() => navigate(`/app/knowledge/${lib.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </PageScaffold>
  );
}
