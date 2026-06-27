// apps/user-client/src/routes/app/history.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BookmarksList } from '../../components/history/BookmarksList.js';
import { HistoryRow } from '../../components/history/HistoryRow.js';
import { HistorySearchBar } from '../../components/history/HistorySearchBar.js';
import { PersonaFilterDropdown } from '../../components/history/PersonaFilterDropdown.js';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { useHelp } from '../../content/help/use-help.js';
import { useBookmarks } from '../../data/bookmarks.js';
import { useChats, useDeleteChat, useUpdateChat } from '../../data/chats.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { useFilteredPersonas } from '../../data/personas.js';
import { useSettings } from '../../data/settings.js';
import { displayTitle } from '../../lib/chat-title.js';
import { historyCountLabel } from '../../lib/history-count.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';

export function HistoryPage(): JSX.Element {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const { onHelp, helpOverlay } = useHelp('history');
  const chats = useChats();
  const personas = useFilteredPersonas();
  const settings = useSettings();
  const mindspaces = useMindspaces();
  const setMindspace = useMindspaceStore((s) => s.update);
  const updateChat = useUpdateChat();
  const deleteChat = useDeleteChat();

  const initialPersonaId = search.get('personaId');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPersonaId, setFilterPersonaId] = useState<string | null>(initialPersonaId);
  const [tab, setTab] = useState<'chats' | 'bookmarks'>('chats');
  const bookmarks = useBookmarks();

  // Reset mindspace to user-default on mount — History is a neutral surface.
  useEffect(() => {
    if (!settings.data || !mindspaces.data) return;
    setMindspace({
      persona: null,
      defaultMindspaceId: settings.data.defaultMindspaceId,
      defaultTexture: settings.data.userTexture,
      mindspaces: mindspaces.data,
    });
  }, [settings.data, mindspaces.data, setMindspace]);

  // Auto-reset persona filter to All when the selected persona stops being
  // visible (e.g. NSFW → SFW flip while an NSFW persona was selected). When
  // `mode` flips, `personas.data` changes (via useFilteredPersonas), which
  // already re-triggers this effect.
  useEffect(() => {
    if (!filterPersonaId || !personas.data) return;
    const stillVisible = personas.data.some((p) => p.id === filterPersonaId);
    if (!stillVisible) {
      setFilterPersonaId(null);
      const next = new URLSearchParams(search);
      next.delete('personaId');
      setSearch(next, { replace: true });
    }
  }, [filterPersonaId, personas.data, search, setSearch]);

  // Mirror filterPersonaId state into the URL.
  useEffect(() => {
    const cur = search.get('personaId');
    if ((cur ?? null) === filterPersonaId) return;
    const next = new URLSearchParams(search);
    if (filterPersonaId) next.set('personaId', filterPersonaId);
    else next.delete('personaId');
    setSearch(next, { replace: true });
  }, [filterPersonaId, search, setSearch]);

  const visiblePersonaIds = useMemo(
    () => new Set((personas.data ?? []).map((p) => p.id)),
    [personas.data],
  );
  const personaById = useMemo(() => {
    const m = new Map<string, NonNullable<typeof personas.data>[number]>();
    for (const p of personas.data ?? []) m.set(p.id, p);
    return m;
  }, [personas.data]);

  // Chats visible after NSFW gating — the count's denominator.
  const gatedChats = useMemo(
    () => (chats.data ?? []).filter((c) => visiblePersonaIds.has(c.personaId)),
    [chats.data, visiblePersonaIds],
  );
  const visibleChats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return gatedChats
      .filter((c) => filterPersonaId === null || c.personaId === filterPersonaId)
      .filter((c) => q === '' || displayTitle(c).toLowerCase().includes(q));
  }, [gatedChats, filterPersonaId, searchQuery]);

  const filterPersonaName = filterPersonaId ? personaById.get(filterPersonaId)?.name : undefined;

  // Bookmarks filtered by the same persona selector + a label substring search,
  // NSFW-aware (groups whose persona is hidden in SFW mode drop out). Groups
  // with no surviving bookmarks after the label filter are removed.
  const visibleBookmarkGroups = useMemo(() => {
    const all = bookmarks.data ?? [];
    const q = searchQuery.trim().toLowerCase();
    return all
      .filter((g) => visiblePersonaIds.has(g.chat.personaId))
      .filter((g) => filterPersonaId === null || g.chat.personaId === filterPersonaId)
      .map((g) =>
        q === ''
          ? g
          : { ...g, bookmarks: g.bookmarks.filter((b) => b.label.toLowerCase().includes(q)) },
      )
      .filter((g) => g.bookmarks.length > 0);
  }, [bookmarks.data, visiblePersonaIds, filterPersonaId, searchQuery]);

  function clearFilter(): void {
    setFilterPersonaId(null);
    setSearchQuery('');
  }

  return (
    <PageScaffold
      crumbs={[{ label: 'My History' }]}
      back="/app"
      onHelp={onHelp}
      stickyHeader={
        <>
          <div className="cs-segmented" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'chats'}
              className="cs-seg"
              data-active={tab === 'chats' || undefined}
              onClick={() => setTab('chats')}
            >
              Chats
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'bookmarks'}
              className="cs-seg"
              data-active={tab === 'bookmarks' || undefined}
              onClick={() => setTab('bookmarks')}
            >
              Bookmarks
            </button>
          </div>

          <HistorySearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={tab === 'chats' ? 'Search chats by title…' : 'Search bookmarks by title…'}
          />
          <PersonaFilterDropdown
            personas={personas.data ?? []}
            selectedId={filterPersonaId}
            onChange={setFilterPersonaId}
          />
          {tab === 'chats' ? (
            <span className="text-[11px] uppercase tracking-widest text-paper-soft">
              {historyCountLabel(gatedChats.length, visibleChats.length)}
            </span>
          ) : null}
        </>
      }
    >
      {helpOverlay}
      <div className="flex min-h-[60dvh] flex-col gap-2 px-4 pb-12 pt-3">
        {tab === 'chats' ? (
          visibleChats.length === 0 ? (
            <ChatsEmptyState
              filterPersonaId={filterPersonaId}
              filterPersonaName={filterPersonaName}
              searchActive={searchQuery.trim() !== ''}
              onClearFilter={clearFilter}
            />
          ) : (
            visibleChats.map((c) => {
              const p = personaById.get(c.personaId);
              if (!p) return null;
              return (
                <HistoryRow
                  key={c.id}
                  chat={c}
                  persona={p}
                  onRename={(next) =>
                    void updateChat.mutateAsync({ id: c.id, patch: { title: next } })
                  }
                  onDelete={() => void deleteChat.mutateAsync(c.id)}
                />
              );
            })
          )
        ) : visibleBookmarkGroups.length === 0 ? (
          <div className="mt-8 grid place-items-center text-center text-paper-soft">
            <p className="font-display text-lg italic text-paper">
              {(bookmarks.data ?? []).length === 0
                ? 'No bookmarks yet.'
                : 'No bookmarks match your filter.'}
            </p>
            {(bookmarks.data ?? []).length === 0 ? (
              <p className="mt-2 max-w-xs text-sm">Star a message in any chat to find it here.</p>
            ) : (
              <button type="button" className="cs-btn mt-3" onClick={clearFilter}>
                Clear filter
              </button>
            )}
          </div>
        ) : (
          <BookmarksList
            groups={visibleBookmarkGroups}
            onJump={(chatId, messageId) => navigate(`/app/chat/${chatId}?focus=${messageId}`)}
          />
        )}
      </div>
    </PageScaffold>
  );
}

function ChatsEmptyState({
  filterPersonaId,
  filterPersonaName,
  searchActive,
  onClearFilter,
}: {
  filterPersonaId: string | null;
  filterPersonaName?: string;
  searchActive: boolean;
  onClearFilter: () => void;
}): JSX.Element {
  if (searchActive) {
    return (
      <div className="mt-8 grid place-items-center text-center text-paper-soft">
        <p className="font-display text-lg italic text-paper">No chats match your search.</p>
        <button type="button" className="cs-btn mt-3" onClick={onClearFilter}>
          Clear filter
        </button>
      </div>
    );
  }
  if (filterPersonaId && filterPersonaName) {
    return (
      <div className="mt-8 grid place-items-center text-center text-paper-soft">
        <p className="font-display text-lg italic text-paper">
          No chats with {filterPersonaName} yet.
        </p>
        <div className="mt-3 flex gap-2">
          <Link to={`/app/chat/new?personaId=${filterPersonaId}`} className="cs-btn">
            Start a new one
          </Link>
          <button type="button" className="cs-btn" onClick={onClearFilter}>
            Clear filter
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-8 grid place-items-center text-center text-paper-soft">
      <p className="font-display text-lg italic text-paper">No chats yet.</p>
      <p className="mt-2 max-w-xs text-sm">Pick a persona and</p>
      <Link to="/app/circle" className="cs-btn mt-2">
        Start a conversation
      </Link>
    </div>
  );
}
