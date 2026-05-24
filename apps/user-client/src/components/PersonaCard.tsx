// SPDX-License-Identifier: AGPL-3.0-only

import { Link } from 'react-router-dom';
import type { PersonaRow } from '../boot/client-data-db.js';
import { monogramFor } from '../lib/monogram.js';
import type { ResolvedMindspace } from '../state/mindspace-resolver.js';

interface Props {
  persona: PersonaRow;
  mindspace: ResolvedMindspace;
  hasProvider: boolean;
  onChat: (personaId: string) => void;
}

/**
 * Compact card representing a single persona in My Circle.
 *
 * Visual layers (outer-to-inner):
 *  - Adult-status: NSFW (danger-red) or SFW (paper-soft-grey) box-shadow
 *    ring + shimmer streak via .persona-card-{nsfw,sfw} CSS.
 *  - Mindspace: card background tint (palette.accentSubtle — a 6% rgba
 *    of the persona's mindspace accent colour) + base border
 *    (palette.accentBorder, a 15% rgba of the same accent) reflect the
 *    persona's resolved mindspace (with fallback to user default —
 *    resolved by the caller).
 *  - Persona identity: monogram tile + name in persona.colour, tagline.
 *
 * The `mindspace` prop is required — there is intentionally no default
 * inside this component. Every consumer must explicitly resolve and pass
 * the mindspace so the call site thinks about context (see spec §4.5).
 *
 * The shimmer animation is per-card random-offset (derived from persona.id)
 * so multiple cards do not glitter in unison. prefers-reduced-motion
 * disables the shimmer; the static glow ring remains visible.
 */
export function PersonaCard({ persona, mindspace, hasProvider, onChat }: Props): JSX.Element {
  const monogram = monogramFor(persona.name);
  const tagline = persona.tagline || persona.instructions.slice(0, 60);
  // 0–4 second random animation delay so cards don't shimmer in unison.
  const shimmerDelaySeconds = (hashStringToInt(persona.id) % 4000) / 1000;

  return (
    <li
      data-persona-card
      data-adult={persona.adultPersona ? 'true' : 'false'}
      className={`persona-card relative flex items-center gap-3 rounded-lg transition ${
        persona.adultPersona ? 'persona-card-nsfw' : 'persona-card-sfw'
      }`}
      style={{
        background: mindspace.palette.accentSubtle,
        border: `1px solid ${mindspace.palette.accentBorder}`,
        ['--persona-shimmer-delay' as unknown as string]: `${shimmerDelaySeconds}s`,
      }}
    >
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

/** djb2-style stable hash; used only for picking a stable shimmer-delay per persona. */
function hashStringToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}
