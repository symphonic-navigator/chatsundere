// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider } from '@chatsundere/llm-unified';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  MindspaceRow,
  PersonaRow,
  ProviderRow,
  SettingsRow,
} from '../../boot/client-data-db.js';
import { AccordionCard } from '../../components/AccordionCard.js';
import { MindspacePicker } from '../../components/MindspacePicker.js';
import { SaveBar } from '../../components/SaveBar.js';
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
    font: settings?.userFont ?? 'serif',
    instructions: '',
    providerId: firstEnabled?.id ?? '',
    modelId: '',
    mindspaceId: null,
    aboutMeOverride: null,
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

  useEffect(() => {
    if (!isCreate && persona.data) {
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = persona.data;
      setDraft(rest);
    } else if (isCreate) {
      setDraft(seedDraft);
    }
  }, [isCreate, persona.data, seedDraft]);

  function patch(p: Partial<DraftPersona>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  async function onSave() {
    if (isCreate) {
      await create.mutateAsync(draft);
    } else if (id) {
      await update.mutateAsync({ id, patch: draft });
    }
    navigate('/app/circle');
  }

  return (
    <section className="flex flex-col gap-3 px-4 pb-32 pt-4">
      <header className="flex items-center justify-between text-xs uppercase tracking-widest text-paper-soft">
        <button
          type="button"
          onClick={() => navigate('/app/circle')}
          className="text-paper-soft hover:text-paper"
        >
          ←
        </button>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-widest text-paper-soft">
            {isCreate ? 'New Persona' : 'Edit Persona'}
          </div>
          <div className="font-display text-sm" style={{ color: draft.colour }}>
            {draft.name || '—'}
          </div>
        </div>
        <span className="w-6" />
      </header>

      {!isCreate ? (
        <div className="grid grid-cols-3 gap-2">
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

      <AccordionCard icon="✦" label="Identity" meta="Name · tagline">
        <label
          className="mb-2 block text-xs uppercase tracking-widest text-paper-soft"
          htmlFor="persona-name"
        >
          Name
        </label>
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
      </AccordionCard>

      <AccordionCard icon="≣" label="Custom Instructions" meta="Who this persona is">
        <textarea
          className="min-h-[140px] w-full rounded-md border border-white/10 bg-black/30 p-3 font-mono text-sm text-paper outline-none focus:border-paper-soft"
          value={draft.instructions}
          onChange={(e) => patch({ instructions: e.target.value })}
        />
      </AccordionCard>

      <AccordionCard icon="◉" label="About Me — Override" meta="Empty = global is used">
        <textarea
          className="min-h-[100px] w-full rounded-md border border-white/10 bg-black/30 p-3 font-mono text-sm text-paper outline-none focus:border-paper-soft"
          placeholder={settings.data?.globalAboutMe || 'Tell this persona who you are…'}
          value={draft.aboutMeOverride ?? ''}
          onChange={(e) =>
            patch({ aboutMeOverride: e.target.value === '' ? null : e.target.value })
          }
        />
        <p className="mt-2 text-[11px] text-paper-soft">
          Empty = global About Me is used (shown in grey). Fill in to override for this persona
          only.
        </p>
      </AccordionCard>

      {mindspaces.data ? (
        <AccordionCard icon="◈" label="Mindspace — Override" meta="Color · texture · font">
          <MindspacePicker
            mindspaces={mindspaces.data}
            selectedMindspaceId={draft.mindspaceId}
            selectedTexture={
              (draft.mindspaceId
                ? mindspaces.data.find((m) => m.id === draft.mindspaceId)?.texture
                : mindspaces.data.find((m) => m.id === settings.data?.defaultMindspaceId)
                    ?.texture) ?? 'cloudy'
            }
            selectedFont={draft.font}
            previewName={draft.name || 'New Persona'}
            allowUserDefault
            onMindspaceChange={(id) => {
              const ms = id ? mindspaces.data?.find((m) => m.id === id) : null;
              patch({
                mindspaceId: id,
                colour: ms?.palette.accent ?? draft.colour,
              });
            }}
            onTextureChange={(_t) => {
              // Texture is mutated on the row (built-in or user), not stored on the persona.
              // For Phase 2 the override picker writes the user-default texture; full per-persona
              // texture-override surfaces in a later block.
            }}
            onFontChange={(f) => patch({ font: f })}
          />
        </AccordionCard>
      ) : null}

      <AccordionCard icon="⬡" label="Model" meta="Pick a provider/model pair">
        <ModelList
          providers={providers.data ?? []}
          selectedProviderId={draft.providerId}
          selectedModelId={draft.modelId}
          onSelect={(providerId, modelId) => patch({ providerId, modelId })}
        />
      </AccordionCard>

      <AccordionCard icon="∿" label="Behavior" meta="Temperature · content flags">
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

      <SaveBar
        onCancel={() => navigate('/app/circle')}
        onSave={onSave}
        saveDisabled={!draft.name || !draft.instructions || !draft.providerId}
        saveTooltip={
          !draft.providerId ? 'Add a provider in Settings first' : 'Fill in name and instructions'
        }
      />
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
