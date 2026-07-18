// SPDX-License-Identifier: AGPL-3.0-only

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QK } from '../../data/queryKeys.js';
import {
  importThirdPartyConversations,
  listAlreadyImported,
} from '../../data/third-party-import.js';
import { relativeTimeLabel } from '../../lib/relative-time.js';
import type { ParseResult } from '../../lib/third-party-import/types.js';
import {
  ParseExportError,
  type ParseHandle,
  parseThirdPartyExport,
} from '../../lib/third-party-import/worker-host.js';
import { Button } from '../ui/Button.js';

type Phase =
  | { kind: 'pick'; error: string | null }
  | { kind: 'parsing'; handle: ParseHandle }
  | { kind: 'select'; result: ParseResult; already: Set<string>; error: string | null }
  | { kind: 'importing' }
  | { kind: 'done'; imported: number };

/** A single row in the select-state list, unifying importable/blocked conversations and parser failures. */
interface Row {
  sourceId: string;
  title: string;
  enabled: boolean;
  reason: string | null;
  /** Date + message-count meta shown under the title for importable rows only (spec §3). */
  meta: string | null;
}

/** "18 Jul · 2 messages" — the decision aid spec §3 asks for on each importable row. */
function rowMeta(lastMessageAt: number, createdAt: number, messageCount: number): string {
  const date = relativeTimeLabel(lastMessageAt || createdAt);
  return `${date} · ${messageCount} ${messageCount === 1 ? 'message' : 'messages'}`;
}

const ERR_UNRECOGNISED =
  "That doesn't look like a ChatGPT or Grok export. Pick the .zip you downloaded from ChatGPT, or the .json file from Grok.";
const ERR_TOO_LARGE = 'This export is very large — importing on a computer is more reliable.';
const ERR_EMPTY = 'This export contains no conversations.';
const ERR_WRITE = "Nothing was imported — that didn't work. Try again.";
const ERR_NEED_SELECTION = 'Select at least one chat to import.';
const ERR_NOTHING_TO_SELECT = 'No conversations to select.';

/** Spec §3: pick → select → import overlay for ChatGPT/Grok chat imports. */
export function ThirdPartyImportOverlay({
  personaId,
  personaName,
  onClose,
  parseFile = parseThirdPartyExport,
}: {
  personaId: string;
  personaName: string;
  onClose: () => void;
  /** Injectable for tests; defaults to the Web Worker host. */
  parseFile?: (file: File) => ParseHandle;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: 'pick', error: null });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  // Closing during parsing must stop the worker, not just drop the overlay.
  const handleClose = useCallback((): void => {
    if (phase.kind === 'parsing') phase.handle.cancel();
    onClose();
  }, [phase, onClose]);

  // Escape closes except while writing (mirror ExportOverlay's listener).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && phase.kind !== 'importing') handleClose();
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [phase.kind, handleClose]);

  const selectPhase = phase.kind === 'select' ? phase : null;

  const rows: Row[] = useMemo(() => {
    if (!selectPhase) return [];
    const { result, already } = selectPhase;
    const convRows: Row[] = result.conversations.map((c) => {
      const title = c.title ?? 'Untitled chat';
      if (already.has(c.sourceId)) {
        return {
          sourceId: c.sourceId,
          title,
          enabled: false,
          reason: 'Already imported',
          meta: null,
        };
      }
      if (c.messages.length === 0) {
        return {
          sourceId: c.sourceId,
          title,
          enabled: false,
          reason: 'Nothing importable',
          meta: null,
        };
      }
      return {
        sourceId: c.sourceId,
        title,
        enabled: true,
        reason: null,
        meta: rowMeta(c.lastMessageAt, c.createdAt, c.messages.length),
      };
    });
    const failureRows: Row[] = result.failures.map((f, i) => ({
      sourceId: `__failure-${i}`,
      title: f.title ?? 'Untitled chat',
      enabled: false,
      reason: f.reason,
      meta: null,
    }));
    return [...convRows, ...failureRows];
  }, [selectPhase]);

  const searchActive = search.trim() !== '';
  const normalisedSearch = search.trim().toLowerCase();
  const visibleRows = searchActive
    ? rows.filter((r) => r.title.toLowerCase().includes(normalisedSearch))
    : rows;
  const visibleImportable = visibleRows.filter((r) => r.enabled);
  const selectAllLabel = searchActive
    ? `Select all ${visibleImportable.length} matches`
    : `Select all ${visibleImportable.length}`;

  function toggleRow(sourceId: string, checked: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(sourceId);
      else next.delete(sourceId);
      return next;
    });
  }

  function onSelectAll(): void {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of visibleImportable) next.add(r.sourceId);
      return next;
    });
  }

  function resetToPick(): void {
    setSelected(new Set());
    setSearch('');
    setPhase({ kind: 'pick', error: null });
  }

  async function onPick(file: File): Promise<void> {
    const handle = parseFile(file);
    setPhase({ kind: 'parsing', handle });
    try {
      const result = await handle.result;
      if (result.conversations.length === 0 && result.failures.length === 0) {
        setPhase({ kind: 'pick', error: ERR_EMPTY });
        return;
      }
      const already = await listAlreadyImported(personaId);
      setSelected(new Set());
      setSearch('');
      setPhase({ kind: 'select', result, already, error: null });
    } catch (e) {
      if (e instanceof ParseExportError && e.kind === 'cancelled') {
        setPhase({ kind: 'pick', error: null });
      } else if (e instanceof ParseExportError && e.kind === 'unrecognised') {
        setPhase({ kind: 'pick', error: ERR_UNRECOGNISED });
      } else if (
        e instanceof ParseExportError &&
        (e.kind === 'worker-crashed' || e.kind === 'parse-failed')
      ) {
        setPhase({ kind: 'pick', error: ERR_TOO_LARGE });
      } else {
        // Not a recognised parse failure — surface the same constructive copy but log it,
        // so a genuine defect doesn't hide behind the "very large export" message.
        console.error(e);
        setPhase({ kind: 'pick', error: ERR_TOO_LARGE });
      }
    }
  }

  async function onImport(): Promise<void> {
    if (phase.kind !== 'select') return;
    const { result, already } = phase;
    const chosen = result.conversations.filter((c) => selected.has(c.sourceId));
    setPhase({ kind: 'importing' });
    try {
      const { imported } = await importThirdPartyConversations(personaId, chosen);
      void qc.invalidateQueries({ queryKey: QK.chats });
      setPhase({ kind: 'done', imported });
    } catch {
      setPhase({ kind: 'select', result, already, error: ERR_WRITE });
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: fixed stacking layer that drives CSS animation; <dialog> requires showModal() which conflicts with our zoom entry
    <div className="cs-dialog-root" role="dialog" aria-modal="true" aria-label="Import chats">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap maps to cancel; Escape is handled on document */}
      <div className="cs-dialog-backdrop" onClick={handleClose} aria-hidden="true" />
      <div className="cs-dialog-card cs-zoom-in max-h-[85vh] overflow-y-auto">
        <div className="cs-dialog-title">Import chats</div>

        {phase.kind === 'pick' ? (
          <div className="mb-2 mt-2 flex flex-col gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".zip,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void onPick(f);
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="self-start rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
            >
              Choose a file
            </button>
            <p className="text-[11px] text-paper-soft">
              Pick the .zip you downloaded from ChatGPT, or the .json file from Grok.
            </p>
            <p className="text-[11px] text-paper-soft">
              These arrive as chats with {personaName} and continue in their voice.
            </p>
            {phase.error ? <p className="text-[11px] text-amber-300/80">{phase.error}</p> : null}
          </div>
        ) : null}

        {phase.kind === 'parsing' ? (
          <div className="mb-2 mt-2 flex flex-col items-start gap-3">
            <p className="text-[11px] text-paper-soft">Reading your export…</p>
            <Button tone="neutral" onClick={() => phase.handle.cancel()}>
              Cancel
            </Button>
          </div>
        ) : null}

        {phase.kind === 'select' ? (
          <div className="mb-2 mt-2 flex flex-col gap-3">
            {phase.error ? <p className="text-[11px] text-amber-300/80">{phase.error}</p> : null}

            {rows.length > 10 ? (
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title"
                aria-label="Search by title"
                className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-paper placeholder:text-paper-soft/60 focus:border-white/20 focus:outline-none"
              />
            ) : null}

            <div className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
              {visibleRows.map((row) => (
                <label
                  key={row.sourceId}
                  className="flex items-start justify-between gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm text-paper">{row.title}</span>
                    {row.reason ? (
                      <span className="text-[11px] text-paper-soft">{row.reason}</span>
                    ) : null}
                    {row.meta ? (
                      <span className="text-[11px] text-paper-soft">{row.meta}</span>
                    ) : null}
                  </div>
                  <input
                    type="checkbox"
                    disabled={!row.enabled}
                    checked={selected.has(row.sourceId)}
                    onChange={(e) => toggleRow(row.sourceId, e.target.checked)}
                    className="mt-0.5 shrink-0 accent-paper"
                  />
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onSelectAll}
                disabled={visibleImportable.length === 0}
                title={visibleImportable.length === 0 ? ERR_NOTHING_TO_SELECT : undefined}
                className="text-[11px] text-aurora-200 underline disabled:cursor-not-allowed disabled:text-paper-soft/50 disabled:no-underline"
              >
                {selectAllLabel}
              </button>
              <button
                type="button"
                onClick={resetToPick}
                className="text-[11px] text-paper-soft underline"
              >
                Pick a different file
              </button>
            </div>

            <div className="cs-dialog-actions">
              <Button
                tone="primary"
                priority
                disabled={selected.size === 0}
                title={selected.size === 0 ? ERR_NEED_SELECTION : undefined}
                onClick={() => {
                  void onImport();
                }}
              >
                Import {selected.size} {selected.size === 1 ? 'chat' : 'chats'}
              </Button>
            </div>
            {selected.size === 0 ? (
              <p className="text-[11px] text-paper-soft">{ERR_NEED_SELECTION}</p>
            ) : null}
          </div>
        ) : null}

        {phase.kind === 'importing' ? (
          <div className="mb-2 mt-2 flex flex-col items-start gap-3">
            <p className="text-[11px] text-paper-soft">Importing…</p>
          </div>
        ) : null}

        {phase.kind === 'done' ? (
          <div className="mb-2 mt-2 flex flex-col gap-3">
            <p className="text-sm text-paper">
              Imported {phase.imported} {phase.imported === 1 ? 'chat' : 'chats'}.
            </p>
            <div className="cs-dialog-actions">
              <Button tone="neutral" onClick={onClose}>
                Done
              </Button>
              <Button
                tone="primary"
                priority
                onClick={() => {
                  navigate(`/app/history?personaId=${personaId}`);
                  onClose();
                }}
              >
                View history
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
