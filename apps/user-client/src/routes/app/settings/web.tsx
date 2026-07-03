// SPDX-License-Identifier: AGPL-3.0-only
import { aggregateServiceKinds } from '@chatsundere/llm-unified';
import { useRef, useState } from 'react';
import { WebPickerOverlay, type WebPickerValue } from '../../../components/WebPickerOverlay.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { PickerField } from '../../../components/ui/PickerField.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useSettings, useUpdateSettings } from '../../../data/settings.js';
import { useServerGate } from '../../../lib/server-gate.js';
import { useUsableTemplateIds } from '../../../lib/usable-providers.js';
import { webBackendOptions } from '../../../lib/web-backend-options.js';
import { webBackendSummary } from '../../../lib/web-backend-summary.js';

/** My Settings › Web Access — configure web search and fetch backends. */
export function SettingsWebPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings-web');
  const usable = useUsableTemplateIds();
  const settings = useSettings();
  const update = useUpdateSettings();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  const hasWeb = aggregateServiceKinds(usable).includes('web');
  const hasProxy = useServerGate('proxy').enabled;
  const options = webBackendOptions(usable, hasProxy);
  const wi = settings.data?.webInterfacing ?? { search: null, fetch: null };

  const body = (() => {
    if (!hasWeb) {
      return (
        <p className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-sm text-paper-soft">
          None of your providers offers web access yet — add a web-capable provider under AI
          Providers.
        </p>
      );
    }
    if (options.length === 0) {
      return (
        <p className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-sm text-paper-soft">
          Web search and fetch need a CORS proxy. Set one up under AI Providers to enable them.
        </p>
      );
    }
    return (
      <>
        <PickerField
          label="Web search & fetch"
          value={webBackendSummary(wi.search, wi.fetch, options)}
          onOpen={(el) => {
            triggerRef.current = el;
            setOpen(true);
          }}
        />
        <WebPickerOverlay
          open={open}
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
          title="Web search"
          mode="general"
          options={options}
          searchTiers={[]}
          initial={{ search: wi.search, fetch: wi.fetch, searchTierId: null }}
          onSave={(next: WebPickerValue) => {
            void update.mutateAsync({ webInterfacing: { search: next.search, fetch: next.fetch } });
            setOpen(false);
          }}
        />
      </>
    );
  })();

  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'Web Access' }]}
      back="/app/settings"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-3 px-4 pb-8 pt-2">{body}</div>
    </PageScaffold>
  );
}
