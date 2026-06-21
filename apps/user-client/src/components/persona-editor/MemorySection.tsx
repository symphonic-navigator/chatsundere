// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import {
  useBodyVersions,
  useCommittedEntries,
  useCurrentBody,
  useRollbackBody,
  useSaveBodyManual,
} from '../../data/memory.js';
import { AutoSizeTextarea } from '../AutoSizeTextarea.js';

interface Props {
  personaId: string | null;
  useMemory: boolean;
  memoryInstructions: string;
  onChange: (patch: { useMemory?: boolean; memoryInstructions?: string }) => void;
}

/** Memory section for the persona editor.
 * Group 1: settings (toggle + instructions textarea).
 * Groups 2–3: live memory body + version list + committed entries (only for saved personas).
 */
export function MemorySection({
  personaId,
  useMemory,
  memoryInstructions,
  onChange,
}: Props): JSX.Element {
  return (
    <div className="memory-section">
      {/* Group 1 — settings */}
      <div className="memory-section-settings">
        <div className="memory-toggle-row">
          <span>Remember across conversations</span>
          <button
            type="button"
            aria-label="Memory"
            aria-pressed={useMemory}
            onClick={() => onChange({ useMemory: !useMemory })}
            className={`h-6 w-12 shrink-0 rounded-full border ${
              useMemory ? 'border-paper bg-paper/30' : 'border-paper-soft/30 bg-white/5'
            }`}
          >
            <span
              className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
                useMemory ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
        <AutoSizeTextarea
          aria-label="What to remember"
          placeholder="e.g. remember my projects, my tone preferences, the people I mention"
          minRows={2}
          maxRows={10}
          value={memoryInstructions}
          onChange={(v) => onChange({ memoryInstructions: v })}
        />
      </div>

      {/* Groups 2–3 — the memory itself + inspect (only for a saved persona) */}
      {personaId == null ? (
        <p className="memory-section-hint">
          Memory builds as you chat — available after you save this companion.
        </p>
      ) : (
        <SavedPersonaMemory personaId={personaId} />
      )}
    </div>
  );
}

function SavedPersonaMemory({ personaId }: { personaId: string }): JSX.Element {
  const { data: body } = useCurrentBody(personaId);
  const { data: versions = [] } = useBodyVersions(personaId);
  const { data: committed = [] } = useCommittedEntries(personaId);
  const saveBodyManual = useSaveBodyManual(personaId);
  const rollback = useRollbackBody(personaId);

  const [draft, setDraft] = useState(body?.content ?? '');
  useEffect(() => {
    setDraft(body?.content ?? '');
  }, [body?.content]);

  return (
    <>
      {/* Group 2 — the memory itself */}
      <div className="memory-section-body">
        <h4>The memory itself</h4>
        {versions.length === 0 ? (
          <p className="memory-section-hint">Nothing remembered yet.</p>
        ) : (
          <>
            <AutoSizeTextarea
              aria-label="Memory body"
              minRows={4}
              maxRows={30}
              value={draft}
              onChange={setDraft}
            />
            <button
              type="button"
              disabled={draft.trim() === '' || draft === (body?.content ?? '')}
              onClick={() => saveBodyManual.mutate(draft)}
            >
              Save memory
            </button>
            <ul className="memory-version-list">
              {versions.map((v) => (
                <li key={v.id}>
                  <span>
                    v{v.version} · {v.source}
                  </span>
                  {v.version !== (body?.version ?? 0) ? (
                    <button type="button" onClick={() => rollback.mutate(v.version)}>
                      Restore
                    </button>
                  ) : (
                    <span className="memory-version-current">current</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Group 3 — inspect: committed entries awaiting consolidation */}
      {committed.length > 0 ? (
        <div className="memory-section-committed">
          <h4>Committed, awaiting consolidation</h4>
          <ul>
            {committed.map((e) => (
              <li key={e.id}>{e.content}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
