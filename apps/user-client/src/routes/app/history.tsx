// apps/user-client/src/routes/app/history.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EditorTopbar } from '../../components/EditorTopbar.js';
import { HistoryRow } from '../../components/history/HistoryRow.js';
import { HistorySearchBar } from '../../components/history/HistorySearchBar.js';
import { PersonaFilterChips } from '../../components/history/PersonaFilterChips.js';
import { useChats, useDeleteChat, useUpdateChat } from '../../data/chats.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { useFilteredPersonas } from '../../data/personas.js';
import { useAdultMode, useSettings } from '../../data/settings.js';
import { displayTitle } from '../../lib/chat-title.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';

export function HistoryPage(): JSX.Element {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const chats = useChats();
  const personas = useFilteredPersonas();
  const { mode } = useAdultMode();
  const settings = useSettings();
  const mindspaces = useMindspaces();
  const setMindspace = useMindspaceStore((s) => s.update);
  const updateChat = useUpdateChat();
  const deleteChat = useDeleteChat();

  const initialPersonaId = search.get('personaId');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPersonaId, setFilterPersonaId] = useState<string | null>(initialPersonaId);

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
  // visible (e.g. NSFW → SFW flip while an NSFW persona was selected).
  useEffect(() => {
    if (!filterPersonaId || !personas.data) return;
    const stillVisible = personas.data.some((p) => p.id === filterPersonaId);
    if (!stillVisible) {
      setFilterPersonaId(null);
      const next = new URLSearchParams(search);
      next.delete('personaId');
      setSearch(next, { replace: true });
    }
    // `mode` is intentionally omitted — when mode flips, `personas.data` changes
    // (via useFilteredPersonas), which already re-triggers this effect.
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

  const visibleChats = useMemo(() => {
    const all = chats.data ?? [];
    const q = searchQuery.trim().toLowerCase();
    return all
      .filter((c) => visiblePersonaIds.has(c.personaId))
      .filter((c) => filterPersonaId === null || c.personaId === filterPersonaId)
      .filter((c) => q === '' || displayTitle(c).toLowerCase().includes(q));
  }, [chats.data, visiblePersonaIds, filterPersonaId, searchQuery]);

  const personaById = useMemo(() => {
    const m = new Map<string, NonNullable<typeof personas.data>[number]>();
    for (const p of personas.data ?? []) m.set(p.id, p);
    return m;
  }, [personas.data]);

  const filterPersonaName = filterPersonaId ? personaById.get(filterPersonaId)?.name : undefined;

  return (
    <section className="flex min-h-[80dvh] flex-col gap-3 px-4 pb-12 pt-4">
      <EditorTopbar
        title="My History"
        isDirty={false}
        onBack={() => navigate('/app')}
        onSaveAndBack={() => {}}
        hideSaveAndBack
      />
      <HistorySearchBar value={searchQuery} onChange={setSearchQuery} />
      <PersonaFilterChips
        personas={personas.data ?? []}
        selectedId={filterPersonaId}
        onChange={setFilterPersonaId}
      />

      {visibleChats.length === 0 ? (
        <EmptyState
          totalChats={(chats.data ?? []).length}
          filterPersonaId={filterPersonaId}
          filterPersonaName={filterPersonaName}
          searchActive={searchQuery.trim() !== ''}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {visibleChats.map((c) => {
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
          })}
        </ul>
      )}
    </section>
  );
}

function EmptyState({
  filterPersonaId,
  filterPersonaName,
  searchActive,
}: {
  totalChats: number;
  filterPersonaId: string | null;
  filterPersonaName?: string;
  searchActive: boolean;
}): JSX.Element {
  if (searchActive) {
    return (
      <div className="mt-8 grid place-items-center text-center text-paper-soft">
        <p className="font-display text-lg italic text-paper">No chats match your search.</p>
      </div>
    );
  }
  if (filterPersonaId && filterPersonaName) {
    return (
      <div className="mt-8 grid place-items-center text-center text-paper-soft">
        <p className="font-display text-lg italic text-paper">
          No chats with {filterPersonaName} yet.
        </p>
        <Link
          to={`/app/chat/new?personaId=${filterPersonaId}`}
          className="mt-2 rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper"
        >
          Start a new one
        </Link>
      </div>
    );
  }
  return (
    <div className="mt-8 grid place-items-center text-center text-paper-soft">
      <p className="font-display text-lg italic text-paper">No chats yet.</p>
      <p className="mt-2 max-w-xs text-sm">Pick a persona and</p>
      <Link
        to="/app/circle"
        className="mt-2 rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper"
      >
        Start a conversation
      </Link>
    </div>
  );
}
