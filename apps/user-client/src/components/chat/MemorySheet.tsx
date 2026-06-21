// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';
import type { PersonaRow } from '../../boot/client-data-db.js';
import {
  useCommitEntry,
  useCommittedEntries,
  useJournalEntries,
  useRejectEntry,
  useUnextractedCount,
  useUpdateEntry,
} from '../../data/memory.js';
import { useDismissOnOutside } from '../../lib/use-dismiss-on-outside.js';
import { useMemoryActions } from '../../lib/use-memory-actions.js';
import { toastStore } from '../../state/toast.store.js';

interface Props {
  persona: PersonaRow;
  chatId: string;
  onClose: () => void;
}

const UNDO_MS = 5000;

export function MemorySheet({ persona, chatId, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  useDismissOnOutside(true, ref, onClose);

  const { data: uncommitted = [] } = useJournalEntries(persona.id, 'uncommitted');
  const { data: committed = [] } = useCommittedEntries(persona.id);
  const { data: unextracted = 0 } = useUnextractedCount(chatId);
  const commit = useCommitEntry(persona.id);
  const reject = useRejectEntry(persona.id);
  const update = useUpdateEntry(persona.id);
  const { learnState, consolidateState, learnNow, consolidateNow } = useMemoryActions(chatId);

  // Reject = deferred delete + undo. We hide locally and commit the delete after UNDO_MS.
  const [pendingReject, setPendingReject] = useState<Set<string>>(new Set());
  // Deliberately NO unmount cleanup: a pending reject must complete (the user tapped
  // Reject), and the Undo toast's closure keeps clearTimeout reachable even after the
  // sheet closes. Clearing these on unmount would silently drop the reject.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const rejectWithUndo = (id: string): void => {
    setPendingReject((s) => new Set(s).add(id));
    const t = setTimeout(() => {
      reject.mutate(id);
      timers.current.delete(id);
      setPendingReject((s) => {
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
          setPendingReject((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          });
        },
      },
    });
  };

  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const visible = uncommitted.filter((e) => !pendingReject.has(e.id));

  return (
    <dialog ref={ref} className="memory-sheet" aria-label="Chat memory" open>
      <header className="memory-sheet-header">
        <span>Memory</span>
        <button type="button" aria-label="Close memory" onClick={onClose}>
          ✕
        </button>
      </header>

      <div className="memory-actions">
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
      </div>

      {learnState.status === 'error' || consolidateState.status === 'error' ? (
        <div className="memory-action-error" role="alert">
          <span>
            {learnState.error === 'no-credentials' || consolidateState.error === 'no-credentials'
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

      {visible.length === 0 ? (
        <p className="memory-empty">
          No pending memories. Keep chatting and {persona.name} will start to remember you.
        </p>
      ) : (
        <ul className="memory-entry-list">
          {visible.map((e) => (
            <li key={e.id} className="memory-entry">
              {editing?.id === e.id ? (
                <>
                  <textarea
                    aria-label="Edit memory"
                    value={editing.text}
                    onChange={(ev) => setEditing({ id: e.id, text: ev.target.value })}
                  />
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
                </>
              ) : (
                <>
                  <span className="memory-entry-content">{e.content}</span>
                  <div className="memory-entry-actions">
                    <button type="button" onClick={() => commit.mutate(e.id)}>
                      Commit
                    </button>
                    <button type="button" onClick={() => setEditing({ id: e.id, text: e.content })}>
                      Edit
                    </button>
                    <button type="button" onClick={() => rejectWithUndo(e.id)}>
                      Reject
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {committed.length > 0 ? (
        <p className="memory-committed-note">
          {committed.length} committed, awaiting consolidation — view them in the Memory section.
        </p>
      ) : null}
    </dialog>
  );
}
