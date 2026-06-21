// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AutoSizeTextarea } from '../../components/AutoSizeTextarea.js';
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
import { usePersona } from '../../data/personas.js';
import { useMemoryActions } from '../../lib/use-memory-actions.js';
import { toastStore } from '../../state/toast.store.js';

/** The single home for a persona's memory: review/triage journal entries and
 *  view/edit the consolidated body. Reached from the chat cockpit (with ?chat=)
 *  and from the persona editor's "Manage memory" link. */
export function PersonaMemory(): JSX.Element | null {
  const { id } = useParams<{ id?: string }>();
  const [search] = useSearchParams();
  const chatId = search.get('chat') ?? '';
  const navigate = useNavigate();

  const personaId = id ?? '';
  const { data: persona } = usePersona(personaId || null);
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

  const { data: unextracted = 0 } = useUnextractedCount(chatId);
  const { learnState, consolidateState, learnNow, consolidateNow } = useMemoryActions(chatId);

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

  const deleteWithUndo = (id: string): void => {
    setPendingDelete((s) => new Set(s).add(id));
    const t = setTimeout(() => {
      reject.mutate(id);
      timers.current.delete(id);
      setPendingDelete((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }, UNDO_MS);
    timers.current.set(id, t);
    toastStore.show({
      message: 'Set aside for now',
      tone: 'info',
      durationMs: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          const handle = timers.current.get(id);
          if (handle) clearTimeout(handle);
          timers.current.delete(id);
          setPendingDelete((s) => {
            const n = new Set(s);
            n.delete(id);
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

  if (!persona) return null;

  const back = (): void => navigate(chatId ? `/app/chat/${chatId}` : `/app/persona/${personaId}`);

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
              <button type="button" onClick={() => commit.mutate(e.id)}>
                Commit
              </button>
            ) : null}
            <button type="button" onClick={() => setEditing({ id: e.id, text: e.content })}>
              Edit
            </button>
            <button type="button" onClick={() => deleteWithUndo(e.id)}>
              Delete
            </button>
          </div>
        </>
      )}
    </li>
  );

  return (
    <section className="memory-page">
      <header className="memory-page-header">
        <button
          type="button"
          className="memory-page-back"
          onClick={back}
          aria-label={chatId ? 'Back to chat' : `Back to ${persona.name}`}
        >
          {chatId ? '← Back to chat' : `← ${persona.name}`}
        </button>
        <h1 className="memory-page-title">Memory</h1>
        <span className="memory-page-persona">{persona.name}</span>
      </header>

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
          {learnState.status === 'error' || consolidateState.status === 'error' ? (
            <div className="memory-page-action-error" role="alert">
              <span>
                {learnState.error === 'no-credentials' ||
                consolidateState.error === 'no-credentials'
                  ? 'Credentials unavailable — re-authenticate, then retry.'
                  : "That didn't work."}
              </span>
              <button
                type="button"
                onClick={() => void (learnState.status === 'error' ? learnNow() : consolidateNow())}
              >
                Retry
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="memory-page-orient">
          Open a chat with {persona.name} to learn new memories or consolidate.
        </p>
      )}

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

      {visibleCommitted.length > 0 ? (
        <div className="memory-page-section">
          <h2 className="memory-page-subhead">Committed, awaiting consolidation</h2>
          <ul className="memory-page-list">{visibleCommitted.map((e) => renderRow(e, false))}</ul>
        </div>
      ) : null}

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
              disabled={bodyDraft.trim() === '' || bodyDraft === (currentBody?.content ?? '')}
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
                    <button type="button" onClick={() => rollback.mutate(v.version)}>
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
    </section>
  );
}
