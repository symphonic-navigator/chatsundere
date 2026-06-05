// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChats } from '../../data/chats.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { useFilteredPersonas } from '../../data/personas.js';
import { useProviders } from '../../data/providers.js';
import { useDisplayName, useSettings } from '../../data/settings.js';
import { APP_VERSION } from '../../lib/version.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';

interface RoomTileProps {
  label: string;
  icon: string;
  meta: string;
  to?: string;
  disabled?: boolean;
  tooltip?: string;
}

function RoomTile({ label, icon, meta, to, disabled, tooltip }: RoomTileProps) {
  const navigate = useNavigate();
  const interactive = !disabled && Boolean(to);
  // Non-null assertion suppressed: `to` is guaranteed non-undefined when `interactive` is true.
  // biome-ignore lint/style/noNonNullAssertion: to is defined whenever interactive is true
  const handleActivate = interactive ? () => navigate(to!) : undefined;
  return (
    // biome-ignore lint/a11y/useSemanticElements: spec requires div+role for disabled-stub tap targets — native disabled buttons are not tappable
    <div
      role="button"
      aria-disabled={disabled ? 'true' : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={tooltip}
      onClick={handleActivate}
      onKeyDown={
        handleActivate
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') handleActivate();
            }
          : undefined
      }
      className={`flex flex-col gap-1 rounded-lg border border-white/5 bg-white/[0.02] p-4 ${
        interactive ? 'cursor-pointer hover:bg-white/[0.04]' : 'opacity-40'
      }`}
    >
      <div className="text-lg text-paper-soft">{icon}</div>
      <div className="font-display text-sm text-paper">{label}</div>
      <div className="text-[11px] uppercase tracking-widest text-paper-soft">{meta}</div>
    </div>
  );
}

/** Landing surface for /app — greeting, optional continue-card, and six room tiles. */
export function EntranceHall(): JSX.Element {
  const navigate = useNavigate();
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

      {recentChat && recentPersona ? (
        <button
          type="button"
          className="rounded-2xl border border-paper-soft/30 bg-white/[0.04] p-4 text-left"
          onClick={() => navigate(`/app/chat/${recentChat.id}`)}
        >
          <div className="text-[10px] uppercase tracking-widest text-paper-soft">Continue chat</div>
          <div className="mt-1 font-display text-lg" style={{ color: recentPersona.colour }}>
            {recentChat.title ?? recentPersona.name}
          </div>
        </button>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <RoomTile label="My Circle" icon="✦" meta={`${personaCount} personas`} to="/app/circle" />
        <RoomTile
          label="My Projects"
          icon="◇"
          meta="Coming with Block 2+"
          disabled
          tooltip="Coming with Block 2+"
        />
        <RoomTile
          label="My History"
          icon="◯"
          meta={`${chats.data?.length ?? 0} chats`}
          to="/app/history"
        />
        <RoomTile
          label="My Treasury"
          icon="⬡"
          meta="Coming later"
          disabled
          tooltip="Coming later"
        />
        <RoomTile
          label="My Settings"
          icon="⚙"
          meta={`${providerCount} providers connected`}
          to="/app/settings"
        />
        <RoomTile label="My Account" icon="⌬" meta="Identity & auth" to="/app/account" />
      </div>

      <footer className="mt-auto pt-6 text-center text-[10px] uppercase tracking-widest text-paper-soft/40">
        v{APP_VERSION.version} · sha {APP_VERSION.sha}
      </footer>
    </section>
  );
}
