// SPDX-License-Identifier: AGPL-3.0-only
import { Fragment, useState } from 'react';
import type { SearchHit, SearchHitGroup } from '../../lib/search/hit-groups.js';
import { hitDateLabel } from '../../lib/search/hit-groups.js';
import type { Snippet } from '../../lib/search/message-snippet.js';
import { PersonaAvatar } from '../PersonaAvatar.js';

/** Hits shown per chat before "+ n more in this chat". */
export const HITS_PER_GROUP = 3;

/** The persona fields a group header needs. */
export interface HitListPersona {
  id: string;
  name: string;
  colour: string;
}

interface Props {
  groups: SearchHitGroup[];
  personaById: ReadonlyMap<string, HitListPersona>;
  /** A hit was tapped; the caller saves its place and navigates to `hit.href`. */
  onOpen: (hit: SearchHit, group: SearchHitGroup) => void;
  /** Chat ids of the groups already expanded, as held for the return to History. */
  initialExpanded?: readonly string[];
  /** The expanded groups changed; the caller holds them for the return. */
  onExpandedChange?: (chatIds: string[]) => void;
}

/** A snippet's text with its query words wrapped in `<mark>`. */
export function SnippetText({
  snippet,
  className,
}: {
  snippet: Snippet;
  className?: string;
}): JSX.Element {
  const parts: JSX.Element[] = [];
  let at = 0;
  for (const [start, end] of snippet.marks) {
    if (start > at) parts.push(<Fragment key={`t${at}`}>{snippet.text.slice(at, start)}</Fragment>);
    parts.push(
      <mark key={`m${start}`} className="cs-search-mark">
        {snippet.text.slice(start, end)}
      </mark>,
    );
    at = Math.max(at, end);
  }
  if (at < snippet.text.length)
    parts.push(<Fragment key={`t${at}`}>{snippet.text.slice(at)}</Fragment>);
  return <span className={className}>{parts}</span>;
}

/**
 * Message hits grouped by chat, in the Bookmarks design language: an
 * avatar-led header per chat (not a link — the hits are), up to three hit
 * rows, then "+ n more in this chat" expanding the group in place.
 */
export function SearchHitList(p: Props): JSX.Element {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(p.initialExpanded ?? []),
  );

  function expand(key: string): void {
    const next = new Set(expanded).add(key);
    setExpanded(next);
    p.onExpandedChange?.([...next]);
  }

  return (
    <div className="flex flex-col gap-5">
      {p.groups.map((g) => {
        const persona = g.personaId ? p.personaById.get(g.personaId) : undefined;
        const open = expanded.has(g.key);
        const shown = open ? g.hits : g.hits.slice(0, HITS_PER_GROUP);
        const more = g.totalHits - shown.length;
        return (
          <section key={g.key} className="flex flex-col gap-1.5" data-search-group={g.key}>
            <header className="flex items-center gap-2 px-1">
              {persona ? (
                <PersonaAvatar
                  personaId={persona.id}
                  name={persona.name}
                  colour={persona.colour}
                  size={28}
                />
              ) : null}
              <h3
                className="truncate font-display text-sm"
                style={persona ? { color: persona.colour } : undefined}
              >
                {g.title}
              </h3>
            </header>

            {shown.map((h) => (
              <div className="cs-row" key={h.key} data-search-hit={h.key}>
                <button type="button" className="cs-row-main" onClick={() => p.onOpen(h, g)}>
                  <span className="cs-row-body gap-0.5">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-paper-soft">
                      {h.roleLabel} · {hitDateLabel(h.date)}
                    </span>
                    <SnippetText
                      snippet={h.snippet}
                      className="line-clamp-3 text-[13px] text-paper"
                    />
                  </span>
                </button>
              </div>
            ))}

            {more > 0 ? (
              <button
                type="button"
                className="self-start px-3 py-1 text-xs text-paper-soft"
                onClick={() => expand(g.key)}
              >
                + {more} more in this chat
              </button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
