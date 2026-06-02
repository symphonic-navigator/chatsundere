// SPDX-License-Identifier: AGPL-3.0-only

import {
  type ServiceKind,
  aggregateServiceKinds,
  getProvider,
  providerServiceKinds,
  providersContributing,
} from '@chatsundere/llm-unified';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MindspaceTexture, SettingsRow } from '../../boot/client-data-db.js';
import { AccordionCard } from '../../components/AccordionCard.js';
import { AddProviderPicker } from '../../components/AddProviderPicker.js';
import { AutoSizeTextarea } from '../../components/AutoSizeTextarea.js';
import { CapBadgeRow } from '../../components/CapBadgeRow.js';
import { CorsProxyBlock } from '../../components/CorsProxyBlock.js';
import { EditorSticky } from '../../components/EditorSticky.js';
import { EditorTopbar } from '../../components/EditorTopbar.js';
import { MindspacePicker } from '../../components/MindspacePicker.js';
import { ProviderSheet } from '../../components/ProviderSheet.js';
import { SaveBar } from '../../components/SaveBar.js';
import { WebInterfacingSection } from '../../components/WebInterfacingSection.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { useProviders } from '../../data/providers.js';
import { useSettings, useUpdateSettings } from '../../data/settings.js';
import { BUILT_IN_PROVIDERS, type ProviderTemplateId } from '../../lib/built-in-providers.js';
import { usableTemplateIds, useUsableTemplateIds } from '../../lib/usable-providers.js';
import { webBackendOptions } from '../../lib/web-backend-options.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';

interface SettingsDraft {
  globalAboutMe: string;
  globalInstructions: string;
  defaultMindspaceId: string;
  userTexture: MindspaceTexture;
}

function draftFromRow(s: SettingsRow): SettingsDraft {
  return {
    globalAboutMe: s.globalAboutMe,
    globalInstructions: s.globalInstructions,
    defaultMindspaceId: s.defaultMindspaceId,
    userTexture: s.userTexture,
  };
}

function isSameDraft(a: SettingsDraft, b: SettingsDraft): boolean {
  return (
    a.globalAboutMe === b.globalAboutMe &&
    a.globalInstructions === b.globalInstructions &&
    a.defaultMindspaceId === b.defaultMindspaceId &&
    a.userTexture === b.userTexture
  );
}

/**
 * Honest placeholder (disabled over hidden): when models without vision can't
 * read attached images, a substitute vision model will describe them. Dormant
 * until the image-attachment subsystem lands. No persistence, no picker yet.
 */
export function SubstituteVisionPlaceholder(): JSX.Element {
  return (
    <div className="opacity-60">
      <p className="mb-3 text-[11px] text-paper-soft">
        Route screenshots and images through a vision-capable model, so a chat model that can't see
        images on its own can still read them. One global choice for all personas.
      </p>
      <button
        type="button"
        disabled
        title="Activates once image attachments arrive (coming soon)"
        className="rounded-md border border-paper-soft/20 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft/40"
      >
        Choose substitute model
      </button>
      <p className="mt-2 text-[11px] text-paper-soft">
        Activates once image attachments arrive (coming soon).
      </p>
    </div>
  );
}

/** Upstream Providers: proxy block, summary, configured list, add-picker. */
export function ProvidersSection(): JSX.Element {
  const providers = useProviders();
  const settings = useSettings();
  const [openSheet, setOpenSheet] = useState<ProviderTemplateId | null>(null);
  const [picking, setPicking] = useState(false);

  const rows = providers.data ?? [];
  const hasProxy = !!settings.data?.corsProxy;
  const usable = usableTemplateIds(rows, hasProxy);
  const lit = aggregateServiceKinds(usable);

  const tooltipFor = (k: ServiceKind): string => {
    const contributors = providersContributing(k).filter(
      (id) => !rows.some((r) => r.templateId === id),
    );
    if (contributors.length === 0) return 'Coming soon';
    const names = contributors.map((id) => getProvider(id)?.displayName ?? id);
    return `Add ${names.join(', ')} to unlock ${k.toUpperCase()}`;
  };

  function statusOf(row: { templateId: string; enabled: boolean }): string {
    if (!row.enabled) return '✗ Not connected';
    const needsProxy = getProvider(row.templateId)?.corsHint === 'requires-proxy';
    if (needsProxy && !hasProxy) return '✗ Needs proxy';
    return '● Connected';
  }

  return (
    <div className="flex flex-col gap-3">
      <CorsProxyBlock />

      <div>
        <div className="mb-1.5 text-[11px] uppercase tracking-widest text-paper-soft">
          What you have
        </div>
        <CapBadgeRow lit={lit} tooltipFor={tooltipFor} />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-sm text-paper-soft">
          Your Circle has no voice yet — add a provider to begin.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setOpenSheet(row.templateId as ProviderTemplateId)}
              className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04]"
            >
              <div className="grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper">
                {BUILT_IN_PROVIDERS.find((b) => b.id === row.templateId)?.monogram ??
                  row.templateId.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display text-sm text-paper">
                  {getProvider(row.templateId)?.displayName ?? row.templateId}
                </div>
                <div className="text-xs text-paper-soft">{statusOf(row)}</div>
                <div className="mt-1">
                  <CapBadgeRow lit={providerServiceKinds(row.templateId)} />
                </div>
              </div>
              <span className="text-paper-soft">▸</span>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setPicking(true)}
        className="rounded-md border border-dashed border-white/15 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft hover:border-paper hover:text-paper"
      >
        + Add provider
      </button>

      {picking ? (
        <AddProviderPicker
          configuredTemplateIds={rows.map((r) => r.templateId)}
          hasProxy={hasProxy}
          onPick={(id) => {
            setPicking(false);
            setOpenSheet(id);
          }}
          onNeedProxy={() => {
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}

      {openSheet ? (
        <ProviderSheet templateId={openSheet} onClose={() => setOpenSheet(null)} />
      ) : null}
    </div>
  );
}

/**
 * Web-interfacing settings, hidden-until-unlocked: only mounts once a usable
 * provider contributes a `web` offering (spec §2.5 — a deliberate exception to
 * "disabled over hidden", which still applies *within* the section). Today no
 * `web` offering is curated, so `lit` never includes `'web'` and this returns
 * `null`. Owns the data wiring so `WebInterfacingSection` stays pure.
 */
function WebInterfacingSettings(): JSX.Element | null {
  const usable = useUsableTemplateIds();
  const settings = useSettings();
  const update = useUpdateSettings();
  if (!aggregateServiceKinds(usable).includes('web')) return null;
  const wi = settings.data?.webInterfacing ?? { search: null, fetch: null };
  return (
    <WebInterfacingSection
      options={webBackendOptions(usable)}
      search={wi.search}
      fetch={wi.fetch}
      onChange={(next) => update.mutate({ webInterfacing: next })}
    />
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
    if (draft.globalInstructions !== orig.globalInstructions)
      diff.globalInstructions = draft.globalInstructions;
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
        label="Global Instructions"
        meta="Your own instructions — added to every persona"
      >
        <AutoSizeTextarea
          aria-label="Global instructions"
          minRows={4}
          maxRows={20}
          value={draft.globalInstructions}
          onChange={(v) => patch({ globalInstructions: v })}
        />
        <p className="mt-2 text-[11px] text-paper-soft">
          Added to every persona's system prompt. Your own global wishes — the curated Chatsundere
          tonality is a separate per-persona toggle. Always global, no per-persona override.
        </p>
      </AccordionCard>

      <AccordionCard
        icon="⬢"
        label="Upstream Providers"
        meta={`${(providers.data ?? []).length} provider(s)`}
      >
        <ProvidersSection />
      </AccordionCard>

      <WebInterfacingSettings />

      <AccordionCard icon="◫" label="Image understanding" meta="For models without vision">
        <SubstituteVisionPlaceholder />
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
