// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccordionCard } from '../../components/AccordionCard.js';
import { AutoSizeTextarea } from '../../components/AutoSizeTextarea.js';
import { MindspacePicker } from '../../components/MindspacePicker.js';
import { ProviderSheet } from '../../components/ProviderSheet.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { useProviders } from '../../data/providers.js';
import { useSettings, useUpdateSettings } from '../../data/settings.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';

const BUILT_IN_PROVIDERS = [
  { id: 'nano-gpt', name: 'nano-gpt.com', monogram: 'nG' },
  { id: 'novita', name: 'Novita AI', monogram: 'No' },
  { id: 'ollama-cloud', name: 'Ollama Cloud', monogram: 'Ol' },
] as const;

function ProvidersList(): JSX.Element {
  const providers = useProviders();
  const [openSheet, setOpenSheet] = useState<'nano-gpt' | 'novita' | 'ollama-cloud' | null>(null);

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

  if (!settings.data || !mindspaces.data) {
    return <div className="p-4 text-paper-soft">Loading…</div>;
  }

  const s = settings.data;
  const selectedMindspace =
    mindspaces.data.find((m) => m.id === s.defaultMindspaceId) ?? mindspaces.data[0];

  return (
    <section className="flex flex-col gap-3 px-4 pb-8 pt-4">
      <header className="flex items-center gap-2 text-xs uppercase tracking-widest text-paper-soft">
        <button
          type="button"
          onClick={() => navigate('/app')}
          className="text-paper-soft hover:text-paper"
        >
          ←
        </button>
        <span>Room · My Settings</span>
      </header>

      <AccordionCard icon="◉" label="About Me" meta="What your Circle knows about you">
        <AutoSizeTextarea
          aria-label="About me"
          minRows={4}
          value={s.globalAboutMe}
          onChange={(v) => updateSettings.mutate({ globalAboutMe: v })}
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
              selectedTexture={s.userTexture}
              selectedFont={s.userFont}
              previewName="Chris"
              onMindspaceChange={(id) => {
                if (id) updateSettings.mutate({ defaultMindspaceId: id });
              }}
              onTextureChange={(t) => updateSettings.mutate({ userTexture: t })}
              onFontChange={(f) => updateSettings.mutate({ userFont: f })}
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
          value={s.globalUnlockerPrompt}
          onChange={(v) => updateSettings.mutate({ globalUnlockerPrompt: v })}
        />
        <p className="mt-2 text-[11px] text-paper-soft">
          This text is prepended to every persona's system prompt. Mainly useful for permissive but
          cautious open-source models. Always global, no per-persona override.
        </p>
      </AccordionCard>

      <AccordionCard
        icon="⬢"
        label="Upstream Providers"
        meta={`${(providers.data ?? []).filter((p) => p.enabled).length} of 3 connected`}
        defaultOpen
      >
        <ProvidersList />
      </AccordionCard>
    </section>
  );
}
