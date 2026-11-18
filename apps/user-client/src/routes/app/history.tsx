// apps/user-client/src/routes/app/history.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { type BookmarkListGroup, BookmarksList } from '../../components/history/BookmarksList.js';
import { HistoryRow } from '../../components/history/HistoryRow.js';
import { HistorySearchBar } from '../../components/history/HistorySearchBar.js';
import { PersonaFilterDropdown } from '../../components/history/PersonaFilterDropdown.js';
import { SearchHitList } from '../../components/history/SearchHitList.js';
import { useHistoryNavState } from '../../components/history/useHistoryNavState.js';
import { useMessageSearch } from '../../components/history/useMessageSearch.js';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { useHelp } from '../../content/help/use-help.js';
import { useBookmarks } from '../../data/bookmarks.js';
import { useChats, useDeleteChat, useUpdateChat } from '../../data/chats.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { useFilteredPersonas } from '../../data/personas.js';
import { useSettings } from '../../data/settings.js';
import { displayTitle } from '../../lib/chat-title.js';
import { historyCountLabel } from '../../lib/history-count.js';
import {
  getSearchCache,
  getSearchCacheView,
  rememberHistoryReturn,
  setSearchCacheView,
} from '../../lib/history-return.js';
import { safeReturnPath } from '../../lib/safe-return.js';
import { fold, queryWords } from '../../lib/search/fold.js';
import { toHitGroups } from '../../lib/search/hit-groups.js';
import { displayedText, matchMessage } from '../../lib/search/message-snippet.js';
import { MESSAGE_HIT_CAP, type ScanChat } from '../../lib/search/scan-messages.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';

/** Title matches shown while the messages section is on screen, before "Show all". */
const TITLE_PREVIEW = 5;
/** Keys that scroll the page when focus is not in a text field. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

type Tab = 'chats' | 'bookmarks';

export function HistoryPage(): JSX.Element {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const nav = useHistoryNavState();
  const { onHelp, helpOverlay } = useHelp('history');
  const chats = useChats();
  const personas = useFilteredPersonas();
  const settings = useSettings();
  const mindspaces = useMindspaces();
  const setMindspace = useMindspaceStore((s) => s.update);
  const updateChat = useUpdateChat();
  const deleteChat = useDeleteChat();

  const initialPersonaId = search.get('personaId');
  const searchQuery = nav.q;
  const setSearchQuery = nav.setQ;
  const backPath = safeReturnPath(search.get('return'), '/app');
  const [filterPersonaId, setFilterPersonaId] = useState<string | null>(initialPersonaId);
  const tab: Tab = search.get('tab') === 'bookmarks' ? 'bookmarks' : 'chats';
  const bookmarks = useBookmarks();
  const [titlesExpandedFor, setTitlesExpandedFor] = useState<string | null>(null);

  function setTab(next: Tab): void {
    if (next === tab) return;
    const params = new URLSearchParams(search);
    if (next === 'bookmarks') params.set('tab', 'bookmarks');
    else params.delete('tab');
    setSearch(params, { replace: true });
  }

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
  const filteredChats = useMemo(
    () => gatedChats.filter((c) => filterPersonaId === null || c.personaId === filterPersonaId),
    [gatedChats, filterPersonaId],
  );
  // Titles match by the same rule as messages and bookmarks: folded, every
  // word, in any order.
  const visibleChats = useMemo(() => {
    const words = queryWords(searchQuery);
    if (words.length === 0) return filteredChats;
    return filteredChats.filter((c) => {
      const title = fold(displayTitle(c));
      return words.every((w) => title.includes(w));
    });
  }, [filteredChats, searchQuery]);

  // The scan's work list: gated before anything is read (spec §6), newest first.
  const scanChats = useMemo<ScanChat[]>(
    () =>
      [...filteredChats]
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
        .map((c) => ({ id: c.id, personaId: c.personaId, title: displayTitle(c) })),
    [filteredChats],
  );
  const messageSearch = useMessageSearch({
    query: tab === 'chats' ? searchQuery : '',
    chats: scanChats,
    personaFilter: filterPersonaId,
    visiblePersonaIds,
    enabled: chats.data !== undefined && personas.data !== undefined,
  });
  const liveChatsById = useMemo(
    () => new Map(filteredChats.map((c) => [c.id, c])),
    [filteredChats],
  );
  const hitGroups = useMemo(
    () => toHitGroups(messageSearch.hits, liveChatsById, personaById),
    [messageSearch.hits, liveChatsById, personaById],
  );
  const hitCount = hitGroups.reduce((n, g) => n + g.totalHits, 0);
  const messagesShown = messageSearch.status === 'scanning' || messageSearch.status === 'done';

  const filterPersonaName = filterPersonaId ? personaById.get(filterPersonaId)?.name : undefined;

  // Bookmarks filtered by the same persona selector, NSFW-aware (groups whose
  // persona is hidden in SFW mode drop out). A bookmark matches on its label or
  // on its message text (spec §4.1); a text-only match carries a snippet.
  const visibleBookmarkGroups = useMemo<BookmarkListGroup[]>(() => {
    const all = bookmarks.data ?? [];
    const words = queryWords(searchQuery);
    return all
      .filter((g) => visiblePersonaIds.has(g.chat.personaId))
      .filter((g) => filterPersonaId === null || g.chat.personaId === filterPersonaId)
      .map((g) => {
        if (words.length === 0) return g;
        const matched = g.bookmarks.flatMap((b) => {
          const label = fold(b.label);
          if (words.every((w) => label.includes(w))) return [b];
          const snippet = matchMessage(displayedText(b.message.contentBlocks), words);
          return snippet ? [{ ...b, snippet }] : [];
        });
        return { ...g, bookmarks: matched };
      })
      .filter((g) => g.bookmarks.length > 0);
  }, [bookmarks.data, visiblePersonaIds, filterPersonaId, searchQuery]);

  const cacheKey = messageSearch.cacheKey;
  // What was expanded comes back with the held search, so the first render
  // already has the layout the scroll offset was measured against.
  const cacheView = cacheKey !== null ? getSearchCacheView(cacheKey) : null;

  // Scroll comes back once, when the list it was measured against has rendered:
  // the titles from the Query cache and, during a message search, the held hits
  // (a held search with no hits yet is measured against the titles alone).
  const restoredRef = useRef(false);
  const userScrolledRef = useRef(false);
  const heldSearch = cacheKey !== null && getSearchCache(cacheKey) !== null;
  const listReady =
    chats.data !== undefined &&
    personas.data !== undefined &&
    (tab === 'bookmarks'
      ? bookmarks.data !== undefined
      : messageSearch.status !== 'scanning' || messageSearch.hits.length > 0 || heldSearch);
  useEffect(() => {
    if (restoredRef.current || !listReady) return;
    restoredRef.current = true;
    if (nav.scrollY !== null && !userScrolledRef.current) window.scrollTo(0, nav.scrollY);
  }, [listReady, nav.scrollY]);

  // Once the person has scrolled, their position wins over the restore. Scroll
  // events are watched from the first frame on, so one the browser still had
  // pending from the previous page is not taken for theirs.
  useEffect(() => {
    const mark = (): void => {
      userScrolledRef.current = true;
    };
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (SCROLL_KEYS.has(e.key)) mark();
    };
    const onScroll = (): void => {
      if (!restoredRef.current) mark();
    };
    window.addEventListener('wheel', mark, { passive: true });
    window.addEventListener('touchmove', mark, { passive: true });
    window.addEventListener('keydown', onKey);
    const raf = typeof requestAnimationFrame === 'function';
    const handle = raf
      ? requestAnimationFrame(() => window.addEventListener('scroll', onScroll, { passive: true }))
      : setTimeout(() => window.addEventListener('scroll', onScroll, { passive: true }), 0);
    return () => {
      if (raf) cancelAnimationFrame(handle as number);
      else clearTimeout(handle as ReturnType<typeof setTimeout>);
      window.removeEventListener('wheel', mark);
      window.removeEventListener('touchmove', mark);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  function openFromSearch(chatId: string, href: string): void {
    rememberHistoryReturn(nav.saveScroll(), chatId);
    navigate(href);
  }

  function clearFilter(): void {
    setFilterPersonaId(null);
    setSearchQuery('');
  }

  const trimmedQuery = searchQuery.trim();
  const titlesExpanded = titlesExpandedFor === trimmedQuery || (cacheView?.titlesExpanded ?? false);

  function expandTitles(): void {
    setTitlesExpandedFor(trimmedQuery);
    if (cacheKey !== null) setSearchCacheView(cacheKey, { titlesExpanded: true });
  }
  const shownTitles =
    messagesShown && !titlesExpanded ? visibleChats.slice(0, TITLE_PREVIEW) : visibleChats;

  const titleRows = shownTitles.map((c) => {
    const p = personaById.get(c.personaId);
    if (!p) return null;
    return (
      <HistoryRow
        key={c.id}
        chat={c}
        persona={p}
        onOpen={() => {
          const loc = nav.saveScroll();
          // With a query, the way back keeps the search, as from a message hit.
          if (trimmedQuery !== '') rememberHistoryReturn(loc, c.id);
        }}
        onRename={(next) => void updateChat.mutateAsync({ id: c.id, patch: { title: next } })}
        onDelete={() => void deleteChat.mutateAsync(c.id)}
      />
    );
  });

  function chatsTab(): JSX.Element | (JSX.Element | null)[] {
    if (!messagesShown) {
      const list =
        visibleChats.length === 0 ? (
          <ChatsEmptyState
            filterPersonaId={filterPersonaId}
            filterPersonaName={filterPersonaName}
            searchActive={trimmedQuery !== ''}
            shortQuery={messageSearch.status === 'short'}
            onClearFilter={clearFilter}
          />
        ) : (
          titleRows
        );
      if (messageSearch.status !== 'short') return list;
      return (
        <>
          {list}
          <p className="mt-4 px-1 text-sm italic text-paper-soft" data-search-hint>
            Type one more letter to search inside messages.
          </p>
        </>
      );
    }

    if (messageSearch.status === 'done' && visibleChats.length === 0 && hitGroups.length === 0) {
      return (
        <div className="mt-8 grid place-items-center text-center text-paper-soft">
          <p className="font-display text-lg italic text-paper">
            {`Nothing in your history matches "${trimmedQuery}".`}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button type="button" className="cs-btn" onClick={() => setSearchQuery('')}>
              Clear search
            </button>
            {filterPersonaId ? (
              <button type="button" className="cs-btn" onClick={() => setFilterPersonaId(null)}>
                Search all personas
              </button>
            ) : null}
          </div>
        </div>
      );
    }

    const progress = messageSearch.progress;
    return (
      <>
        {visibleChats.length > 0 ? (
          <section className="flex flex-col gap-2" data-section="titles">
            <h2 className="cs-search-section-head">
              <span>Chat titles · {visibleChats.length}</span>
            </h2>
            {titleRows}
            {visibleChats.length > shownTitles.length ? (
              <button
                type="button"
                className="self-start px-3 py-1 text-xs text-paper-soft"
                onClick={expandTitles}
              >
                Show all {visibleChats.length} chats
              </button>
            ) : null}
          </section>
        ) : null}

        <section
          className={`flex flex-col gap-2 ${visibleChats.length > 0 ? 'mt-4' : ''}`}
          data-section="messages"
        >
          <h2 className="cs-search-section-head">
            <span>
              In messages
              {hitCount > 0 ? ` · ${messageSearch.capped ? `${hitCount}+` : hitCount}` : ''}
            </span>
            {messageSearch.status === 'scanning' ? (
              <span className="cs-search-progress" aria-live="polite">
                searching {progress?.scannedChats ?? 0} / {progress?.totalChats ?? scanChats.length}{' '}
                chats
              </span>
            ) : null}
          </h2>
          {hitGroups.length > 0 ? (
            <SearchHitList
              key={cacheKey ?? ''}
              groups={hitGroups}
              initialExpanded={cacheView?.expandedGroups}
              onExpandedChange={(chatIds) => {
                if (cacheKey !== null) setSearchCacheView(cacheKey, { expandedGroups: chatIds });
              }}
              personaById={personaById}
              onOpen={(hit, group) => openFromSearch(group.key, hit.href)}
            />
          ) : messageSearch.status === 'done' ? (
            <p className="px-1 text-sm italic text-paper-soft">
              {`No messages contain "${trimmedQuery}".`}
            </p>
          ) : null}
          {messageSearch.capped ? (
            <p className="px-1 text-xs text-paper-soft">
              Showing the first {MESSAGE_HIT_CAP} matches. Add a word to narrow it down.
            </p>
          ) : null}
        </section>
      </>
    );
  }

  return (
    <PageScaffold
      crumbs={[{ label: 'My History' }]}
      back={backPath}
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
            placeholder={tab === 'chats' ? 'Search titles and messages…' : 'Search bookmarks…'}
          />
          <PersonaFilterDropdown
            personas={personas.data ?? []}
            selectedId={filterPersonaId}
            onChange={setFilterPersonaId}
          />
          {tab === 'chats' && !messagesShown ? (
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
          chatsTab()
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
            onJump={(chatId, messageId) =>
              openFromSearch(chatId, `/app/chat/${chatId}?focus=${messageId}`)
            }
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
  shortQuery,
  onClearFilter,
}: {
  filterPersonaId: string | null;
  filterPersonaName?: string;
  searchActive: boolean;
  /** A one-letter query: the hint below asks for more, so the button names the search. */
  shortQuery: boolean;
  onClearFilter: () => void;
}): JSX.Element {
  if (searchActive) {
    return (
      <div className="mt-8 grid place-items-center text-center text-paper-soft">
        <p className="font-display text-lg italic text-paper">No chats match your search.</p>
        <button type="button" className="cs-btn mt-3" onClick={onClearFilter}>
          {shortQuery ? 'Clear search' : 'Clear filter'}
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
