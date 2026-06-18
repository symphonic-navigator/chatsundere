// SPDX-License-Identifier: AGPL-3.0-only

import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { importChatsuneLibrary } from '../../data/chatsune-import.js';
import { QK } from '../../data/queryKeys.js';
import { readChatsuneArchive } from '../../lib/chatsune-import/archive-reader.js';
import { parseKnowledgeExport } from '../../lib/chatsune-import/knowledge-parse.js';
import { toastStore } from '../../state/toast.store.js';

/** "Import from Chatsune" action for the Libraries view — always creates a new
 *  library (spec §7), then re-embeds its documents locally. */
export function ChatsuneLibraryImport(): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  async function onPick(file: File): Promise<void> {
    setError(null);
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
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".gz,.tgz,application/gzip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPick(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
      >
        Import library from Chatsune
      </button>
      {error ? <p className="mt-2 text-[11px] text-amber-300/80">{error}</p> : null}
    </div>
  );
}
