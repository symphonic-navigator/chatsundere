// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider, providerServiceKinds } from '@chatsundere/llm-unified';
import { useId } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BUILT_IN_PROVIDERS, type ProviderTemplateId } from '../lib/built-in-providers.js';
import { type ServerGate, useServerGate } from '../lib/server-gate.js';
import { CapBadgeRow } from './CapBadgeRow.js';

/** Sort key: freedom-oriented first, then provider sortPriority. */
function rankKey(id: string): [number, number] {
  const defn = getProvider(id);
  const freedom = defn?.offerings.some((o) => o.freedomOrientedDeployment === true) ? 0 : 1;
  return [freedom, defn?.sortPriority ?? Number.MAX_SAFE_INTEGER];
}

/** Heading, per-row tag and whether server linking fixes it, by the gate's reason. */
function gatedCopy(gate: ServerGate): { heading: string; tag: string; linkable: boolean } {
  switch (gate.reason) {
    case 'local-only':
      return { heading: 'Need a linked server', tag: 'Needs a linked server', linkable: true };
    case 'offline':
      return {
        heading: "Your server can't be reached right now",
        tag: 'Server unreachable',
        linkable: false,
      };
    case 'feature-missing':
      return { heading: 'Your server has no relay', tag: 'No relay', linkable: false };
    default:
      return {
        heading: gate.tooltip ?? "Your server's relay is unavailable",
        tag: 'Unavailable',
        linkable: false,
      };
  }
}

/** The "Add a provider" sheet: available providers first, relay-gated ones grouped at the end. */
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
  const location = useLocation();
  // Server linking's Back brings the user to this list (its own `?return=` intact).
  const linkingTo = `/app/account/server-linking?return=${encodeURIComponent(
    `${location.pathname}${location.search}`,
  )}`;
  const configured = new Set(configuredTemplateIds);
  const candidates = BUILT_IN_PROVIDERS.filter((b) => !configured.has(b.id)).sort((a, b) => {
    const [fa, pa] = rankKey(a.id);
    const [fb, pb] = rankKey(b.id);
    return fa - fb || pa - pb;
  });
  const isGated = (id: string): boolean =>
    !hasProxy && getProvider(id)?.corsHint === 'requires-proxy';
  const available = candidates.filter((b) => !isGated(b.id));
  const gated = candidates.filter((b) => isGated(b.id));
  const gatedText = gatedCopy(proxyGate);
  // The row's aria-label is the provider name alone, so its reason reaches
  // assistive tech through the group heading.
  const gatedHeadingId = useId();

  function row(b: (typeof candidates)[number], blocked: boolean): JSX.Element {
    return (
      <button
        key={b.id}
        type="button"
        aria-label={b.name}
        disabled={blocked}
        aria-describedby={blocked ? gatedHeadingId : undefined}
        title={blocked ? (proxyGate.tooltip ?? undefined) : undefined}
        onClick={() => !blocked && onPick(b.id)}
        className="flex w-full items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04] disabled:opacity-50"
      >
        <div className="grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper">
          {b.monogram}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-sm text-paper">{b.name}</span>
            {blocked ? (
              <span className="rounded bg-white/5 px-1.5 font-mono text-[10px] text-paper-soft">
                {gatedText.tag}
              </span>
            ) : null}
          </div>
          <div className="mt-1">
            <CapBadgeRow lit={providerServiceKinds(b.id)} />
          </div>
        </div>
      </button>
    );
  }

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
          {available.map((b) => row(b, false))}
          {gated.length > 0 ? (
            <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-3">
              <h3
                id={gatedHeadingId}
                className="text-[11px] uppercase tracking-widest text-paper-soft"
              >
                {gatedText.heading}
              </h3>
              {gatedText.linkable ? (
                <Link
                  to={linkingTo}
                  onClick={onClose}
                  className="block text-[11px] text-aurora-200 underline"
                >
                  Open server linking →
                </Link>
              ) : null}
              {gated.map((b) => row(b, true))}
            </div>
          ) : null}
          {candidates.length === 0 ? (
            <p className="text-[11px] text-paper-soft">All providers are already added.</p>
          ) : null}
        </div>
      </div>
    </>
  );
}
