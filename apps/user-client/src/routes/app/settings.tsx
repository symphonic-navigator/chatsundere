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
import { ModelPickerField } from '../../components/ModelPickerField.js';
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

/** Parse a stored "${templateId}:${upstreamSlug}" ref into picker `current`. */
function parseModelRef(
  ref: string | null | undefined,
): { providerTemplateId: string; upstreamSlug: string } | null {
  if (!ref) return null;
  const idx = ref.indexOf(':');
  if (idx < 0) return null;
  return { providerTemplateId: ref.slice(0, idx), upstreamSlug: ref.slice(idx + 1) };
}

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
 * Global substitute-vision model picker. Uses `ModelPickerField` to pick a
 * vision-capable model. Persists the chosen ref as `"${templateId}:${upstreamSlug}"`
 * in `settings.substituteVisionModel` — the format the send path parses.
 */
export function SubstituteVisionSetting(): JSX.Element {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { data: providerRows } = useProviders();
  const rows = providerRows ?? [];
  const configuredTemplateIds = usableTemplateIds(rows, !!settings?.corsProxy);

  return (
    <div>
      <p className="mb-3 text-[11px] text-paper-soft">
        Route images through a vision-capable model, so a chat model that can&apos;t see images on
        its own can still read them. One global choice for all personas — used only when your active
        model cannot see images.
      </p>
      <ModelPickerField
        providers={rows}
        configuredTemplateIds={configuredTemplateIds}
        filter="vision"
        current={parseModelRef(settings?.substituteVisionModel)}
        onSelect={(sel) =>
          update.mutate({ substituteVisionModel: `${sel.providerTemplateId}:${sel.upstreamSlug}` })
        }
        onClear={() => update.mutate({ substituteVisionModel: null })}
        emptyLabel="None — pick a vision model"
      />
    </div>
  );
}

/**
 * Global expert-model picker. Uses `ModelPickerField` to pick any model (no
 * capability filter). Persists the chosen ref as `"${templateId}:${upstreamSlug}"`
 * in `settings.expertModel` — the same format `resolveExpert` parses.
 */
export function ExpertModelSetting(): JSX.Element {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { data: providerRows } = useProviders();
  const rows = providerRows ?? [];
  const configuredTemplateIds = usableTemplateIds(rows, !!settings?.corsProxy);

  return (
    <div>
      <p className="mb-3 text-[11px] text-paper-soft">
        When you tap "Ask an expert", the active model delegates your question to this model for a
        stronger answer. One global choice — applies across all personas.
      </p>
      <p className="mb-3 text-[11px] text-paper-soft">
        Only the sanitised question you see in the pill leaves your device — never your
        conversation, persona, or personal details.
      </p>
      <ModelPickerField
        providers={rows}
        configuredTemplateIds={configuredTemplateIds}
        filter="all"
        current={parseModelRef(settings?.expertModel)}
        onSelect={(sel) =>
          update.mutate({ expertModel: `${sel.providerTemplateId}:${sel.upstreamSlug}` })
        }
        onClear={() => update.mutate({ expertModel: null })}
        emptyLabel="None — pick an expert model"
      />
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
 * "disabled over hidden", which still applies *within* the section). All web
 * backends today need the CORS proxy (their endpoints lack CORS), so when no
 * proxy is configured the section renders a disabled "needs a proxy" notice
 * rather than offering pickers that cannot run. Owns the data wiring so
 * `WebInterfacingSection` stays pure.
 */
function WebInterfacingSettings(): JSX.Element | null {
  const usable = useUsableTemplateIds();
  const settings = useSettings();
  const update = useUpdateSettings();
  if (!aggregateServiceKinds(usable).includes('web')) return null;
  const hasProxy = settings.data?.corsProxy != null;
  const options = webBackendOptions(usable, hasProxy);
  // Web offerings exist but all require the CORS proxy — disabled over hidden.
  if (options.length === 0) {
    return (
      <AccordionCard icon="◍" label="Web" meta="Search & fetch backends">
        <p className="web-needs-proxy">
          Web search and fetch need a CORS proxy. Set one up under Upstream Providers above to
          enable them.
        </p>
      </AccordionCard>
    );
  }
  const wi = settings.data?.webInterfacing ?? { search: null, fetch: null };
  return (
    <AccordionCard icon="◍" label="Web" meta="Search & fetch backends">
      <WebInterfacingSection
        options={options}
        search={wi.search}
        fetch={wi.fetch}
        onChange={(next) => update.mutate({ webInterfacing: next })}
      />
    </AccordionCard>
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
        <SubstituteVisionSetting />
      </AccordionCard>

      <AccordionCard icon="↑" label="Expert uplink" meta="Ask a stronger model for hard questions">
        <ExpertModelSetting />
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
