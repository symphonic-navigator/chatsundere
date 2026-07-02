// SPDX-License-Identifier: AGPL-3.0-only
import { aggregateServiceKinds, getOffering } from '@chatsundere/llm-unified';
import { useRef, useState } from 'react';
import { ModelSlotPicker } from '../../../components/ModelSlotPicker.js';
import { WebPickerOverlay, type WebPickerValue } from '../../../components/WebPickerOverlay.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { PickerField } from '../../../components/ui/PickerField.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useProviders } from '../../../data/providers.js';
import { useSettings, useUpdateSettings } from '../../../data/settings.js';
import { pickExpertSearchRef } from '../../../lib/resolve-expert-web.js';
import { useServerGate } from '../../../lib/server-gate.js';
import { usableTemplateIds, useUsableTemplateIds } from '../../../lib/usable-providers.js';
import { webBackendOptions } from '../../../lib/web-backend-options.js';
import { webBackendSummary } from '../../../lib/web-backend-summary.js';

/** Parse a stored "${templateId}:${upstreamSlug}" ref into picker `current`. */
function parseModelRef(
  ref: string | null | undefined,
): { providerTemplateId: string; upstreamSlug: string } | null {
  if (!ref) return null;
  const idx = ref.indexOf(':');
  if (idx < 0) return null;
  return { providerTemplateId: ref.slice(0, idx), upstreamSlug: ref.slice(idx + 1) };
}

/** My Settings › "Ask an Expert" — expert-model slot and expert-web picker. */
export function SettingsExpertPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings-expert');
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { data: providerRows } = useProviders();
  const usable = useUsableTemplateIds();
  const [webOpen, setWebOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  const rows = providerRows ?? [];
  const hasProxy = useServerGate('proxy').enabled;
  const configuredTemplateIds = usableTemplateIds(rows, hasProxy);
  const current = parseModelRef(settings?.expertModel);
  const hasWeb = aggregateServiceKinds(usable).includes('web');
  const options = webBackendOptions(usable, hasProxy);

  const ew: WebPickerValue = settings?.expertWeb ?? {
    search: null,
    fetch: null,
    searchTierId: null,
  };
  const searchRef = pickExpertSearchRef(ew.search, options);
  const searchTiers = searchRef
    ? (getOffering(searchRef.providerId, searchRef.upstreamSlug)?.web?.searchTiers ?? [])
    : [];

  const expertWebBody = (() => {
    if (!hasWeb) {
      return (
        <p className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-sm text-paper-soft">
          Add a web-capable provider under AI Providers to enable the expert&apos;s web access.
        </p>
      );
    }
    if (options.length === 0) {
      return (
        <p className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-sm text-paper-soft">
          Expert web search and fetch need a CORS proxy. Set one up under AI Providers to enable
          them.
        </p>
      );
    }
    if (settings?.expertModel == null) {
      return (
        <p className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-sm text-paper-soft">
          Choose an expert model above to enable the expert&apos;s web access.
        </p>
      );
    }
    return (
      <>
        <PickerField
          label="Expert search & fetch"
          value={webBackendSummary(ew.search, ew.fetch, options)}
          onOpen={(el) => {
            triggerRef.current = el;
            setWebOpen(true);
          }}
        />
        <WebPickerOverlay
          open={webOpen}
          onClose={() => setWebOpen(false)}
          triggerRef={triggerRef}
          title="Expert web"
          mode="expert"
          options={options}
          searchTiers={searchTiers}
          initial={ew}
          onSave={(next: WebPickerValue) => {
            update.mutate({ expertWeb: next });
            setWebOpen(false);
          }}
        />
      </>
    );
  })();

  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: '"Ask an Expert"' }]}
      back="/app/settings"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-6 px-4 pb-8 pt-2">
        <section className="flex flex-col gap-2">
          <p className="text-[11px] text-paper-soft">
            When you tap "Ask an expert", the active model delegates your question to this model for
            a stronger answer. One global choice — applies across all personas.
          </p>
          <p className="text-[11px] text-paper-soft">
            Only the sanitised question you see in the pill leaves your device — never your
            conversation, persona, or personal details.
          </p>
          <ModelSlotPicker
            label="Expert model"
            emptyLabel="None — pick an expert model"
            filter="all"
            providers={rows}
            configuredTemplateIds={configuredTemplateIds}
            current={current}
            onSelect={(sel) =>
              update.mutate({ expertModel: `${sel.providerTemplateId}:${sel.upstreamSlug}` })
            }
            onClear={() => update.mutate({ expertModel: null })}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-display text-sm text-paper">Expert web access</h2>
          {expertWebBody}
        </section>
      </div>
    </PageScaffold>
  );
}
