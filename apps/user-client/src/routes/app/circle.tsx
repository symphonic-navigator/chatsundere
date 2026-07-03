// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PersonaRow } from '../../boot/client-data-db.js';
import { PersonaAvatar } from '../../components/PersonaAvatar.js';
import { StreamingOrb } from '../../components/StreamingOrb.js';
import { Badge } from '../../components/ui/Badge.js';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js';
import { type OverflowEntry, OverflowMenu } from '../../components/ui/OverflowMenu.js';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { useHelp } from '../../content/help/use-help.js';
import { useChats } from '../../data/chats.js';
import { useMindspaces } from '../../data/mindspaces.js';
import {
  compareByLastInteraction,
  useDeletePersona,
  useFilteredPersonas,
} from '../../data/personas.js';
import { useProviders } from '../../data/providers.js';
import { useSettings } from '../../data/settings.js';
import { FONT_VAR } from '../../lib/persona-font.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';
import { useClass2Gate } from '../../sync/gate.js';

/**
 * My Circle — lists the user's personas (filtered by current adult-mode)
 * as a cs-row list. Each row carries a Continue/New Chat button and an
 * overflow menu with further actions.
 *
 * Per spec §2 Decision 4 (no-leak): the empty-state copy is identical
 * whether the list is empty because no personas exist OR because all
 * personas are filtered out. Nothing in this surface hints at hidden
 * personas; the only indication is the AdultModeToggle pill in the
 * brand-bar.
 */
export function Circle(): JSX.Element {
  const navigate = useNavigate();
  const { onHelp, helpOverlay } = useHelp('circle');
  const personas = useFilteredPersonas();
  const providers = useProviders();
  const mindspaces = useMindspaces();
  const settings = useSettings();
  const chats = useChats();
  const setMindspace = useMindspaceStore((s) => s.update);
  const deletePersona = useDeletePersona();
  const [confirmDelete, setConfirmDelete] = useState<PersonaRow | null>(null);
  // Deleting a persona is a Class-2 delete (spec §11.2) — disabled offline for a
  // linked account; local-only users are never gated.
  const class2 = useClass2Gate();

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
    <PageScaffold crumbs={[{ label: 'My Circle' }]} back="/app" onHelp={onHelp}>
      {helpOverlay}
      <div className="flex flex-col gap-2 px-4 pb-12 pt-3" data-testid="my-circle">
        <button
          type="button"
          aria-label="New persona"
          onClick={() => navigate('/app/persona/new')}
          className="cs-btn text-ink self-start"
        >
          + New persona
        </button>

        {personas.data && personas.data.length === 0 ? (
          <div className="mt-8 grid place-items-center text-center text-paper-soft">
            <p className="font-display text-lg italic text-paper">No personas yet</p>
            <p className="mt-2 max-w-xs text-sm">
              Use the "+ New persona" button above to create your first companion.
            </p>
          </div>
        ) : null}

        {sortedPersonas.map((p) => {
          const lastChatId = lastChatByPersona.get(p.id) ?? null;
          const hasProvider = enabledProviderIds.has(p.providerId);

          const overflow: OverflowEntry[] = [
            {
              label: 'New chat',
              onSelect: () => navigate(`/app/chat/new?personaId=${p.id}`),
            },
            {
              label: 'New incognito chat',
              disabled: true,
              disabledReason: 'Coming soon — a chat that leaves nothing in memory',
            },
            {
              label: 'Continue',
              disabled: !lastChatId,
              onSelect: () => {
                if (lastChatId) navigate(`/app/chat/${lastChatId}`);
              },
            },
            { separator: true },
            {
              label: 'Go to persona',
              onSelect: () => navigate(`/app/persona/${p.id}`),
            },
            {
              label: 'Delete…',
              tone: 'destructive',
              onSelect: () => setConfirmDelete(p),
              disabled: class2.disabled,
              disabledReason: class2.tooltip ?? undefined,
            },
          ];

          return (
            <div key={p.id} className="cs-row" data-circle-row={p.id}>
              <button
                type="button"
                className="cs-row-main"
                onClick={() => navigate(`/app/persona/${p.id}`)}
              >
                <span className="cs-row-leading">
                  <span className="history-avatar">
                    <PersonaAvatar personaId={p.id} name={p.name} colour={p.colour} size={40} />
                    <StreamingOrb personaId={p.id} colour={p.colour} />
                  </span>
                </span>
                <span className="cs-row-body">
                  <span
                    className="cs-row-title"
                    style={{ color: p.colour, fontFamily: FONT_VAR[p.font] }}
                  >
                    {p.name}
                  </span>
                  <span className="cs-row-subtitle">
                    {p.tagline || p.instructions.slice(0, 60)}
                  </span>
                </span>
              </button>
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: non-interactive wrapper that only stops bubbling; its children carry the semantics */}
              <span className="cs-row-trailing" onClick={(e) => e.stopPropagation()}>
                {p.adultPersona ? <Badge tone="danger">NSFW</Badge> : null}
                {!hasProvider ? (
                  <button
                    type="button"
                    className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-danger"
                    onClick={() => navigate('/app/settings/providers')}
                  >
                    Provider missing
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={!hasProvider}
                  className="rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper hover:border-paper disabled:opacity-40"
                  onClick={() =>
                    navigate(
                      lastChatId ? `/app/chat/${lastChatId}` : `/app/chat/new?personaId=${p.id}`,
                    )
                  }
                >
                  {lastChatId ? 'Continue' : 'New Chat'}
                </button>
                <OverflowMenu items={overflow} />
              </span>
            </div>
          );
        })}

        <ConfirmDialog
          open={confirmDelete !== null}
          title={`Delete ${confirmDelete?.name ?? ''}?`}
          body="All chats with this persona will be lost."
          confirmLabel="Delete"
          destructive
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            if (confirmDelete) {
              await deletePersona.mutateAsync(confirmDelete.id);
              setConfirmDelete(null);
            }
          }}
        />
      </div>
    </PageScaffold>
  );
}
