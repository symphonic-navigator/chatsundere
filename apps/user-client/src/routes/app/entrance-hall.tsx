// SPDX-License-Identifier: AGPL-3.0-only

import {
  BookOpen,
  Clock,
  FolderKanban,
  Gem,
  Plug,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react';
import { useEffect } from 'react';
import { SetupCard, type SetupStep } from '../../components/SetupCard.js';
import { NavTile } from '../../components/ui/NavTile.js';
import { useAllArtefactCount } from '../../data/artefacts.js';
import { useChats } from '../../data/chats.js';
import { useFilteredLibraries } from '../../data/knowledge.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { useFilteredPersonas } from '../../data/personas.js';
import { useProviders } from '../../data/providers.js';
import { useDisplayName, useSettings } from '../../data/settings.js';
import { APP_VERSION } from '../../lib/version.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';

/** Landing surface for /app — greeting, optional continue-card, and eight room tiles in the fixed ascension order. */
export function EntranceHall(): JSX.Element {
  const displayName = useDisplayName();
  const settings = useSettings();
  const personas = useFilteredPersonas();
  const chats = useChats();
  const providers = useProviders();
  const mindspaces = useMindspaces();
  const setMindspace = useMindspaceStore((s) => s.update);

  useEffect(() => {
    if (settings.data && mindspaces.data) {
      setMindspace({
        persona: null,
        defaultMindspaceId: settings.data.defaultMindspaceId,
        defaultTexture: settings.data.userTexture,
        mindspaces: mindspaces.data,
      });
    }
  }, [settings.data, mindspaces.data, setMindspace]);

  const recentChat = (chats.data ?? [])[0];
  const recentPersona = recentChat
    ? personas.data?.find((p) => p.id === recentChat.personaId)
    : undefined;
  const personaCount = personas.data?.length ?? 0;
  const providerCount = (providers.data ?? []).filter((p) => p.enabled).length;

  const setupSteps: SetupStep[] = [];
  if (providerCount === 0) setupSteps.push({ label: 'Connect a provider', to: '/app/settings' });
  if (personaCount === 0)
    setupSteps.push({ label: 'Create your first companion', to: '/app/persona/new' });
  const needsSetup = setupSteps.length > 0;
  const artefactCount = useAllArtefactCount().data ?? 0;
  const libraryCount = useFilteredLibraries().data?.length ?? 0;

  return (
    <section className="flex min-h-[80dvh] flex-col gap-6 px-4 pb-12 pt-6">
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-[0.3em] text-paper-soft">Welcome back</div>
        <div
          className="mt-2 text-3xl font-display"
          style={{ color: 'var(--mindspace-text-primary)' }}
        >
          {displayName}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Crown — Setup card wins over Continue (spec §3.2) */}
        {needsSetup ? (
          <SetupCard steps={setupSteps} />
        ) : recentChat && recentPersona ? (
          <NavTile colour="pink" gold wide to={`/app/chat/${recentChat.id}`} label="Continue">
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-paper-soft">
              <Sparkles size={11} aria-hidden="true" /> Continue
            </span>
            <span className="cs-navtile-label" style={{ color: recentPersona.colour }}>
              {recentChat.title ?? recentPersona.name}
            </span>
          </NavTile>
        ) : null}

        {/* 🩷 Relate */}
        <NavTile
          colour="pink"
          icon={Users}
          label="My Circle"
          to="/app/circle"
          meta={personaCount === 0 ? 'no companions yet' : `${personaCount} personas`}
        />
        <NavTile
          colour="pink"
          icon={Clock}
          label="My History"
          to="/app/history"
          meta={(chats.data?.length ?? 0) === 0 ? 'no chats yet' : `${chats.data?.length} chats`}
        />

        {/* 🟢 Treasure */}
        <NavTile
          colour="green"
          icon={Gem}
          label="My Treasury"
          to="/app/treasury"
          meta={artefactCount === 0 ? 'empty' : `${artefactCount} artefacts`}
        />
        <NavTile
          colour="green"
          icon={FolderKanban}
          label="My Projects"
          disabled
          disabledReason="Coming after the alpha"
          meta="coming after the alpha"
        />

        {/* 🔵 Nourish */}
        <NavTile
          colour="blue"
          icon={BookOpen}
          label="My Knowledge"
          to="/app/knowledge"
          meta={libraryCount === 0 ? 'empty' : `${libraryCount} libraries`}
        />
        <NavTile
          colour="blue"
          icon={Plug}
          label="My Integrations"
          to="/app/integrations"
          meta="MCP servers"
        />

        {/* 🟣 Root */}
        <NavTile
          colour="purple"
          icon={SlidersHorizontal}
          label="My Settings"
          to="/app/settings"
          meta={providerCount === 0 ? 'no providers yet' : `${providerCount} providers connected`}
        />
        <NavTile
          colour="purple"
          icon={UserRound}
          label="My Account"
          to="/app/account"
          meta="identity & auth"
        />
      </div>

      <footer className="mt-auto pt-6 text-center text-[10px] uppercase tracking-widest text-paper-soft/40">
        v{APP_VERSION.version} · sha {APP_VERSION.sha}
      </footer>
    </section>
  );
}
