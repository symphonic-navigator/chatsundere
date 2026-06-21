// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { EditorTopbar } from '../../components/EditorTopbar.js';
import { PersonaCard } from '../../components/PersonaCard.js';
import { useChats } from '../../data/chats.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { compareByLastInteraction, useFilteredPersonas } from '../../data/personas.js';
import { useProviders } from '../../data/providers.js';
import { useSettings } from '../../data/settings.js';
import { resolveMindspace } from '../../state/mindspace-resolver.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';

/**
 * My Circle — lists the user's personas (filtered by current adult-mode)
 * and exposes a FAB to create a new one. Each card carries its own
 * resolved mindspace; the call site explicitly resolves it per card.
 *
 * Per spec §2 Decision 4 (no-leak): the empty-state copy is identical
 * whether the list is empty because no personas exist OR because all
 * personas are filtered out. Nothing in this surface hints at hidden
 * personas; the only indication is the AdultModeToggle pill in the
 * brand-bar.
 */
export function Circle(): JSX.Element {
  const navigate = useNavigate();
  const personas = useFilteredPersonas();
  const providers = useProviders();
  const mindspaces = useMindspaces();
  const settings = useSettings();
  const chats = useChats();
  const setMindspace = useMindspaceStore((s) => s.update);

  useEffect(() => {
    if (!mindspaces.data || !settings.data) return;
    // Circle owns the user-default mindspace context. Without this reset,
    // the Persona-Editor's mindspace would leak back when the user
    // navigates back from editing a persona.
    setMindspace({
      persona: null,
      defaultMindspaceId: settings.data.defaultMindspaceId,
      defaultTexture: settings.data.userTexture,
      mindspaces: mindspaces.data,
    });
  }, [mindspaces.data, settings.data, setMindspace]);

  const enabledProviderIds = new Set(
    (providers.data ?? []).filter((p) => p.enabled).map((p) => p.id),
  );

  const defaultMindspaceId = settings.data?.defaultMindspaceId ?? '';
  const defaultTexture = settings.data?.userTexture ?? null;

  // The chat list is ordered most-recently-active first, so the first row we
  // see for a persona is its most-recent chat — that's the one "Continue" resumes.
  const lastChatByPersona = new Map<string, string>();
  for (const c of chats.data ?? []) {
    if (!lastChatByPersona.has(c.personaId)) lastChatByPersona.set(c.personaId, c.id);
  }

  // Sort a copy by last interaction (most-recently-messaged first) for the Circle
  // display. The shared useFilteredPersonas ordering (createdAt asc) is preserved
  // for every other surface (Treasury, History, Entrance-Hall, Artefact-Picker).
  const sortedPersonas = (personas.data ?? []).slice().sort(compareByLastInteraction);

  return (
    <section className="flex min-h-[80dvh] flex-col gap-3 px-4 pb-24 pt-4">
      <EditorTopbar
        title="My Circle"
        isDirty={false}
        onBack={() => navigate('/app')}
        onSaveAndBack={() => {}}
        hideSaveAndBack
      />

      {personas.data && personas.data.length === 0 ? (
        <div className="mt-8 grid place-items-center text-center text-paper-soft">
          <p className="font-display text-lg italic text-paper">No personas yet</p>
          <p className="mt-2 max-w-xs text-sm">
            Tap the "+" button below to create your first companion.
          </p>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {sortedPersonas.map((p) => {
          const ms = resolveMindspace({
            persona: { mindspaceId: p.mindspaceId, textureOverride: p.textureOverride },
            defaultMindspaceId,
            defaultTexture,
            mindspaces: mindspaces.data ?? [],
          });
          if (!ms) return null;
          return (
            <PersonaCard
              key={p.id}
              persona={p}
              mindspace={ms}
              hasProvider={enabledProviderIds.has(p.providerId)}
              lastChatId={lastChatByPersona.get(p.id) ?? null}
              onChat={(personaId, lastChatId) => {
                navigate(
                  lastChatId ? `/app/chat/${lastChatId}` : `/app/chat/new?personaId=${personaId}`,
                );
              }}
            />
          );
        })}
      </ul>

      <button
        type="button"
        aria-label="New persona"
        onClick={() => navigate('/app/persona/new')}
        className="fixed bottom-6 right-6 z-10 grid h-14 w-14 place-items-center rounded-full bg-paper text-3xl leading-none text-ink shadow-2xl transition-transform hover:scale-105"
      >
        +
      </button>
    </section>
  );
}
