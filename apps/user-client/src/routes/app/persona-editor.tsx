// SPDX-License-Identifier: AGPL-3.0-only

import { type Offering, getOffering, listOfferings } from '@chatsundere/llm-unified';
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
import { ModelPickerField } from '../../components/ModelPickerField.js';
import { PersonaAvatar } from '../../components/PersonaAvatar.js';
import { KnowledgeSection } from '../../components/persona-editor/KnowledgeSection.js';
import { McpOverrideSection } from '../../components/persona-editor/McpOverrideSection.js';
import { useChats } from '../../data/chats.js';
import { useMcpServers } from '../../data/mcp-servers.js';
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
import { cropToBackground } from '../../lib/avatar-crop.js';
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
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
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
  const pendingData = pending && pending !== 'remove' ? pending : null;
  const pendingBlob = pendingData?.blob ?? null;
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
  // Reproduce the confirmed crop in the preview exactly as PersonaAvatar does
  // for the saved image (CSS background-size/position). Without this the
  // preview fell back to bg-cover and briefly showed the whole, uncropped image
  // until a reload re-rendered it through PersonaAvatar.
  const previewBg =
    pendingData && previewUrl
      ? cropToBackground(pendingData.width, pendingData.height, pendingData.crop, 48)
      : null;
  return (
    <div className="mb-3 flex items-center gap-3">
      {previewUrl && previewBg ? (
        <div
          className="h-12 w-12 shrink-0 overflow-hidden rounded-md"
          style={{
            backgroundImage: `url(${previewUrl})`,
            backgroundSize: previewBg.backgroundSize,
            backgroundPosition: previewBg.backgroundPosition,
            backgroundRepeat: 'no-repeat',
          }}
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
  const mcpServers = useMcpServers();
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
      // Older persona rows predate libraryIds; default to an empty selection so
      // the Knowledge section binds to an array rather than undefined.
      setDraft({ ...rest, libraryIds: rest.libraryIds ?? [] });
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

      {/* Identity — always visible, outside the accordion.
          Order top→bottom: avatar, name, tagline, model. */}
      <section className="rounded-card border border-white/5 bg-white/[0.02] p-3">
        <header className="mb-2 text-xs uppercase tracking-widest text-paper-soft">Identity</header>
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
        <div className="mb-2 mt-3 flex items-center gap-2">
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
          className="mb-3 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-soft"
        />
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-paper-soft">Model</span>
          {!draft.canonicalId || !draft.providerId || !draft.modelId ? (
            <span aria-label="Model is required" className="text-danger" data-required-marker>
              ✕
            </span>
          ) : null}
        </div>
        <ModelPickerField
          providers={providers.data ?? []}
          configuredTemplateIds={usableTemplateIds(
            providers.data ?? [],
            !!settings.data?.corsProxy,
          )}
          filter="all"
          current={(() => {
            const row = providers.data?.find((p) => p.id === draft.providerId);
            if (row && draft.modelId) {
              return { providerTemplateId: row.templateId, upstreamSlug: draft.modelId };
            }
            // The chosen deployment is gone. Only surface a constructive stale
            // hint when the model is reachable on NO configured provider; if it
            // is still reachable elsewhere, leave the field empty so the user
            // re-picks cleanly rather than masquerading a provider they never
            // chose (which would block Save with no visible reason).
            if (draft.canonicalId) {
              const configured = new Set(
                (providers.data ?? []).filter((p) => p.enabled).map((p) => p.templateId),
              );
              const offers = listOfferings(draft.canonicalId);
              const reachable = offers.some((o) => configured.has(o.providerId));
              const hint = offers[0];
              if (!reachable && hint) {
                return { providerTemplateId: hint.providerId, upstreamSlug: hint.upstreamSlug };
              }
            }
            return null;
          })()}
          onSelect={(sel) =>
            patch({
              canonicalId: sel.canonicalId,
              providerId: sel.providerRowId,
              modelId: sel.upstreamSlug,
            })
          }
          onBrowseProviders={() => navigate('/app/settings')}
          emptyLabel="Choose a model"
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

      {/* ❷ Behavior */}
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
            <div className="text-sm text-paper">Ask an expert by default</div>
            <p className="text-[11px] text-paper-soft">
              Default for new chats; override per chat from the cockpit.
            </p>
          </div>
          <button
            type="button"
            aria-label="Ask an expert by default"
            aria-pressed={draft.askExpertDefault}
            disabled={settings.data?.expertModel == null}
            title={
              settings.data?.expertModel == null
                ? 'Choose a global expert model in Settings first.'
                : undefined
            }
            onClick={() => patch({ askExpertDefault: !draft.askExpertDefault })}
            className={`h-6 w-12 shrink-0 rounded-full border ${
              draft.askExpertDefault
                ? 'border-paper bg-paper/30'
                : 'border-paper-soft/30 bg-white/5'
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <span
              className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
                draft.askExpertDefault ? 'translate-x-6' : 'translate-x-0'
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

      {/* ❻ Knowledge */}
      <AccordionCard
        icon="❋"
        label="Knowledge"
        meta={
          draft.libraryIds.length > 0
            ? `${draft.libraryIds.length} ${draft.libraryIds.length === 1 ? 'library' : 'libraries'}`
            : 'No libraries assigned'
        }
      >
        <KnowledgeSection
          selected={draft.libraryIds}
          onChange={(ids) => patch({ libraryIds: ids })}
          adultPersona={draft.adultPersona}
        />
      </AccordionCard>

      {/* ❼ MCP Servers */}
      <AccordionCard icon="⧉" label="MCP Servers" meta="Per-persona tool access">
        <McpOverrideSection
          servers={mcpServers.data ?? []}
          overrides={draft.mcpOverrides}
          onChange={(next) => patch({ mcpOverrides: next })}
        />
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
