// SPDX-License-Identifier: AGPL-3.0-only

import { CryptoError } from '@chatsundere/crypto';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getClientDataDb } from '../../boot/client-data-db.js';
import { importPersonaPack } from '../../data/chatsundere-import.js';
import { previewChatsuneSessions } from '../../data/chatsune-import.js';
import { decryptTransferPack } from '../../lib/chatsundere-transfer/encrypted-container.js';
import {
  readManifestFormat,
  readManifestJson,
} from '../../lib/chatsundere-transfer/import-detect.js';
import { readChatsuneArchive } from '../../lib/chatsune-import/archive-reader.js';
import {
  type ParsedPersonaExport,
  parsePersonaExport,
} from '../../lib/chatsune-import/persona-parse.js';
import { DecryptPromptOverlay } from '../transfer/DecryptPromptOverlay.js';

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
 * Persona import control: auto-detects a Chatsune or Chatsundere export and
 * imports accordingly. Parses a persona export, previews the chat counts +
 * memory note, and hands the result to the editor via `onApply`. The editor
 * owns avatar normalisation and the post-save chat write (spec §5.1).
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
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  /** Non-null when the target name collides with an existing persona name. */
  const [personaCollision, setPersonaCollision] = useState<{
    name: string;
    doImport: () => Promise<void>;
  } | null>(null);
  const [pendingEncrypted, setPendingEncrypted] = useState<Blob | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState<string | null>(null);

  async function doChatsunderePersonaImport(file: Blob, sourceName: string): Promise<void> {
    const result = await importPersonaPack(file, sourceName);
    navigate(`/app/persona/${result.personaId}`, {
      state: {
        justImported: { modelBound: result.modelBound, droppedBindings: result.droppedBindings },
      },
    });
  }

  async function onPick(file: Blob): Promise<void> {
    setError(null);
    setPreview(null);
    setPersonaCollision(null);

    const format = await readManifestFormat(file);

    if (format === 'chatsundere/encrypted') {
      setDecryptError(null);
      setPendingEncrypted(file);
      return;
    }

    if (format === 'chatsundere/persona') {
      // Create a new persona from the pack and land in its editor.
      // Always create-new — never merge into an existing persona.
      try {
        const manifest = await readManifestJson(file);
        const sourceName =
          typeof manifest === 'object' &&
          manifest !== null &&
          'source' in manifest &&
          typeof (manifest as { source?: unknown }).source === 'object' &&
          (manifest as { source?: { personaName?: unknown } }).source !== null
            ? (((manifest as { source: { personaName?: unknown } }).source.personaName as
                | string
                | undefined) ?? 'Imported Persona')
            : 'Imported Persona';

        // Check whether a persona with this name already exists. If so, surface
        // an explanatory warning before proceeding — the import is non-blocking
        // and creates a second, separate persona.
        const db = getClientDataDb();
        const existing = await db.personas.filter((p) => p.name === sourceName).first();
        if (existing) {
          setPersonaCollision({
            name: sourceName,
            doImport: () => doChatsunderePersonaImport(file, sourceName),
          });
          return;
        }

        await doChatsunderePersonaImport(file, sourceName);
      } catch (e) {
        setError((e as Error).message);
      }
      return;
    }

    if (!format.startsWith('chatsune/')) {
      setError('Not a valid persona export.');
      return;
    }

    // Existing Chatsune flow — unchanged.
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

  async function onDecryptSubmit(password: string): Promise<void> {
    const file = pendingEncrypted;
    if (!file) return;
    setDecrypting(true);
    setDecryptError(null);
    try {
      const inner = await decryptTransferPack(file, password);
      setPendingEncrypted(null);
      setDecrypting(false);
      await onPick(inner);
    } catch (e) {
      setDecrypting(false);
      if (e instanceof CryptoError && e.code === 'wrong_password') {
        setDecryptError('That password didn’t work, or the file is damaged — try again.');
      } else {
        setPendingEncrypted(null);
        setError(e instanceof Error ? e.message : 'Could not open this file.');
      }
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
      {pendingEncrypted ? (
        <DecryptPromptOverlay
          onSubmit={(pw) => void onDecryptSubmit(pw)}
          onCancel={() => {
            setPendingEncrypted(null);
            setDecryptError(null);
          }}
          error={decryptError}
          busy={decrypting}
        />
      ) : null}
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
        Import a persona
      </button>

      {error ? <p className="mt-2 text-[11px] text-amber-300/80">{error}</p> : null}

      {personaCollision ? (
        <div className="mt-2 rounded-md border border-paper-soft/20 bg-white/[0.02] p-3 text-[11px] text-paper-soft">
          <p>
            You already have a &ldquo;{personaCollision.name}&rdquo;. Importing creates a second,
            separate one — nothing is merged or overwritten.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                const collision = personaCollision;
                setPersonaCollision(null);
                collision.doImport().catch((e) => setError((e as Error).message));
              }}
              className="rounded-md border border-paper px-3 py-1 text-xs uppercase tracking-wider text-paper hover:bg-paper/10"
            >
              Create anyway
            </button>
            <button
              type="button"
              onClick={() => setPersonaCollision(null)}
              className="rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

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
