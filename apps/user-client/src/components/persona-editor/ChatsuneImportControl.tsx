// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useState } from 'react';
import { previewChatsuneSessions } from '../../data/chatsune-import.js';
import { readChatsuneArchive } from '../../lib/chatsune-import/archive-reader.js';
import {
  type ParsedPersonaExport,
  parsePersonaExport,
} from '../../lib/chatsune-import/persona-parse.js';

export interface AppliedPersonaImport {
  persona: ParsedPersonaExport['persona'];
  avatar: ParsedPersonaExport['avatar'];
  sessions: ParsedPersonaExport['sessions'];
  /** The parsed chatsune memory to import on Save, or null when none. */
  memory: ParsedPersonaExport['memory'];
  /** Whether to overwrite name/tagline/instructions. Always true in create mode. */
  overwriteConfig: boolean;
  /** Number of net-new sessions that will be written on Save. */
  newChatCount: number;
}

interface Preview {
  parsed: ParsedPersonaExport;
  newCount: number;
  skippedCount: number;
}

/**
 * "Import from Chatsune" control for the persona editor. Parses a persona
 * export, previews the chat counts + memory note, and hands the result to the
 * editor via `onApply`. The editor owns avatar normalisation and the post-save
 * chat write (spec §5.1).
 */
export function ChatsuneImportControl({
  mode,
  personaId,
  onApply,
  existingNsfw = false,
}: {
  mode: 'create' | 'edit';
  personaId: string | null;
  onApply: (a: AppliedPersonaImport) => void;
  /** Whether the persona is already marked NSFW — suppresses the upgrade notice. */
  existingNsfw?: boolean;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);

  async function onPick(file: File): Promise<void> {
    setError(null);
    setPreview(null);
    try {
      const archive = await readChatsuneArchive(file);
      const parsed = parsePersonaExport(archive);
      const counts = await previewChatsuneSessions(personaId, parsed.sessions);
      setPreview({ parsed, newCount: counts.newCount, skippedCount: counts.skippedCount });
      setOverwrite(mode === 'create');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function apply(): void {
    if (!preview) return;
    onApply({
      persona: preview.parsed.persona,
      avatar: preview.parsed.avatar,
      sessions: preview.parsed.sessions,
      memory: preview.parsed.memory,
      overwriteConfig: mode === 'create' ? true : overwrite,
      newChatCount: preview.newCount,
    });
    setPreview(null);
  }

  return (
    <div className="mb-3">
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
        Import from Chatsune
      </button>

      {error ? <p className="mt-2 text-[11px] text-amber-300/80">{error}</p> : null}

      {preview ? (
        <div className="mt-2 rounded-md border border-paper-soft/20 bg-white/[0.02] p-3 text-[11px] text-paper-soft">
          <div className="text-sm text-paper">{preview.parsed.persona.name}</div>
          <p className="mt-1">
            {preview.newCount} new
            {preview.skippedCount > 0 ? `, ${preview.skippedCount} already imported (skipped)` : ''}
            {preview.newCount === 1 ? ' chat' : ' chats'}
            {preview.parsed.persona.nsfw ? ' · NSFW' : ''}
          </p>
          {preview.parsed.persona.nsfw && !existingNsfw ? (
            <p className="mt-1">This persona will be marked NSFW to match the imported chats.</p>
          ) : null}
          {preview.parsed.memoryCount > 0 ? (
            <p className="mt-1">
              This export contains {preview.parsed.memoryCount}{' '}
              {preview.parsed.memoryCount === 1 ? 'memory' : 'memories'}
              {mode === 'edit' && (preview.parsed.memory?.memory_bodies.length ?? 0) > 0
                ? '. Importing makes the exported memory this companion’s current one — anything it has learned so far is kept as a previous version you can restore in the Memory section.'
                : ' — they will be imported when you Save.'}
            </p>
          ) : null}
          {mode === 'edit' ? (
            <label className="mt-2 flex items-center gap-2 text-paper">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
              />
              Overwrite persona configuration (name, tagline, instructions) with imported values
            </label>
          ) : null}
          <button
            type="button"
            onClick={apply}
            className="mt-2 rounded-md border border-paper px-3 py-1 text-xs uppercase tracking-wider text-paper hover:bg-paper/10"
          >
            Apply import
          </button>
        </div>
      ) : null}
    </div>
  );
}
