// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MindspaceTexture, SettingsRow } from '../../boot/client-data-db.js';
import { AccordionCard } from '../../components/AccordionCard.js';
import { AutoSizeTextarea } from '../../components/AutoSizeTextarea.js';
import { EditorSticky } from '../../components/EditorSticky.js';
import { EditorTopbar } from '../../components/EditorTopbar.js';
import { MindspacePicker } from '../../components/MindspacePicker.js';
import { ProviderSheet } from '../../components/ProviderSheet.js';
import { SaveBar } from '../../components/SaveBar.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { useProviders } from '../../data/providers.js';
import { useSettings, useUpdateSettings } from '../../data/settings.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';

const BUILT_IN_PROVIDERS = [
  { id: 'chutes', name: 'Chutes', monogram: 'Ch' },
  { id: 'tensorix', name: 'Tensorix', monogram: 'Te' },
  { id: 'mistral', name: 'Mistral AI', monogram: 'Mi' },
  { id: 'wafer', name: 'Wafer', monogram: 'Wa' },
  { id: 'novita', name: 'Novita AI', monogram: 'No' },
  { id: 'ollama-cloud', name: 'Ollama Cloud', monogram: 'Ol' },
  { id: 'nano-gpt', name: 'nano-gpt.com', monogram: 'nG' },
  { id: 'openrouter', name: 'OpenRouter', monogram: 'OR' },
] as const;

type ProviderTemplateId = (typeof BUILT_IN_PROVIDERS)[number]['id'];

interface SettingsDraft {
  globalAboutMe: string;
  globalUnlockerPrompt: string;
  defaultMindspaceId: string;
  userTexture: MindspaceTexture;
}

function draftFromRow(s: SettingsRow): SettingsDraft {
  return {
    globalAboutMe: s.globalAboutMe,
    globalUnlockerPrompt: s.globalUnlockerPrompt,
    defaultMindspaceId: s.defaultMindspaceId,
    userTexture: s.userTexture,
  };
}

function isSameDraft(a: SettingsDraft, b: SettingsDraft): boolean {
  return (
    a.globalAboutMe === b.globalAboutMe &&
    a.globalUnlockerPrompt === b.globalUnlockerPrompt &&
    a.defaultMindspaceId === b.defaultMindspaceId &&
    a.userTexture === b.userTexture
  );
}

function ProvidersList(): JSX.Element {
  const providers = useProviders();
  const [openSheet, setOpenSheet] = useState<ProviderTemplateId | null>(null);

  return (
    <div className="flex flex-col gap-2">
      {BUILT_IN_PROVIDERS.map((b) => {
        const row = providers.data?.find((p) => p.templateId === b.id);
        const connected = !!row?.enabled;
        return (
          <button
            key={b.id}
            type="button"
            className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04]"
            onClick={() => setOpenSheet(b.id)}
          >
            <div className="grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper">
              {b.monogram}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display text-sm text-paper">{b.name}</div>
              <div className="text-xs text-paper-soft">
                {connected ? '● Connected · Key valid' : 'Not connected'}
              </div>
              <div className="mt-1 flex gap-1">
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-paper-soft">
                  Text
                </span>
              </div>
            </div>
            <span className="text-paper-soft">▸</span>
          </button>
        );
      })}
      <p className="mt-2 text-[11px] text-paper-soft">
        Keys are tested automatically on save. Each provider can be added once.
      </p>
      {openSheet ? (
        <ProviderSheet templateId={openSheet} onClose={() => setOpenSheet(null)} />
      ) : null}
    </div>
  );
}

export function Settings(): JSX.Element {
  const navigate = useNavigate();
  const settings = useSettings();
  const mindspaces = useMindspaces();
  const updateSettings = useUpdateSettings();
  const providers = useProviders();
  const setMindspace = useMindspaceStore((s) => s.update);

  const [draft, setDraft] = useState<SettingsDraft | null>(null);

  useEffect(() => {
    if (!draft && settings.data) {
      setDraft(draftFromRow(settings.data));
    }
  }, [settings.data, draft]);

  useEffect(() => {
    if (draft && mindspaces.data) {
      setMindspace({
        persona: null,
        defaultMindspaceId: draft.defaultMindspaceId,
        defaultTexture: draft.userTexture,
        mindspaces: mindspaces.data,
      });
    }
  }, [draft, mindspaces.data, setMindspace]);

  if (!settings.data || !mindspaces.data || !draft) {
    return <div className="p-4 text-paper-soft">Loading…</div>;
  }

  const original = draftFromRow(settings.data);
  const isDirty = !isSameDraft(draft, original);

  function patch(p: Partial<SettingsDraft>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  async function persistDraft() {
    if (!draft || !settings.data) return;
    const orig = draftFromRow(settings.data);
    const diff: Partial<SettingsDraft> = {};
    if (draft.globalAboutMe !== orig.globalAboutMe) diff.globalAboutMe = draft.globalAboutMe;
    if (draft.globalUnlockerPrompt !== orig.globalUnlockerPrompt)
      diff.globalUnlockerPrompt = draft.globalUnlockerPrompt;
    if (draft.defaultMindspaceId !== orig.defaultMindspaceId)
      diff.defaultMindspaceId = draft.defaultMindspaceId;
    if (draft.userTexture !== orig.userTexture) diff.userTexture = draft.userTexture;
    if (Object.keys(diff).length > 0) {
      await updateSettings.mutateAsync(diff);
    }
  }

  async function onSaveStay() {
    await persistDraft();
  }

  async function onSaveAndBack() {
    await persistDraft();
    navigate('/app');
  }

  function onCancel() {
    if (!settings.data) return;
    if (!isDirty || window.confirm('Discard your unsaved changes?')) {
      setDraft(draftFromRow(settings.data));
    }
  }

  const selectedMindspace =
    mindspaces.data.find((m) => m.id === draft.defaultMindspaceId) ?? mindspaces.data[0];

  return (
    <section className="flex flex-col gap-3 px-4 pb-32 pt-4">
      <EditorSticky>
        <EditorTopbar
          title="My Settings"
          isDirty={isDirty}
          onBack={() => navigate('/app')}
          onSaveAndBack={() => {
            void onSaveAndBack();
          }}
        />
      </EditorSticky>

      <AccordionCard icon="◉" label="About Me" meta="What your Circle knows about you">
        <AutoSizeTextarea
          aria-label="About me"
          minRows={4}
          value={draft.globalAboutMe}
          onChange={(v) => patch({ globalAboutMe: v })}
          placeholder="Tell your Circle who you are…"
        />
        <p className="mt-2 text-[11px] text-paper-soft">
          This text is included in every persona's system prompt unless overridden per-persona.
        </p>
        <div className="mt-4">
          <div className="mb-2 text-xs uppercase tracking-widest text-paper-soft">
            Your Default Mindspace
          </div>
          {selectedMindspace ? (
            <MindspacePicker
              mindspaces={mindspaces.data}
              selectedMindspaceId={selectedMindspace.id}
              selectedTexture={draft.userTexture}
              previewName="Chris"
              hideFont
              onMindspaceChange={(id) => {
                if (id) patch({ defaultMindspaceId: id });
              }}
              onTextureChange={(t) => patch({ userTexture: t })}
            />
          ) : null}
        </div>
      </AccordionCard>

      <AccordionCard
        icon="⚿"
        label="Global System Prompt"
        meta="The unlocker — prepended to every persona"
      >
        <AutoSizeTextarea
          aria-label="Global system prompt"
          minRows={4}
          maxRows={20}
          value={draft.globalUnlockerPrompt}
          onChange={(v) => patch({ globalUnlockerPrompt: v })}
        />
        <p className="mt-2 text-[11px] text-paper-soft">
          This text is prepended to every persona's system prompt. Mainly useful for permissive but
          cautious open-source models. Always global, no per-persona override.
        </p>
      </AccordionCard>

      <AccordionCard
        icon="⬢"
        label="Upstream Providers"
        meta={`${(providers.data ?? []).filter((p) => p.enabled).length} of ${BUILT_IN_PROVIDERS.length} connected`}
      >
        <ProvidersList />
      </AccordionCard>

      <SaveBar
        onCancel={onCancel}
        onSave={() => {
          void onSaveStay();
        }}
        saveDisabled={!isDirty}
        saveTooltip={!isDirty ? 'Nothing to save' : undefined}
        saveLabel="Save Settings"
      />
    </section>
  );
}
