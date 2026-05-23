// SPDX-License-Identifier: AGPL-3.0-only

import { Link } from 'react-router-dom';
import type { PersonaRow } from '../boot/client-data-db.js';
import { monogramFor } from '../lib/monogram.js';

interface Props {
  persona: PersonaRow;
  hasProvider: boolean;
  onChat: (personaId: string) => void;
}

/**
 * Compact card representing a single persona in My Circle.
 * Left: monogram tile coloured with the persona accent.
 * Middle: persona name (in persona colour) + tagline (or first 60 chars of instructions).
 * Right: Chat button, or a "Provider missing" badge + disabled Chat button.
 * Card body click navigates to the persona editor.
 */
export function PersonaCard({ persona, hasProvider, onChat }: Props): JSX.Element {
  const monogram = monogramFor(persona.name);
  const tagline = persona.tagline || persona.instructions.slice(0, 60);

  return (
    <li className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] transition hover:bg-white/[0.04]">
      <Link
        to={`/app/persona/${persona.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 p-3"
      >
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-md font-display text-lg"
          style={{
            background: `${persona.colour}1f`,
            color: persona.colour,
            border: `1px solid ${persona.colour}33`,
          }}
        >
          {monogram}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-base" style={{ color: persona.colour }}>
            {persona.name}
          </div>
          <div className="truncate text-xs text-paper-soft">{tagline}</div>
        </div>
      </Link>

      <div className="flex shrink-0 items-center gap-2 pr-3">
        {hasProvider ? (
          <button
            type="button"
            aria-label="Chat"
            onClick={() => onChat(persona.id)}
            className="rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper hover:border-paper"
          >
            Chat
          </button>
        ) : (
          <>
            <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-danger">
              Provider missing
            </span>
            <button
              type="button"
              aria-label="Chat"
              disabled
              className="rounded-md border border-paper-soft/20 px-3 py-1 text-xs uppercase tracking-wider text-paper-soft/40"
            >
              Chat
            </button>
          </>
        )}
      </div>
    </li>
  );
}
