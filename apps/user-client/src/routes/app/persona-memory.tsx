// SPDX-License-Identifier: AGPL-3.0-only
import { Brain } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AutoSizeTextarea } from '../../components/AutoSizeTextarea.js';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { useHelp } from '../../content/help/use-help.js';
import {
  useBodyVersions,
  useCommitEntry,
  useCommittedEntries,
  useCurrentBody,
  useJournalEntries,
  useMarkMemoryViewed,
  useRejectEntry,
  useRollbackBody,
  useSaveBodyManual,
  useUnextractedCount,
  useUpdateEntry,
} from '../../data/memory.js';
import type { MemoryActionState } from '../../lib/use-memory-actions.js';
import { useMemoryActions } from '../../lib/use-memory-actions.js';
import type { MemoryActionError } from '../../memory/classify-error.js';
import { toastStore } from '../../state/toast.store.js';
import { useClass2Gate } from '../../sync/gate.js';
import { usePersonaEditing } from './persona/use-persona-editing.js';

const ERROR_COPY: Record<MemoryActionError, string> = {
  'no-credentials': 'Credentials unavailable — re-authenticate, then retry.',
  timeout:
    'The model took too long to answer. Nothing was lost — it may be busy; try again in a little while.',
  'upstream-busy':
    'Your AI provider is having trouble right now. Nothing was lost — try again in a few minutes.',
  'invalid-output':
    "The model's answer couldn't be used. Nothing was lost — retrying usually helps.",
  failed: "That didn't work — but nothing was lost. Try again.",
};

/** Picks the copy for an errored action state — partial-progress copy takes
 *  precedence over the code-specific message once at least one slice was
 *  checkpointed, unless the failure was credentials (nothing to retry-into). */
function memoryErrorCopy(state: MemoryActionState): string {
  if ((state.partialSlices ?? 0) > 0 && state.error !== 'no-credentials')
    return 'Consolidated some of them — the rest are still below. Try again to finish.';
  return ERROR_COPY[state.error ?? 'failed'];
}

/** The single home for a persona's memory: review/triage journal entries and
 *  view/edit the consolidated body. Reached from the chat cockpit (with ?chat=)
 *  and from the persona hub's Memory tile. */
export function PersonaMemory(): JSX.Element {
  const { id } = useParams<{ id?: string }>();
  const [search] = useSearchParams();
  const chatId = search.get('chat') ?? '';

  const personaId = id ?? '';
  const backPath = chatId ? `/app/chat/${chatId}` : `/app/persona/${personaId}`;

  const { onHelp, helpOverlay } = useHelp('persona-memory');
  const { persona, patch } = usePersonaEditing(personaId || null);

  const { data: currentBody } = useCurrentBody(personaId);
  const markViewed = useMarkMemoryViewed(personaId);
  const bodyVersion = currentBody?.version ?? 0;

  const { data: uncommitted = [] } = useJournalEntries(personaId, 'uncommitted');
  const { data: committed = [] } = useCommittedEntries(personaId);
  const commit = useCommitEntry(personaId);
  const reject = useRejectEntry(personaId);
  const update = useUpdateEntry(personaId);

  const { data: versions = [] } = useBodyVersions(personaId);
  const saveBodyManual = useSaveBodyManual(personaId);
  const rollback = useRollbackBody(personaId);
  // Memory management edits are Class-2 writes on synced records — disabled
  // offline for a linked account (spec §11.2); local-only users are never gated.
  const class2 = useClass2Gate();

  const { data: unextracted = 0 } = useUnextractedCount(chatId);
  const { learnState, consolidateState, learnNow, consolidateNow, lastAttempted } =
    useMemoryActions(chatId);

  // Local draft for memoryInstructions — held locally, persisted on blur.
  const [memInstructions, setMemInstructions] = useState('');
  useEffect(() => {
    setMemInstructions(persona?.memoryInstructions ?? '');
  }, [persona?.memoryInstructions]);

  const [bodyDraft, setBodyDraft] = useState(currentBody?.content ?? '');
  useEffect(() => {
    setBodyDraft(currentBody?.content ?? '');
  }, [currentBody?.content]);

  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  // Reject = deferred delete + undo. Hide locally, commit the delete after the window.
  // No unmount cleanup: a pending delete must complete; the toast closure keeps
  // clearTimeout reachable even after navigation (relocated from MemorySheet).
  const UNDO_MS = 5000;
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const deleteWithUndo = (entryId: string): void => {
    setPendingDelete((s) => new Set(s).add(entryId));
    const t = setTimeout(() => {
      reject.mutate(entryId);
      timers.current.delete(entryId);
      setPendingDelete((s) => {
        const n = new Set(s);
        n.delete(entryId);
        return n;
      });
    }, UNDO_MS);
    timers.current.set(entryId, t);
    toastStore.show({
      message: 'Set aside for now',
      tone: 'info',
      durationMs: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          const handle = timers.current.get(entryId);
          if (handle) clearTimeout(handle);
          timers.current.delete(entryId);
          setPendingDelete((s) => {
            const n = new Set(s);
            n.delete(entryId);
            return n;
          });
        },
      },
    });
  };

  const visiblePending = uncommitted.filter((e) => !pendingDelete.has(e.id));
  const visibleCommitted = committed.filter((e) => !pendingDelete.has(e.id));

  // Mark the current body version viewed on entry — relocated from the cockpit's
  // open-overlay trigger. Fires from both entry points (deliberate, spec §3.4).
  // biome-ignore lint/correctness/useExhaustiveDependencies: markViewed is a stable mutation object; depend only on the value that gates the call.
  useEffect(() => {
    if (personaId && bodyVersion > 0) markViewed.mutate(bodyVersion);
  }, [personaId, bodyVersion]);

  // ── Guard: still loading ──────────────────────────────────────────────────
  if (persona === undefined) {
    return (
      <PageScaffold
        crumbs={[
          { label: 'My Circle', to: '/app/circle' },
          { label: 'Persona', to: `/app/persona/${personaId}` },
          { label: 'Memory' },
        ]}
        back={backPath}
      >
        <div data-testid="persona-memory" className="px-4 pt-4" />
      </PageScaffold>
    );
  }

  // ── Guard: unknown persona ────────────────────────────────────────────────
  if (persona === null) {
    return (
      <PageScaffold
        crumbs={[{ label: 'My Circle', to: '/app/circle' }]}
        back={`/app/persona/${personaId}`}
      >
        <div
          data-testid="persona-memory"
          className="flex flex-col items-center gap-4 px-4 pt-16 text-center"
        >
          <p className="text-paper-soft">Persona not found.</p>
        </div>
      </PageScaffold>
    );
  }

  const renderRow = (e: { id: string; content: string }, canCommit: boolean): JSX.Element => (
    <li key={e.id} className="memory-page-entry">
      {editing?.id === e.id ? (
        <>
          <textarea
            aria-label="Edit memory"
            className="memory-page-edit"
            value={editing.text}
            onChange={(ev) => setEditing({ id: e.id, text: ev.target.value })}
          />
          <div className="memory-page-entry-actions">
            <button
              type="button"
              disabled={class2.disabled}
              title={class2.disabled ? (class2.tooltip ?? undefined) : undefined}
              onClick={() => {
                update.mutate({ id: e.id, content: editing.text });
                setEditing(null);
              }}
            >
              Save
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="memory-page-entry-content">{e.content}</span>
          <div className="memory-page-entry-actions">
            {canCommit ? (
              <button
                type="button"
                disabled={class2.disabled}
                title={class2.disabled ? (class2.tooltip ?? undefined) : undefined}
                onClick={() => commit.mutate(e.id)}
              >
                Commit
              </button>
            ) : null}
            <button
              type="button"
              disabled={class2.disabled}
              title={class2.disabled ? (class2.tooltip ?? undefined) : undefined}
              onClick={() => setEditing({ id: e.id, text: e.content })}
            >
              Edit
            </button>
            <button
              type="button"
              disabled={class2.disabled}
              title={class2.disabled ? (class2.tooltip ?? undefined) : undefined}
              onClick={() => deleteWithUndo(e.id)}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </li>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageScaffold
      crumbs={[
        { label: 'My Circle', to: '/app/circle' },
        { label: persona.name || 'Persona', to: `/app/persona/${personaId}` },
        { label: 'Memory' },
      ]}
      back={backPath}
      onHelp={onHelp}
    >
      {helpOverlay}
      <div data-testid="persona-memory" className="flex flex-col gap-6 px-4 pb-8 pt-4">
        <h1 className="flex items-center gap-2 text-lg font-medium text-paper">
          <Brain size={18} aria-hidden="true" />
          Memory
        </h1>

        {/* ── Per-persona settings (persona-wide, not per-chat) ──────────── */}
        <section className="flex flex-col gap-4">
          {/* Remembering toggle */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-paper">Remembering</div>
              <p className="text-[11px] text-paper-soft">
                Applies to all chats with {persona.name}. When on, this persona builds a memory of
                you and your conversations.
              </p>
            </div>
            <button
              type="button"
              aria-label="Remembering"
              aria-pressed={persona.useMemory}
              onClick={() => void patch({ useMemory: !persona.useMemory })}
              className={`h-6 w-12 shrink-0 rounded-full border ${
                persona.useMemory ? 'border-paper bg-paper/30' : 'border-paper-soft/30 bg-white/5'
              }`}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
                  persona.useMemory ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Memory instructions (blur-save) */}
          <div>
            <div className="mb-1 text-xs uppercase tracking-wider text-paper-soft">
              Memory Instructions
            </div>
            <AutoSizeTextarea
              aria-label="Memory instructions"
              placeholder="e.g. remember my projects, my tone preferences, the people I mention"
              minRows={2}
              maxRows={10}
              value={memInstructions}
              onChange={setMemInstructions}
              onBlur={(v) => void patch({ memoryInstructions: v })}
            />
            <p className="mt-1 text-[11px] text-paper-soft">
              Guide what {persona.name} pays attention to when building your memory.
            </p>
          </div>
        </section>

        {/* ── Chat actions (gated to ?chat= path) ───────────────────────── */}
        {chatId ? (
          <div className="memory-page-actions">
            <button
              type="button"
              disabled={unextracted < 1 || learnState.status === 'pending'}
              title={unextracted < 1 ? 'Nothing new to learn yet — keep chatting.' : undefined}
              onClick={() => void learnNow()}
            >
              {learnState.status === 'pending' ? 'Learning…' : 'Learn from this chat'}
            </button>
            <button
              type="button"
              disabled={committed.length < 1 || consolidateState.status === 'pending'}
              title={committed.length < 1 ? 'No committed memories to consolidate yet.' : undefined}
              onClick={() => void consolidateNow()}
            >
              {consolidateState.status === 'pending' ? 'Consolidating…' : 'Consolidate now'}
            </button>
            {learnState.status === 'pending' || consolidateState.status === 'pending' ? (
              <p className="text-[11px] text-paper-soft">
                This can take a minute or two for a large memory — you can leave this page; it keeps
                going.
              </p>
            ) : null}
            {(() => {
              // The slot shows the most-recently-attempted action's error, and Retry fires
              // that same action — copy and button can never refer to different actions.
              const candidates =
                lastAttempted === 'consolidate'
                  ? ([
                      [consolidateState, consolidateNow],
                      [learnState, learnNow],
                    ] as const)
                  : ([
                      [learnState, learnNow],
                      [consolidateState, consolidateNow],
                    ] as const);
              const active = candidates.find(([s]) => s.status === 'error');
              if (!active) return null;
              const [state, retry] = active;
              return (
                <div className="memory-page-action-error" role="alert">
                  <span>{memoryErrorCopy(state)}</span>
                  <button type="button" onClick={() => void retry()}>
                    Retry
                  </button>
                </div>
              );
            })()}
          </div>
        ) : (
          <p className="memory-page-orient">
            Open a chat with {persona.name} to learn new memories or consolidate.
          </p>
        )}

        {/* ── Pending journal entries ────────────────────────────────────── */}
        <div className="memory-page-section">
          <h2 className="memory-page-subhead">Pending</h2>
          {visiblePending.length === 0 ? (
            <p className="memory-page-empty">
              {chatId
                ? `No pending memories. Keep chatting and ${persona.name} will start to remember you.`
                : 'No pending memories yet.'}
            </p>
          ) : (
            <ul className="memory-page-list">{visiblePending.map((e) => renderRow(e, true))}</ul>
          )}
        </div>

        {/* ── Committed entries awaiting consolidation ───────────────────── */}
        {visibleCommitted.length > 0 ? (
          <div className="memory-page-section">
            <h2 className="memory-page-subhead">Committed, awaiting consolidation</h2>
            <ul className="memory-page-list">{visibleCommitted.map((e) => renderRow(e, false))}</ul>
          </div>
        ) : null}

        {/* ── The memory body + version history ─────────────────────────── */}
        <div className="memory-page-section">
          <h2 className="memory-page-subhead">The memory itself</h2>
          {versions.length === 0 ? (
            <p className="memory-page-empty">Nothing remembered yet.</p>
          ) : (
            <>
              <AutoSizeTextarea
                aria-label="Memory body"
                minRows={4}
                maxRows={30}
                value={bodyDraft}
                onChange={setBodyDraft}
              />
              <button
                type="button"
                className="memory-page-save-body"
                disabled={
                  class2.disabled ||
                  bodyDraft.trim() === '' ||
                  bodyDraft === (currentBody?.content ?? '')
                }
                title={class2.disabled ? (class2.tooltip ?? undefined) : undefined}
                onClick={() => saveBodyManual.mutate(bodyDraft)}
              >
                Save memory
              </button>
              <ul className="memory-page-version-list">
                {versions.map((v) => (
                  <li key={v.id}>
                    <span>
                      v{v.version} · {v.source}
                    </span>
                    {v.version !== (currentBody?.version ?? 0) ? (
                      <button
                        type="button"
                        disabled={class2.disabled}
                        title={class2.disabled ? (class2.tooltip ?? undefined) : undefined}
                        onClick={() => rollback.mutate(v.version)}
                      >
                        Restore
                      </button>
                    ) : (
                      <span className="memory-page-version-current">current</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </PageScaffold>
  );
}
