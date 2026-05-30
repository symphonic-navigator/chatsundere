// SPDX-License-Identifier: AGPL-3.0-only

import { getCanonical, getProvider, listCanonicals, listOfferings } from '@chatsundere/llm-unified';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type {
  MindspaceRow,
  PersonaRow,
  ProviderRow,
  SettingsRow,
} from '../../boot/client-data-db.js';
import { AccordionCard } from '../../components/AccordionCard.js';
import { AutoSizeTextarea } from '../../components/AutoSizeTextarea.js';
import { EditorSticky } from '../../components/EditorSticky.js';
import { EditorTopbar } from '../../components/EditorTopbar.js';
import { MindspacePicker } from '../../components/MindspacePicker.js';
import { useChats } from '../../data/chats.js';
import { useMindspaces } from '../../data/mindspaces.js';
import {
  useCreatePersona,
  useDeletePersona,
  usePersona,
  useUpdatePersona,
} from '../../data/personas.js';
import { useProviders } from '../../data/providers.js';
import { useSettings } from '../../data/settings.js';
import { FONT_VAR } from '../../lib/persona-font.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';

type DraftPersona = Omit<PersonaRow, 'id' | 'createdAt' | 'updatedAt'>;

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function defaultDraft(
  settings: SettingsRow | undefined,
  mindspaces: MindspaceRow[] | undefined,
  providers: ProviderRow[] | undefined,
): DraftPersona {
  const defaultMindspace = mindspaces?.find((m) => m.id === settings?.defaultMindspaceId);
  const firstEnabled = providers?.find((p) => p.enabled);
  return {
    name: '',
    tagline: '',
    colour: defaultMindspace?.palette.accent ?? '#c9a84c',
    font: 'serif',
    instructions: '',
    canonicalId: null,
    providerId: firstEnabled?.id ?? '',
    modelId: '',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
  };
}

/** Route component for creating and editing a persona. */
export function PersonaEditor(): JSX.Element {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const isCreate = !id || id === 'new';

  // Caller may pass ?return=<path> so back / Save & Back land somewhere
  // other than /app/circle (used by the Interaction-Topbar's persona-name
  // click so it returns to the chat). Fallback to /app/circle.
  const returnPath = search.get('return') || '/app/circle';

  const persona = usePersona(isCreate ? null : (id ?? null));
  const settings = useSettings();
  const mindspaces = useMindspaces();
  const providers = useProviders();
  const chats = useChats();
  const create = useCreatePersona();
  const update = useUpdatePersona();
  const del = useDeletePersona();

  const seedDraft = useMemo(
    () => defaultDraft(settings.data, mindspaces.data, providers.data),
    [settings.data, mindspaces.data, providers.data],
  );
  const [draft, setDraft] = useState<DraftPersona>(seedDraft);
  // Tracks whether the user has made any edit in this session. Once true,
  // the create-mode seed effect will no longer overwrite user changes.
  const userModifiedRef = useRef(false);

  useEffect(() => {
    if (!isCreate && persona.data) {
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = persona.data;
      setDraft(rest);
    } else if (isCreate && !userModifiedRef.current) {
      // Keep updating from seed until the user makes their first edit. This
      // lets later-loaded data (e.g. the default mindspace accent colour)
      // propagate into the draft while it is still pristine.
      setDraft(seedDraft);
    }
  }, [isCreate, persona.data, seedDraft]);

  const [isDirty, setIsDirty] = useState(false);
  const setMindspace = useMindspaceStore((s) => s.update);

  useEffect(() => {
    if (!mindspaces.data || !settings.data) return;
    setMindspace({
      persona: { mindspaceId: draft.mindspaceId, textureOverride: draft.textureOverride },
      defaultMindspaceId: settings.data.defaultMindspaceId,
      defaultTexture: settings.data.userTexture,
      mindspaces: mindspaces.data,
    });
  }, [draft.mindspaceId, draft.textureOverride, mindspaces.data, settings.data, setMindspace]);

  function patch(p: Partial<DraftPersona>) {
    userModifiedRef.current = true;
    setIsDirty(true);
    setDraft((d) => ({ ...d, ...p }));
  }

  // Dynamic accordion metas
  const selectedCanonical = draft.canonicalId ? getCanonical(draft.canonicalId) : undefined;
  const selectedProvider = providers.data?.find((p) => p.id === draft.providerId);
  const modelMeta: ReactNode =
    selectedCanonical && selectedProvider
      ? `${selectedCanonical.displayName} · via ${getProvider(selectedProvider.templateId)?.displayName ?? selectedProvider.templateId}`
      : 'Pick a model';

  const behaviourMeta: ReactNode = (
    <span>
      Temperature
      {draft.adultPersona ? (
        <>
          {' · '}
          <span
            data-nsfw-badge
            className="rounded-full border border-danger/50 bg-danger/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-danger"
          >
            NSFW
          </span>
        </>
      ) : null}
    </span>
  );

  const selectedMs = draft.mindspaceId
    ? mindspaces.data?.find((m) => m.id === draft.mindspaceId)
    : null;
  const mindspaceMeta: ReactNode =
    draft.mindspaceId && selectedMs
      ? `${selectedMs.displayName} · ${draft.textureOverride ?? selectedMs.texture}`
      : 'Using user default';

  async function persistDraft() {
    if (isCreate) {
      await create.mutateAsync(draft);
    } else if (id) {
      await update.mutateAsync({ id, patch: draft });
    }
    setIsDirty(false);
  }

  async function onSaveAndBack() {
    await persistDraft();
    navigate(returnPath);
  }

  const personaInvalid =
    !draft.name || !draft.instructions || !draft.canonicalId || !draft.providerId || !draft.modelId;

  // Most recent chat for this persona, if any. `useChats` returns rows sorted
  // by `lastMessageAt` descending, so `find` picks the freshest.
  const recentChatForThisPersona =
    !isCreate && id ? (chats.data?.find((c) => c.personaId === id) ?? null) : null;

  async function onContinue() {
    if (!recentChatForThisPersona || personaInvalid) return;
    if (isDirty) await persistDraft();
    navigate(`/app/chat/${recentChatForThisPersona.id}`);
  }

  async function onNewChat() {
    if (!id || personaInvalid) return;
    if (isDirty) await persistDraft();
    navigate(`/app/chat/new?personaId=${id}`);
  }

  function continueTooltip(): string | undefined {
    if (personaInvalid) return 'Finish setting up the persona first';
    if (!recentChatForThisPersona) return 'No chat with this persona yet — start a New Chat';
    return undefined;
  }

  // Live-preview the chosen font + accent on the topbar title so changes in
  // Font and Voice / Mindspace are visually reflected immediately. We apply
  // this in edit-mode only — in create-mode the title is a placeholder
  // ("New Persona") that benefits less from persona-specific styling.
  const titleStyle = !isCreate
    ? { fontFamily: FONT_VAR[draft.font], color: draft.colour }
    : undefined;

  return (
    <section className="flex flex-col gap-3 px-4 pb-8 pt-4">
      <EditorSticky>
        <EditorTopbar
          title={isCreate ? 'New Persona' : draft.name || 'Edit Persona'}
          titleStyle={titleStyle}
          isDirty={isDirty}
          onBack={() => navigate(returnPath)}
          onSaveAndBack={() => {
            void onSaveAndBack();
          }}
          saveDisabled={
            !draft.name ||
            !draft.instructions ||
            !draft.canonicalId ||
            !draft.providerId ||
            !draft.modelId
          }
          saveTooltip={
            !draft.canonicalId
              ? 'Pick a model'
              : !draft.providerId || !draft.modelId
                ? 'Choose a deployment (or add its provider in Settings)'
                : 'Fill in name and instructions'
          }
        />

        {!isCreate ? (
          <div className="mt-2 grid grid-cols-2 gap-2" data-quick-actions>
            <button
              type="button"
              disabled={!recentChatForThisPersona || personaInvalid}
              title={continueTooltip()}
              onClick={() => {
                void onContinue();
              }}
              className="rounded-md border border-paper-soft/30 bg-white/[0.02] px-3 py-2 text-xs uppercase tracking-wider text-paper disabled:text-paper-soft/40"
            >
              Continue
            </button>
            <button
              type="button"
              disabled={personaInvalid}
              title={personaInvalid ? 'Finish setting up the persona first' : undefined}
              onClick={() => {
                void onNewChat();
              }}
              className="rounded-md border border-paper-soft/30 bg-white/[0.02] px-3 py-2 text-xs uppercase tracking-wider text-paper disabled:text-paper-soft/40"
            >
              New Chat
            </button>
            <button
              type="button"
              disabled
              title="Coming with Block 3 memory system"
              className="rounded-md border border-paper-soft/30 bg-white/[0.02] px-3 py-2 text-xs uppercase tracking-wider text-paper disabled:text-paper-soft/40"
            >
              Incognito
            </button>
            <button
              type="button"
              disabled={!recentChatForThisPersona}
              title={!recentChatForThisPersona ? 'No chats with this persona yet' : undefined}
              onClick={async () => {
                if (isDirty) await persistDraft();
                if (id) navigate(`/app/history?personaId=${id}`);
              }}
              className="rounded-md border border-paper-soft/30 bg-white/[0.02] px-3 py-2 text-xs uppercase tracking-wider text-paper disabled:text-paper-soft/40"
            >
              History
            </button>
          </div>
        ) : null}
      </EditorSticky>

      {/* Identity — always visible, outside the accordion */}
      <section className="rounded-card border border-white/5 bg-white/[0.02] p-3">
        <header className="mb-2 text-xs uppercase tracking-widest text-paper-soft">Identity</header>
        <div className="mb-2 flex items-center gap-2">
          <label
            className="text-xs uppercase tracking-widest text-paper-soft"
            htmlFor="persona-name"
          >
            Name
          </label>
          {!draft.name ? (
            <span aria-label="Name is required" className="text-danger" data-required-marker>
              ✕
            </span>
          ) : null}
        </div>
        <input
          id="persona-name"
          type="text"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          className="mb-3 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-soft"
        />
        <label
          className="mb-2 block text-xs uppercase tracking-widest text-paper-soft"
          htmlFor="persona-tagline"
        >
          Tagline
        </label>
        <input
          id="persona-tagline"
          type="text"
          value={draft.tagline}
          onChange={(e) => patch({ tagline: e.target.value })}
          className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-soft"
        />
      </section>

      {/* ❶ Custom Instructions */}
      <AccordionCard
        icon="≣"
        label="Custom Instructions"
        meta="Who this persona is"
        requiredMarker={!draft.instructions}
      >
        <AutoSizeTextarea
          aria-label="Custom instructions"
          minRows={5}
          maxRows={30}
          value={draft.instructions}
          onChange={(v) => patch({ instructions: v })}
        />
      </AccordionCard>

      {/* ❷ Model */}
      <AccordionCard
        icon="⬡"
        label="Model"
        meta={modelMeta}
        requiredMarker={!draft.canonicalId || !draft.providerId || !draft.modelId}
      >
        <ModelList
          providers={providers.data ?? []}
          selectedCanonicalId={draft.canonicalId}
          selectedProviderId={draft.providerId}
          selectedModelId={draft.modelId}
          onSelect={(canonicalId, providerId, modelId) =>
            patch({ canonicalId, providerId, modelId })
          }
        />
      </AccordionCard>

      {/* ❸ Behavior */}
      <AccordionCard icon="∿" label="Behavior" meta={behaviourMeta}>
        <label
          htmlFor="persona-temperature"
          className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
        >
          Temperature
        </label>
        <div className="flex items-center gap-3">
          <input
            id="persona-temperature"
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={draft.temperature}
            onChange={(e) => patch({ temperature: Number(e.target.value) })}
            className="flex-1"
          />
          <span className="w-12 text-center font-mono text-sm text-paper">
            {draft.temperature.toFixed(2)}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-paper-soft">
          Default 0.85 · range 0.00 – 2.00 in 0.05 steps. Higher = more creative chaos.
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-paper">Adult Persona</div>
            <p className="text-[11px] text-paper-soft">
              Hidden when sanitized mode is active. Adult content is governed by the system prompt
              or custom instructions, not this flag.
            </p>
          </div>
          <button
            type="button"
            aria-pressed={draft.adultPersona}
            onClick={() => patch({ adultPersona: !draft.adultPersona })}
            className={`h-6 w-12 shrink-0 rounded-full border ${
              draft.adultPersona ? 'border-paper bg-paper/30' : 'border-paper-soft/30 bg-white/5'
            }`}
          >
            <span
              className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
                draft.adultPersona ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </AccordionCard>

      {/* ❹ Font and Voice */}
      <AccordionCard icon="ℑ" label="Font and Voice" meta={`Voice · ${capitalise(draft.font)}`}>
        <div className="mb-2 text-xs uppercase tracking-widest text-paper-soft">Font</div>
        <div className="flex flex-wrap gap-2">
          {(['sans', 'serif', 'cursive'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => patch({ font: f })}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wider ${
                draft.font === f
                  ? 'border-paper text-paper'
                  : 'border-paper-soft/40 text-paper-soft'
              } ${
                f === 'sans' ? 'font-sans' : f === 'serif' ? 'font-display' : 'italic font-display'
              }`}
            >
              {capitalise(f)}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-paper-soft">
          Font is the persona's visual voice — serif for informal, sans for formal, cursive for
          dolce vita. Voice (text-to-speech) lands later.
        </p>
      </AccordionCard>

      {/* ❺ Mindspace — Override */}
      {mindspaces.data ? (
        <AccordionCard icon="◈" label="Mindspace — Override" meta={mindspaceMeta}>
          <MindspacePicker
            mindspaces={mindspaces.data}
            selectedMindspaceId={draft.mindspaceId}
            selectedTexture={draft.textureOverride ?? settings.data?.userTexture ?? 'cloudy'}
            previewName={draft.name || 'New Persona'}
            allowUserDefault
            hideFont
            onMindspaceChange={(id) => {
              const ms = id ? mindspaces.data?.find((m) => m.id === id) : null;
              patch({
                mindspaceId: id,
                colour: ms?.palette.accent ?? draft.colour,
              });
            }}
            onTextureChange={(t) => patch({ textureOverride: t })}
          />
        </AccordionCard>
      ) : null}

      {/* ❺ About Me — Override */}
      <AccordionCard icon="◉" label="About Me — Override" meta="Empty = global is used">
        <AutoSizeTextarea
          aria-label="About me override"
          minRows={4}
          maxRows={20}
          placeholder={settings.data?.globalAboutMe || 'Tell this persona who you are…'}
          value={draft.aboutMeOverride ?? ''}
          onChange={(v) => patch({ aboutMeOverride: v === '' ? null : v })}
        />
        <p className="mt-2 text-[11px] text-paper-soft">
          Empty = global About Me is used (shown in grey). Fill in to override for this persona
          only.
        </p>
      </AccordionCard>

      {/* Delete zone — edit mode only */}
      {!isCreate && id ? (
        <div className="mt-4 rounded-lg border border-danger/30 p-3">
          <div className="text-sm font-medium uppercase tracking-widest text-danger">
            Delete Persona
          </div>
          <p className="mb-2 text-[11px] text-paper-soft">
            All chats with this persona will be lost.
          </p>
          <button
            type="button"
            onClick={async () => {
              if (
                !window.confirm(`Delete ${draft.name}? All chats with this persona will be lost.`)
              )
                return;
              await del.mutateAsync(id);
              navigate('/app/circle');
            }}
            className="rounded-md border border-danger px-3 py-1 text-xs uppercase tracking-wider text-danger hover:bg-danger/10"
          >
            Delete
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ModelList({
  providers,
  selectedCanonicalId,
  selectedProviderId,
  selectedModelId,
  onSelect,
}: {
  providers: ProviderRow[];
  selectedCanonicalId: string | null;
  selectedProviderId: string;
  selectedModelId: string;
  onSelect: (canonicalId: string, providerId: string, upstreamSlug: string) => void;
}): JSX.Element {
  const enabled = providers.filter((p) => p.enabled);
  // Provider templates the user has configured, for intersecting offerings.
  const configuredByTemplate = new Map(enabled.map((p) => [p.templateId, p]));

  return (
    <div className="flex flex-col gap-4">
      {/* Stage 1: canonical models */}
      <div className="flex flex-col gap-2">
        {listCanonicals().map((c) => {
          const offers = listOfferings(c.id);
          const teeAvailable = offers.some((o) => o.trust.tee);
          const active = selectedCanonicalId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                // Pre-select the top-ranked *configured* offering. If the user
                // has no configured provider for this canonical, set the
                // canonical but clear the deployment — stage 2 then shows every
                // offering disabled with a CTA, and the persona stays invalid
                // until a configured deployment is chosen (never a stale pair).
                const suggested = offers.find((o) => configuredByTemplate.has(o.providerId));
                if (suggested) {
                  const row = configuredByTemplate.get(suggested.providerId);
                  onSelect(c.id, row?.id ?? '', suggested.upstreamSlug);
                } else {
                  onSelect(c.id, '', '');
                }
              }}
              className={`flex items-center justify-between gap-3 rounded-md border p-3 text-left ${
                active
                  ? 'border-paper bg-white/[0.04]'
                  : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
              }`}
            >
              <div className="font-display text-sm text-paper">{c.displayName}</div>
              <div className="flex items-center gap-2 text-xs text-paper-soft">
                {teeAvailable ? (
                  <span className="rounded bg-white/10 px-1.5 py-0.5">TEE</span>
                ) : null}
                <span>
                  {offers.length} provider{offers.length === 1 ? '' : 's'}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Stage 2: offerings for the chosen canonical */}
      {selectedCanonicalId ? (
        <div className="flex flex-col gap-2">
          <div className="text-xs uppercase tracking-wider text-paper-soft">Deployment</div>
          {listOfferings(selectedCanonicalId).map((o) => {
            const row = configuredByTemplate.get(o.providerId);
            const configured = !!row;
            const def = getProvider(o.providerId);
            const active =
              configured && selectedProviderId === row.id && selectedModelId === o.upstreamSlug;
            return (
              <button
                key={`${o.providerId}:${o.upstreamSlug}`}
                type="button"
                disabled={!configured}
                onClick={() => configured && onSelect(selectedCanonicalId, row.id, o.upstreamSlug)}
                className={`flex items-center justify-between gap-3 rounded-md border p-3 text-left disabled:opacity-50 ${
                  active
                    ? 'border-paper bg-white/[0.04]'
                    : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
                }`}
              >
                <div>
                  <div className="font-display text-sm text-paper">
                    {def?.displayName ?? o.providerId}
                  </div>
                  <div className="text-xs text-paper-soft">
                    {o.trust.tee ? 'TEE · ' : ''}
                    {o.context.recommended.toLocaleString()} ctx
                    {configured
                      ? ''
                      : ` · add ${def?.displayName ?? o.providerId} to use this deployment`}
                  </div>
                </div>
                {active ? <span>✓</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
