// SPDX-License-Identifier: AGPL-3.0-only
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { ListRow } from '../../components/ui/ListRow.js';
import { OverflowMenu } from '../../components/ui/OverflowMenu.js';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { useHelp } from '../../content/help/use-help.js';
import { importChatsuneLibrary } from '../../data/chatsune-import.js';
import { useDocumentCounts, useFilteredLibraries } from '../../data/knowledge.js';
import { QK } from '../../data/queryKeys.js';
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

  async function onPickImport(file: File): Promise<void> {
    setImportError(null);
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
            items={[{ label: 'Import from Chatsune', onSelect: () => importRef.current?.click() }]}
          />
        </div>
        {importError ? (
          <p className="text-[11px] text-amber-300/80">Import failed: {importError}</p>
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
