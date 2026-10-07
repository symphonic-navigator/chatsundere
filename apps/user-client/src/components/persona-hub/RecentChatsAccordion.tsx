// SPDX-License-Identifier: AGPL-3.0-only
import { ChevronRight } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChatRow } from '../../boot/client-data-db.js';
import { displayTitle } from '../../lib/chat-title.js';
import { relativeTimeLabel } from '../../lib/relative-time.js';

/** Device-local, persona-global open/closed state of the accordion. */
export const RECENT_CHATS_OPEN_KEY = 'chatsundere.hub.recentChatsOpen';

const LIMIT = 10;

function readOpen(): boolean {
  try {
    return localStorage.getItem(RECENT_CHATS_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(RECENT_CHATS_OPEN_KEY, open ? '1' : '0');
  } catch {
    // Storage unavailable (private mode, blocked site data) — in-memory only.
  }
}

interface Props {
  personaId: string;
  /** All chats, newest first (as `useChats()` returns them); `undefined` while loading. */
  chats: ChatRow[] | undefined;
  /** The hub's own path incl. search, so the History page's back returns here. */
  returnTo: string;
}

/**
 * "Recent chats" on the persona hub (spec §2): the ten newest chats of this
 * persona, filterable by title across all of them, with one link into the full
 * History page — `History →` while collapsed, `All in History →` at the list end.
 */
export function RecentChatsAccordion({ personaId, chats, returnTo }: Props): JSX.Element {
  const listId = useId();
  const [open, setOpen] = useState(readOpen);
  const [filter, setFilter] = useState('');

  const personaChats = useMemo(
    () => (chats ?? []).filter((c) => c.personaId === personaId),
    [chats, personaId],
  );
  const q = filter.trim();
  const matches = useMemo(() => {
    const needle = q.toLowerCase();
    const hits =
      needle === ''
        ? personaChats
        : personaChats.filter((c) => displayTitle(c).toLowerCase().includes(needle));
    return hits.slice(0, LIMIT);
  }, [personaChats, q]);

  // "No chats" only once loaded — loading must never flash the disabled state.
  const empty = chats !== undefined && personaChats.length === 0;

  const historyParams = new URLSearchParams({ personaId });
  if (q !== '') historyParams.set('q', q);
  historyParams.set('return', returnTo);
  const historyHref = `/app/history?${historyParams.toString()}`;

  function toggle(): void {
    const next = !open;
    setOpen(next);
    writeOpen(next);
    if (!next) setFilter('');
  }

  const expanded = open && !empty;

  return (
    <section className="rounded-card border border-white/5 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          disabled={empty}
          onClick={toggle}
          className="flex min-h-[44px] flex-1 items-center gap-1 text-left text-sm text-paper disabled:text-paper-soft/60"
        >
          <ChevronRight
            size={16}
            aria-hidden="true"
            className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
          Recent chats
        </button>
        {empty ? (
          <span className="text-xs text-paper-soft/70">No chats yet</span>
        ) : !expanded ? (
          <Link
            to={historyHref}
            className="inline-flex min-h-[44px] items-center px-2 text-xs text-paper-soft hover:text-paper"
          >
            History →
          </Link>
        ) : null}
      </div>

      {expanded ? (
        <div id={listId} className="mt-2 flex flex-col gap-2">
          <input
            type="search"
            aria-label="Filter chats"
            placeholder="Filter chats…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-soft"
          />
          {matches.length === 0 && q !== '' ? (
            <p className="px-1 text-xs text-paper-soft">{`No chats match "${q}"`}</p>
          ) : (
            <ul aria-label="Recent chats" className="flex flex-col">
              {matches.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/app/chat/${c.id}`}
                    className="flex min-h-[40px] items-center justify-between gap-3 px-1 text-sm text-paper hover:text-paper"
                  >
                    <span className="min-w-0 truncate">{displayTitle(c)}</span>
                    <span className="shrink-0 text-xs text-paper-soft">
                      {relativeTimeLabel(c.lastMessageAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Link
              to={historyHref}
              className="inline-flex min-h-[44px] items-center px-2 text-xs text-paper-soft hover:text-paper"
            >
              All in History →
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}
