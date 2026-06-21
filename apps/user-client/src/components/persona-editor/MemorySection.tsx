// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from 'react-router-dom';
import { AutoSizeTextarea } from '../AutoSizeTextarea.js';

interface Props {
  personaId: string | null;
  useMemory: boolean;
  memoryInstructions: string;
  onChange: (patch: { useMemory?: boolean; memoryInstructions?: string }) => void;
}

/** Memory settings for the persona editor: the on/off toggle, the
 *  "what to remember" instructions, and a link into the full memory page.
 *  The memory content itself (entries, body, versions) lives on
 *  /app/persona/:id/memory — a single home, not duplicated here. */
export function MemorySection({
  personaId,
  useMemory,
  memoryInstructions,
  onChange,
}: Props): JSX.Element {
  return (
    <div className="memory-section">
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

      {personaId == null ? (
        <p className="memory-section-hint">
          Memory builds as you chat — available after you save this companion.
        </p>
      ) : (
        <Link className="memory-section-link" to={`/app/persona/${personaId}/memory`}>
          Manage memory →
        </Link>
      )}
    </div>
  );
}
