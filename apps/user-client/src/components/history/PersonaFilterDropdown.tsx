// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import type { PersonaRow } from '../../boot/client-data-db.js';

interface Props {
  personas: PersonaRow[];
  /** Currently selected persona id, or `null` for "All personas". */
  selectedId: string | null;
  onChange: (next: string | null) => void;
}

/**
 * Persona filter as a custom dropdown. A native `<select>` renders its option
 * list via the OS, which cannot be themed and clashes badly with the dark
 * opulent surface — so the open list is hand-built: a dark popover with
 * per-persona colour dots and an accent-highlighted selection. Scales to many
 * personas (where the chip row stopped being handle-able).
 */
export function PersonaFilterDropdown({ personas, selectedId, onChange }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = selectedId ? (personas.find((p) => p.id === selectedId) ?? null) : null;

  // Close on outside interaction / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (e: Event): void => {
      const t = e.target as Node | null;
      if (t && rootRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  function pick(id: string | null): void {
    onChange(id);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="persona-dropdown">
      <button
        type="button"
        aria-label="Filter by persona"
        aria-haspopup="true"
        aria-expanded={open}
        className="persona-dropdown-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="persona-dropdown-value">
          {selected ? (
            <span
              className="persona-dropdown-dot"
              style={{ background: selected.colour }}
              aria-hidden
            />
          ) : null}
          {selected ? selected.name : 'All personas'}
        </span>
        <span className="persona-dropdown-chevron" data-open={open || undefined} aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="persona-dropdown-list">
          <button
            type="button"
            className="persona-dropdown-option"
            data-selected={selectedId === null || undefined}
            onClick={() => pick(null)}
          >
            All personas
          </button>
          {personas.map((p) => (
            <button
              key={p.id}
              type="button"
              className="persona-dropdown-option"
              data-selected={selectedId === p.id || undefined}
              onClick={() => pick(p.id)}
            >
              <span className="persona-dropdown-dot" style={{ background: p.colour }} aria-hidden />
              {p.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
