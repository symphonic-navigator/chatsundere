// SPDX-License-Identifier: AGPL-3.0-only
import {
  type ServiceKind,
  aggregateServiceKinds,
  getProvider,
  providerServiceKinds,
  providersContributing,
} from '@chatsundere/llm-unified';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AddProviderPicker } from '../../../components/AddProviderPicker.js';
import { CapBadgeRow } from '../../../components/CapBadgeRow.js';
import { ServerRelayStatus } from '../../../components/ServerRelayStatus.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { usePersonas } from '../../../data/personas.js';
import { useProviders } from '../../../data/providers.js';
import { BUILT_IN_PROVIDERS, type ProviderTemplateId } from '../../../lib/built-in-providers.js';
import { safeReturnPath } from '../../../lib/safe-return.js';
import { useServerGate } from '../../../lib/server-gate.js';
import { usableTemplateIds } from '../../../lib/usable-providers.js';
import { useFirstSyncPending } from '../../../sync/first-sync.js';

/** My Settings › AI Providers — proxy, capability summary, provider list, add. */
export function SettingsProvidersPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings-providers');
  const navigate = useNavigate();
  const location = useLocation();
  const [search] = useSearchParams();
  // The provider page's Back (and its post-save return) comes to this list
  // with its own `?return=` intact, so the list's Back still goes home.
  const here = encodeURIComponent(`${location.pathname}${location.search}`);
  const openProvider = (templateId: string): void =>
    navigate(`/app/settings/providers/${templateId}?return=${here}`);
  const providers = useProviders();
  const proxyGate = useServerGate('proxy');
  const [picking, setPicking] = useState(false);

  const rows = providers.data ?? [];
  const hasProxy = proxyGate.enabled;
  const usable = usableTemplateIds(rows, hasProxy);
  const lit = aggregateServiceKinds(usable);
  // Saving a key lands the user back here, so this is where they are ready for
  // the next step. Usable (not merely configured) chat providers only, so a
  // relay-only provider behind an unreachable server doesn't count; never while
  // a first sync may still bring personas in (that would invite a duplicate).
  const personas = usePersonas();
  const firstSyncPending = useFirstSyncPending();
  const showNextCard =
    usable.some((id) => providerServiceKinds(id).includes('llm')) &&
    personas.data !== undefined &&
    personas.data.length === 0 &&
    !firstSyncPending;

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
    if (needsProxy && !hasProxy) {
      switch (proxyGate.reason) {
        case 'local-only':
          return '✗ Needs a linked account';
        case 'offline':
          return '✗ Server unreachable';
        case 'feature-missing':
          return '✗ Server has no relay';
        default:
          return '✗ Unavailable';
      }
    }
    return '● Connected';
  }

  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'AI Providers' }]}
      back={safeReturnPath(search.get('return'), '/app/settings')}
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-3 px-4 pb-8 pt-2">
        {showNextCard ? (
          <Link
            to="/app/persona/new"
            className="rounded-md border border-gold/40 bg-gold/[0.06] p-4 font-display text-sm text-paper hover:bg-gold/[0.1]"
          >
            Next: create your first companion ›
          </Link>
        ) : null}
        <ServerRelayStatus />

        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-widest text-paper-soft">
            What you have
          </div>
          <CapBadgeRow lit={lit} tooltipFor={tooltipFor} />
        </div>

        {rows.length === 0 ? (
          <p className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-sm text-paper-soft">
            No AI providers yet. Add one so your companions can answer.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => openProvider(row.templateId)}
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
              openProvider(id);
            }}
            onClose={() => setPicking(false)}
          />
        ) : null}
      </div>
    </PageScaffold>
  );
}
