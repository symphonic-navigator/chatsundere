// SPDX-License-Identifier: AGPL-3.0-only
import {
  type ServiceKind,
  aggregateServiceKinds,
  getProvider,
  providerServiceKinds,
  providersContributing,
} from '@chatsundere/llm-unified';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AddProviderPicker } from '../../../components/AddProviderPicker.js';
import { CapBadgeRow } from '../../../components/CapBadgeRow.js';
import { CorsProxyBlock } from '../../../components/CorsProxyBlock.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useProviders } from '../../../data/providers.js';
import { useSettings } from '../../../data/settings.js';
import { BUILT_IN_PROVIDERS, type ProviderTemplateId } from '../../../lib/built-in-providers.js';
import { usableTemplateIds } from '../../../lib/usable-providers.js';

/** My Settings › AI Providers — proxy, capability summary, provider list, add. */
export function SettingsProvidersPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings-providers');
  const navigate = useNavigate();
  const providers = useProviders();
  const settings = useSettings();
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
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'AI Providers' }]}
      back="/app/settings"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-3 px-4 pb-8 pt-2">
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
                onClick={() => navigate(`/app/settings/providers/${row.templateId}`)}
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
            onPick={(id: ProviderTemplateId) => {
              setPicking(false);
              navigate(`/app/settings/providers/${id}`);
            }}
            onNeedProxy={() => setPicking(false)}
            onClose={() => setPicking(false)}
          />
        ) : null}
      </div>
    </PageScaffold>
  );
}
