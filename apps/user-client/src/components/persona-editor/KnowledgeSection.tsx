// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from 'react-router-dom';
import { useFilteredLibraries } from '../../data/knowledge.js';

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
  /**
   * Whether the edited persona is an adult persona. An SFW persona is never
   * offered NSFW libraries for assignment, even when the global adult mode is on
   * (NSFW gating layer 1, applied on top of the global-mode filter).
   */
  adultPersona: boolean;
}

/**
 * Controlled knowledge-assignment list. Renders the user's libraries
 * (NSFW-filtered by adult mode via `useFilteredLibraries`, then further gated to
 * the persona's adult flag) as toggle rows bound to the persona's `libraryIds`.
 * Empty state points the user at My Knowledge.
 */
export function KnowledgeSection({ selected, onChange, adultPersona }: Props): JSX.Element {
  const libraries = (useFilteredLibraries().data ?? []).filter((l) => adultPersona || !l.nsfw);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  if (libraries.length === 0) {
    return (
      <p className="text-[11px] text-paper-soft">
        No knowledge libraries yet. Create one in{' '}
        <Link to="/app/knowledge" className="text-paper underline">
          My Knowledge
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {libraries.map((lib) => {
        const active = selected.includes(lib.id);
        return (
          <button
            key={lib.id}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(lib.id)}
            className={`flex items-center justify-between gap-3 rounded-md border p-3 text-left ${
              active
                ? 'border-paper bg-white/[0.04]'
                : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
            }`}
          >
            <div className="min-w-0">
              <div className="font-display text-sm text-paper">{lib.name}</div>
              {lib.description ? (
                <div className="mt-0.5 truncate text-xs text-paper-soft">{lib.description}</div>
              ) : null}
            </div>
            {active ? <span aria-hidden>✓</span> : null}
          </button>
        );
      })}
    </div>
  );
}
