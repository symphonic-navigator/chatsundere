// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider } from '@chatsundere/llm-unified';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { useMindspaces } from '../../data/mindspaces.js';
import {
  useCreatePersona,
  useDeletePersona,
  usePersona,
  useUpdatePersona,
} from '../../data/personas.js';
import { useProviders } from '../../data/providers.js';
import { useSettings } from '../../data/settings.js';

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
  const isCreate = !id || id === 'new';

  const persona = usePersona(isCreate ? null : (id ?? null));
  const settings = useSettings();
  const mindspaces = useMindspaces();
  const providers = useProviders();
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

  function patch(p: Partial<DraftPersona>) {
    userModifiedRef.current = true;
    setIsDirty(true);
    setDraft((d) => ({ ...d, ...p }));
  }

  // Dynamic accordion metas
  const selectedProvider = providers.data?.find((p) => p.id === draft.providerId);
  const selectedProviderDef = selectedProvider ? getProvider(selectedProvider.templateId) : null;
  const selectedModelDef = selectedProviderDef?.knownModels.find((m) => m.id === draft.modelId);
  const modelMeta: ReactNode =
    draft.modelId && selectedProviderDef
      ? `${selectedProviderDef.displayName} · ${selectedModelDef?.displayName ?? draft.modelId}`
      : 'Pick a provider/model pair';

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
    navigate('/app/circle');
  }

  return (
    <section className="flex flex-col gap-3 px-4 pb-8 pt-4">
      <EditorSticky>
        <EditorTopbar
          title={isCreate ? 'New Persona' : draft.name || 'Edit Persona'}
          isDirty={isDirty}
          onBack={() => navigate('/app/circle')}
          onSaveAndBack={() => {
            void onSaveAndBack();
          }}
          saveDisabled={!draft.name || !draft.instructions || !draft.providerId || !draft.modelId}
          saveTooltip={
            !draft.providerId
              ? 'Add a provider in Settings first'
              : !draft.modelId
                ? 'Pick a model'
                : 'Fill in name and instructions'
          }
        />

        {!isCreate ? (
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(['Continue', 'New Chat', 'Incognito'] as const).map((label) => (
              <button
                key={label}
                type="button"
                disabled={label === 'Incognito'}
                title={label === 'Incognito' ? 'Coming with Block 3 memory system' : undefined}
                className="rounded-md border border-paper-soft/30 bg-white/[0.02] px-3 py-2 text-xs uppercase tracking-wider text-paper disabled:text-paper-soft/40"
              >
                {label}
              </button>
            ))}
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
        requiredMarker={!draft.providerId || !draft.modelId}
      >
        <ModelList
          providers={providers.data ?? []}
          selectedProviderId={draft.providerId}
          selectedModelId={draft.modelId}
          onSelect={(providerId, modelId) => patch({ providerId, modelId })}
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
  selectedProviderId,
  selectedModelId,
  onSelect,
}: {
  providers: ProviderRow[];
  selectedProviderId: string;
  selectedModelId: string;
  onSelect: (providerId: string, modelId: string) => void;
}): JSX.Element {
  const [customInput, setCustomInput] = useState('');

  return (
    <div className="flex flex-col gap-2">
      {providers
        .filter((p) => p.enabled)
        .flatMap((p) => {
          const def = getProvider(p.templateId);
          if (!def) return [];
          return def.knownModels.map((km) => (
            <button
              key={`${p.id}:${km.id}`}
              type="button"
              onClick={() => onSelect(p.id, km.id)}
              className={`flex items-center justify-between gap-3 rounded-md border p-3 text-left ${
                selectedProviderId === p.id && selectedModelId === km.id
                  ? 'border-paper bg-white/[0.04]'
                  : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
              }`}
            >
              <div>
                <div className="font-display text-sm text-paper">{km.displayName}</div>
                <div className="text-xs text-paper-soft">via {def.displayName}</div>
              </div>
              {selectedProviderId === p.id && selectedModelId === km.id ? <span>✓</span> : null}
            </button>
          ));
        })}

      <div className="mt-2 flex gap-2">
        <input
          type="text"
          placeholder="Custom model id"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          className="flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none"
        />
        <button
          type="button"
          disabled={!customInput || !selectedProviderId}
          onClick={() => {
            onSelect(selectedProviderId, customInput);
            setCustomInput('');
          }}
          className="rounded-md border border-paper-soft/30 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft hover:border-paper hover:text-paper disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}
