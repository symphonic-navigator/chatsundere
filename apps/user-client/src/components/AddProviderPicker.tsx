// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider, providerServiceKinds } from '@chatsundere/llm-unified';
import { Link } from 'react-router-dom';
import { BUILT_IN_PROVIDERS, type ProviderTemplateId } from '../lib/built-in-providers.js';
import { useServerGate } from '../lib/server-gate.js';
import { CapBadgeRow } from './CapBadgeRow.js';

/** Sort key: freedom-oriented first, then provider sortPriority. */
function rankKey(id: string): [number, number] {
  const defn = getProvider(id);
  const freedom = defn?.offerings.some((o) => o.freedomOrientedDeployment === true) ? 0 : 1;
  return [freedom, defn?.sortPriority ?? Number.MAX_SAFE_INTEGER];
}

export function AddProviderPicker({
  configuredTemplateIds,
  hasProxy,
  onPick,
  onClose,
}: {
  configuredTemplateIds: string[];
  hasProxy: boolean;
  onPick: (templateId: ProviderTemplateId) => void;
  onClose: () => void;
}): JSX.Element {
  const proxyGate = useServerGate('proxy');
  const configured = new Set(configuredTemplateIds);
  const candidates = BUILT_IN_PROVIDERS.filter((b) => !configured.has(b.id)).sort((a, b) => {
    const [fa, pa] = rankKey(a.id);
    const [fb, pb] = rankKey(b.id);
    return fa - fb || pa - pb;
  });

  return (
    <>
      <div
        data-app-backdrop
        className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        role="button"
        tabIndex={-1}
        aria-label="Dismiss"
      />
      <div
        data-app-sheet
        className="fixed inset-x-0 bottom-0 z-30 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-ink p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="font-display text-sm text-paper">Add a provider</span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-full p-1 text-paper-soft hover:text-paper"
          >
            ×
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {candidates.map((b) => {
            const needsProxy = getProvider(b.id)?.corsHint === 'requires-proxy';
            const blocked = needsProxy && !hasProxy;
            return (
              <div key={b.id}>
                <button
                  type="button"
                  aria-label={b.name}
                  disabled={blocked}
                  onClick={() => !blocked && onPick(b.id)}
                  className="flex w-full items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04] disabled:opacity-50"
                >
                  <div className="grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper">
                    {b.monogram}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-sm text-paper">{b.name}</div>
                    {blocked ? (
                      <div className="text-[11px] text-paper-soft">{proxyGate.tooltip}</div>
                    ) : null}
                    <div className="mt-1">
                      <CapBadgeRow lit={providerServiceKinds(b.id)} />
                    </div>
                  </div>
                </button>
                {blocked ? (
                  <Link
                    to="/app/account/server-linking"
                    onClick={onClose}
                    className="mt-1 ml-12 block text-[11px] text-aurora-200 underline"
                  >
                    Open server linking →
                  </Link>
                ) : null}
              </div>
            );
          })}
          {candidates.length === 0 ? (
            <p className="text-[11px] text-paper-soft">All providers are already added.</p>
          ) : null}
        </div>
      </div>
    </>
  );
}
