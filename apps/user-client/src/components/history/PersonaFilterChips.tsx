// SPDX-License-Identifier: AGPL-3.0-only
import type { PersonaRow } from '../../boot/client-data-db.js';

interface Props {
  personas: PersonaRow[];
  selectedId: string | null;
  onChange: (next: string | null) => void;
}

export function PersonaFilterChips({ personas, selectedId, onChange }: Props): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Filter chats by persona"
      className="flex gap-2 overflow-x-auto px-1 py-1"
    >
      <Chip
        label="All"
        selected={selectedId === null}
        colour={null}
        onClick={() => onChange(null)}
      />
      {personas.map((p) => (
        <Chip
          key={p.id}
          label={p.name}
          selected={selectedId === p.id}
          colour={p.colour}
          onClick={() => onChange(p.id)}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  selected,
  colour,
  onClick,
}: {
  label: string;
  selected: boolean;
  colour: string | null;
  onClick: () => void;
}): JSX.Element {
  const borderColour = colour ?? 'rgba(255,255,255,0.2)';
  const bg = selected ? (colour ? `${colour}22` : 'rgba(255,255,255,0.08)') : 'transparent';
  return (
    <button
      type="button"
      data-chip
      data-selected={selected ? 'true' : 'false'}
      onClick={onClick}
      className="shrink-0 rounded-full px-3 py-1 text-xs uppercase tracking-wider transition"
      style={{
        border: `1px solid ${borderColour}`,
        background: bg,
        color: colour ?? 'var(--color-paper)',
      }}
    >
      {label}
    </button>
  );
}
