// SPDX-License-Identifier: AGPL-3.0-only

import {
  type FreedomState,
  type Offering,
  availableCanonicals,
  effectiveFreedom,
  getCanonical,
  getOffering,
  getProvider,
  listOfferings,
} from '@chatsundere/llm-unified';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type {
  AvatarCrop,
  MindspaceRow,
  PersonaRow,
  ProviderRow,
  SettingsRow,
} from '../../boot/client-data-db.js';
import { AccordionCard } from '../../components/AccordionCard.js';
import { AutoSizeTextarea } from '../../components/AutoSizeTextarea.js';
import { AvatarCropModal } from '../../components/AvatarCropModal.js';
import { EditorSticky } from '../../components/EditorSticky.js';
import { EditorTopbar } from '../../components/EditorTopbar.js';
import { MindspacePicker } from '../../components/MindspacePicker.js';
import { PersonaAvatar } from '../../components/PersonaAvatar.js';
import { useChats } from '../../data/chats.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { useRemovePersonaAvatar, useSetPersonaAvatar } from '../../data/persona-avatars.js';
import {
  useCreatePersona,
  useDeletePersona,
  usePersona,
  useUpdatePersona,
} from '../../data/personas.js';
import { useProviders } from '../../data/providers.js';
import { useSettings } from '../../data/settings.js';
import { normaliseAvatar } from '../../lib/avatar-normalise.js';
import {
  CONTEXT_STEP,
  contextAdjustable,
  effectiveFloor,
  resolveContextWindow,
} from '../../lib/context-window.js';
import { FONT_VAR } from '../../lib/persona-font.js';
import { usableTemplateIds } from '../../lib/usable-providers.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';
import { toastStore } from '../../state/toast.store.js';

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
    chatsundereTonality: true,
    contextWindow: null,
  };
}

/** Pending avatar state. An object = crop confirmed but not yet persisted; 'remove' = user
 *  wants the existing avatar deleted on next save; null = no pending change. */
export type PendingAvatar =
  | { blob: Blob; mime: string; width: number; height: number; crop: AvatarCrop }
  | 'remove'
  | null;

/**
 * Presentational avatar picker strip. Shows a preview (pending blob), the
 * saved avatar via PersonaAvatar, or a two-letter monogram when in create
 * mode or after an explicit remove. Exported for the avatar test.
 */
export function AvatarField({
  personaId,
  name,
  colour,
  pending,
  onPick,
  onRemove,
}: {
  personaId: string | null;
  name: string;
  colour: string;
  pending: PendingAvatar;
  onPick: (file: File) => void;
  onRemove: () => void;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  // Hold the preview object URL in state so it is created once per blob and
  // revoked on cleanup — computing it inline would leak a URL on every render
  // (PersonaEditor re-renders on each keystroke).
  const pendingBlob = pending && pending !== 'remove' ? pending.blob : null;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingBlob) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingBlob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingBlob]);
  return (
    <div className="mb-3 flex items-center gap-3">
      {previewUrl ? (
        <div
          className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-cover bg-center"
          style={{ backgroundImage: `url(${previewUrl})` }}
          data-avatar-preview
        />
      ) : pending === 'remove' || !personaId ? (
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-md font-display"
          style={{ background: `${colour}1f`, color: colour, border: `1px solid ${colour}33` }}
        >
          {name.trim().slice(0, 2).toUpperCase() || '??'}
        </div>
      ) : (
        <PersonaAvatar personaId={personaId} name={name} colour={colour} size={48} />
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        aria-label="Change avatar"
        onClick={() => inputRef.current?.click()}
        className="rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
      >
        Change avatar
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="text-[11px] uppercase tracking-wider text-paper-soft hover:text-paper"
      >
        Remove
      </button>
    </div>
  );
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

  const setAvatarMut = useSetPersonaAvatar();
  const removeAvatarMut = useRemovePersonaAvatar();
  const [pendingAvatar, setPendingAvatar] = useState<PendingAvatar>(null);
  const [cropState, setCropState] = useState<{
    url: string;
    width: number;
    height: number;
    blob: Blob;
    mime: string;
  } | null>(null);

  async function onPickAvatar(file: File): Promise<void> {
    try {
      const n = await normaliseAvatar(file);
      setCropState({
        url: URL.createObjectURL(n.blob),
        width: n.width,
        height: n.height,
        blob: n.blob,
        mime: n.mime,
      });
    } catch (e) {
      toastStore.show({ message: (e as Error).message, tone: 'warn', durationMs: 3500 });
    }
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
    let pid: string | undefined = id;
    if (isCreate) {
      const row = await create.mutateAsync(draft);
      pid = row.id;
    } else if (id) {
      await update.mutateAsync({ id, patch: draft });
    }
    if (pid && pendingAvatar) {
      if (pendingAvatar === 'remove') {
        await removeAvatarMut.mutateAsync(pid);
      } else {
        await setAvatarMut.mutateAsync({ personaId: pid, ...pendingAvatar });
      }
      setPendingAvatar(null);
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
        <div className="mt-3">
          <div className="mb-2 text-xs uppercase tracking-widest text-paper-soft">Avatar</div>
          <AvatarField
            personaId={isCreate ? null : (id ?? null)}
            name={draft.name || 'New Persona'}
            colour={draft.colour}
            pending={pendingAvatar}
            onPick={(f) => {
              setIsDirty(true);
              void onPickAvatar(f);
            }}
            onRemove={() => {
              setIsDirty(true);
              setPendingAvatar('remove');
            }}
          />
        </div>
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
          configuredTemplateIds={usableTemplateIds(
            providers.data ?? [],
            !!settings.data?.corsProxy,
          )}
          selectedCanonicalId={draft.canonicalId}
          selectedProviderId={draft.providerId}
          selectedModelId={draft.modelId}
          onSelect={(canonicalId, providerId, modelId) =>
            patch({ canonicalId, providerId, modelId })
          }
          onBrowseProviders={() => navigate('/app/settings')}
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
            <div className="text-sm text-paper">Chatsundere Tonality</div>
            <p className="text-[11px] text-paper-soft">
              The curated Chatsundere voice — open, uncensored on topics, expressive. On by default.
              Turn off for a plainer persona.
            </p>
          </div>
          <button
            type="button"
            aria-label="Chatsundere tonality"
            aria-pressed={draft.chatsundereTonality}
            onClick={() => patch({ chatsundereTonality: !draft.chatsundereTonality })}
            className={`h-6 w-12 shrink-0 rounded-full border ${
              draft.chatsundereTonality
                ? 'border-paper bg-paper/30'
                : 'border-paper-soft/30 bg-white/5'
            }`}
          >
            <span
              className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
                draft.chatsundereTonality ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-paper">Adult Persona</div>
            <p className="text-[11px] text-paper-soft">
              Hidden when sanitised mode is active, and unlocks explicit content in this persona's
              system prompt. Refine the tone further via custom instructions.
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

        {(() => {
          const prov = providers.data?.find((pr) => pr.id === draft.providerId);
          const off =
            prov && draft.modelId ? getOffering(prov.templateId, draft.modelId) : undefined;
          return off ? (
            <ContextWindowControl
              offering={off}
              value={draft.contextWindow}
              onChange={(n) => patch({ contextWindow: n })}
            />
          ) : null;
        })()}
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

      {cropState ? (
        <AvatarCropModal
          imageUrl={cropState.url}
          naturalWidth={cropState.width}
          naturalHeight={cropState.height}
          initialCrop={{ x: 0, y: 0, zoom: 1 }}
          onCancel={() => {
            URL.revokeObjectURL(cropState.url);
            setCropState(null);
          }}
          onConfirm={(crop) => {
            setPendingAvatar({
              blob: cropState.blob,
              mime: cropState.mime,
              width: cropState.width,
              height: cropState.height,
              crop,
            });
            URL.revokeObjectURL(cropState.url);
            setCropState(null);
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * Context-window slider. Green from the floor to the offering's recommended
 * window, red from recommended to max (higher = costlier/slower/often weaker).
 * `value` is the persona's override (null = recommended). Emits null on reset.
 */
export function ContextWindowControl({
  offering,
  value,
  onChange,
}: {
  offering: Offering;
  value: number | null;
  onChange: (next: number | null) => void;
}): JSX.Element {
  const floor = effectiveFloor(offering);
  const { max, recommended } = offering.context;
  const adjustable = contextAdjustable(offering);
  const resolved = resolveContextWindow({ contextWindow: value } as PersonaRow, offering);
  const recFraction = max > floor ? ((recommended - floor) / (max - floor)) * 100 : 100;
  const inRed = resolved > recommended;

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between">
        <label
          htmlFor="persona-context"
          className="text-xs uppercase tracking-widest text-paper-soft"
        >
          Context window
        </label>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={value === null}
          className="text-[11px] uppercase tracking-wider text-paper-soft hover:text-paper disabled:opacity-40"
        >
          Use default
        </button>
      </div>
      <div
        aria-hidden
        className="mb-2 h-1.5 w-full rounded-full"
        style={{
          background: `linear-gradient(to right, #6aa97a 0%, #6aa97a ${recFraction}%, #b33a5e ${recFraction}%, #b33a5e 100%)`,
        }}
      />
      <div className="flex items-center gap-3">
        <input
          id="persona-context"
          type="range"
          min={floor}
          max={max}
          step={CONTEXT_STEP}
          value={resolved}
          disabled={!adjustable}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 disabled:opacity-40"
        />
        <span className="w-28 text-right font-mono text-sm text-paper">
          {resolved.toLocaleString()} tokens
        </span>
      </div>
      <p className="mt-1 text-[11px] text-paper-soft">
        {!adjustable
          ? "This model's context window isn't adjustable."
          : inRed
            ? 'Above the recommended window — higher is costlier, slower, and often weaker.'
            : `Default ${recommended.toLocaleString()}. Lower trims cost; the red zone goes up to the model maximum.`}
      </p>
    </div>
  );
}

/**
 * Coloured trust badge — TEE (trusted execution, mint) and ZDR (zero data
 * retention, lavender). The title attribute spells out the acronym so the
 * user never has to guess (Don't make me think).
 */
function TrustBadge({ kind }: { kind: 'tee' | 'zdr' }): JSX.Element {
  const cfg =
    kind === 'tee'
      ? {
          label: 'TEE',
          title: 'Trusted Execution Environment — the host cannot read your data',
          cls: 'bg-success/15 text-success border-success/40',
        }
      : {
          label: 'ZDR',
          title: 'Zero Data Retention — the provider stores nothing after the request',
          cls: 'bg-aurora-500/20 text-aurora-200 border-aurora-500/50',
        };
  return (
    <span
      title={cfg.title}
      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

/**
 * The loud, honest signal for a censored model. Only 'restricted' carries a
 * badge today (free/unknown stay unmarked); restricted means the model — or its
 * deployment — applies content restrictions somewhere in the stack. For Claude
 * and ChatGPT the model is censored at source while the router routes verbatim;
 * we route via the anonymising router (LLM-VPN, ADR 0032), so the server still
 * never sees plaintext, but the censorship is real and we name it.
 */
function FreedomBadge({ state }: { state: FreedomState }): JSX.Element | null {
  if (state !== 'restricted') return null;
  return (
    <span
      title="This model is censored by its maker. Reached via an anonymising router — the server never sees your data — but the model itself applies content restrictions."
      className="rounded border border-danger/40 bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-danger"
    >
      Censored
    </span>
  );
}

/**
 * Jurisdiction badge — the legal home of the deployment (e.g. EU), in the same
 * aurora palette as ZDR so trust signals read as a set. The title spells it out.
 */
function JurisdictionBadge({ code }: { code: string }): JSX.Element {
  return (
    <span
      title={`Jurisdiction: ${code}`}
      className="rounded border border-aurora-500/40 bg-aurora-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-aurora-200"
    >
      {code}
    </span>
  );
}

function ModelList({
  providers,
  configuredTemplateIds,
  selectedCanonicalId,
  selectedProviderId,
  selectedModelId,
  onSelect,
  onBrowseProviders,
}: {
  providers: ProviderRow[];
  configuredTemplateIds: string[];
  selectedCanonicalId: string | null;
  selectedProviderId: string;
  selectedModelId: string;
  onSelect: (canonicalId: string, providerId: string, upstreamSlug: string) => void;
  onBrowseProviders: () => void;
}): JSX.Element {
  const enabled = providers.filter((p) => p.enabled);
  // Provider templates the user has configured, for intersecting offerings.
  const configuredByTemplate = new Map(enabled.map((p) => [p.templateId, p]));
  // Only canonicals with a usable offering are shown; the rest are counted for
  // the quiet footer that points the user at My Settings.
  const { available, hiddenCount } = availableCanonicals(configuredTemplateIds);

  return (
    <div className="flex flex-col gap-2">
      {/* If the persona's chosen model is no longer reachable (its provider was
          removed or disabled), surface it as a quiet danger row with the
          constructive next step rather than silently dropping the selection. */}
      {selectedCanonicalId && !available.some((c) => c.id === selectedCanonicalId)
        ? (() => {
            const stale = getCanonical(selectedCanonicalId);
            const anyOffer = listOfferings(selectedCanonicalId)[0];
            const provName = anyOffer
              ? (getProvider(anyOffer.providerId)?.displayName ?? anyOffer.providerId)
              : null;
            return (
              <div className="rounded-md border border-danger/30 bg-danger/[0.04] p-3">
                <div className="font-display text-sm text-paper">
                  {stale?.displayName ?? selectedCanonicalId}
                </div>
                <div className="text-xs text-danger">
                  Currently unavailable
                  {provName ? ` — add ${provName} or pick another model` : ' — pick another model'}
                </div>
              </div>
            );
          })()
        : null}
      {available.map((c) => {
        // Configured-only offerings — every deployment row is now reachable,
        // and the trust badges and provider count reflect what the user can use.
        const offers = listOfferings(c.id).filter((o) => configuredByTemplate.has(o.providerId));
        const teeAvailable = offers.some((o) => o.trust.tee);
        const zdrAvailable = offers.some((o) => o.trust.zdr);
        const active = selectedCanonicalId === c.id;
        return (
          <div key={c.id} className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                // Pre-select the top-ranked offering. The list only shows
                // canonicals with a configured offering, so `offers` is never
                // empty and a configured provider row always exists.
                const suggested = offers[0];
                if (!suggested) return;
                const row = configuredByTemplate.get(suggested.providerId);
                onSelect(c.id, row?.id ?? '', suggested.upstreamSlug);
              }}
              className={`flex items-center justify-between gap-3 rounded-md border p-3 text-left ${
                active
                  ? 'border-paper bg-white/[0.04]'
                  : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
              }`}
            >
              <div className="font-display text-sm text-paper">{c.displayName}</div>
              <div className="flex items-center gap-2 text-xs text-paper-soft">
                {teeAvailable ? <TrustBadge kind="tee" /> : null}
                {zdrAvailable ? <TrustBadge kind="zdr" /> : null}
                <span>
                  {offers.length} provider{offers.length === 1 ? '' : 's'}
                </span>
              </div>
            </button>

            {/* Deployments inline, directly under the chosen model — not below
                the whole list. */}
            {active ? (
              <div className="flex flex-col gap-2 border-l border-white/10 pl-3">
                <div className="text-xs uppercase tracking-wider text-paper-soft">Deployment</div>
                {offers.map((o) => {
                  // `offers` is configured-only, so the provider row always
                  // exists for every deployment shown here.
                  const row = configuredByTemplate.get(o.providerId);
                  if (!row) return null;
                  const def = getProvider(o.providerId);
                  const isActive =
                    selectedProviderId === row.id && selectedModelId === o.upstreamSlug;
                  return (
                    <button
                      key={`${o.providerId}:${o.upstreamSlug}`}
                      type="button"
                      onClick={() => onSelect(c.id, row.id, o.upstreamSlug)}
                      className={`flex items-center justify-between gap-3 rounded-md border p-3 text-left ${
                        isActive
                          ? 'border-paper bg-white/[0.04]'
                          : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-display text-sm text-paper">
                            {def?.displayName ?? o.providerId}
                          </span>
                          {o.trust.tee ? <TrustBadge kind="tee" /> : null}
                          {o.trust.zdr ? <TrustBadge kind="zdr" /> : null}
                          {o.trust.jurisdiction ? (
                            <JurisdictionBadge code={o.trust.jurisdiction} />
                          ) : null}
                          <FreedomBadge
                            state={effectiveFreedom(c.freedomOriented, o.freedomOrientedDeployment)}
                          />
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-paper-soft">
                          <span>{o.context.recommended.toLocaleString()} ctx</span>
                          {/* Every offering here is configured/reachable, so these
                              capability hints describe what the user can actually use. */}
                          <span className="flex gap-1">
                            {o.profile.toolCalls.supported ? (
                              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-paper-soft">
                                Tools
                              </span>
                            ) : null}
                            {o.profile.vision ? (
                              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-paper-soft">
                                Vision
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </div>
                      {isActive ? <span>✓</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={onBrowseProviders}
          className="mt-1 text-left text-[11px] text-paper-soft/70 hover:text-paper-soft"
        >
          ＋{hiddenCount} more model{hiddenCount === 1 ? '' : 's'} once you add providers → My
          Settings
        </button>
      ) : null}
    </div>
  );
}
