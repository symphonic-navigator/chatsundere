// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from 'react-router-dom';
import { useFilteredLibraries } from '../../data/knowledge.js';

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * Controlled knowledge-assignment list. Renders the user's libraries
 * (NSFW-filtered by adult mode via `useFilteredLibraries`) as toggle rows bound
 * to the persona's `libraryIds`. Empty state points the user at My Knowledge.
 */
export function KnowledgeSection({ selected, onChange }: Props): JSX.Element {
  const { data: libraries } = useFilteredLibraries();

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  if (!libraries || libraries.length === 0) {
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
