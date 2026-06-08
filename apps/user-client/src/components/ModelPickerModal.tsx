// SPDX-License-Identifier: AGPL-3.0-only

import { effectiveFreedom } from '@chatsundere/llm-unified';
import { useEffect, useMemo, useState } from 'react';
import type { ProviderRow } from '../boot/client-data-db.js';
import { FreedomBadge, JurisdictionBadge, TrustBadge } from './ModelTrustBadges.js';
import {
  type ModelFilter,
  type ModelSelection,
  type PickerModel,
  buildPickerData,
  filterGroupsByQuery,
} from './model-picker/model-picker-data.js';

export interface ModelPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (sel: ModelSelection) => void;
  providers: ProviderRow[];
  configuredTemplateIds: string[];
  filter?: ModelFilter;
  /** Marks the active deployment with a check, in provider-template-id space. */
  current?: { providerTemplateId: string; upstreamSlug: string } | null;
  onBrowseProviders?: () => void;
}

export function ModelPickerModal({
  open,
  onClose,
  onSelect,
  providers,
  configuredTemplateIds,
  filter = 'all',
  current,
  onBrowseProviders,
}: ModelPickerModalProps): JSX.Element | null {
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState('');
  const [activeCanonicalId, setActiveCanonicalId] = useState<string | null>(null);

  // Fresh state every time the sheet opens.
  useEffect(() => {
    if (open) {
      setClosing(false);
      setQuery('');
      setActiveCanonicalId(null);
    }
  }, [open]);

  // Escape closes (with the out-animation) while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setClosing(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // The out-animation drives the unmount via `onAnimationEnd`, but guarantee the
  // close still completes if that event never fires — e.g. a reduced-motion rule
  // disables the animation. Without this fallback the sheet would wedge open.
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => {
      setClosing(false);
      onClose();
    }, 260);
    return () => clearTimeout(t);
  }, [closing, onClose]);

  const data = useMemo(
    () => buildPickerData(providers, configuredTemplateIds, filter),
    [providers, configuredTemplateIds, filter],
  );
  const visibleGroups = useMemo(
    () => filterGroupsByQuery(data.groups, query),
    [data.groups, query],
  );

  const activeModel: PickerModel | null = useMemo(() => {
    if (!activeCanonicalId) return null;
    for (const g of data.groups) {
      const m = g.models.find((x) => x.canonical.id === activeCanonicalId);
      if (m) return m;
    }
    return null;
  }, [data.groups, activeCanonicalId]);

  if (!open && !closing) return null;

  const requestClose = (): void => setClosing(true);

  const onSheetAnimationEnd = (): void => {
    if (closing) {
      setClosing(false);
      onClose();
    }
  };

  const pick = (model: PickerModel, offerIndex: number): void => {
    const o = model.offers[offerIndex];
    if (!o) return;
    onSelect({
      canonicalId: model.canonical.id,
      providerTemplateId: o.offering.providerId,
      providerRowId: o.providerRowId,
      upstreamSlug: o.offering.upstreamSlug,
    });
    requestClose();
  };

  return (
    <>
      <div
        data-app-backdrop
        className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm"
        style={{
          animation: `${closing ? 'picker-backdrop-out' : 'picker-backdrop-in'} 200ms ease forwards`,
        }}
        onClick={requestClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') requestClose();
        }}
        role="button"
        tabIndex={-1}
        aria-label="Dismiss"
      />
      <div
        data-app-sheet
        className="fixed inset-x-0 bottom-0 z-30 flex max-h-[80vh] flex-col rounded-t-2xl border-t border-white/10 bg-ink shadow-2xl"
        style={{
          animation: `${closing ? 'picker-sheet-out 200ms ease-in' : 'picker-sheet-in 240ms cubic-bezier(0.16, 1, 0.3, 1)'} forwards`,
        }}
        onAnimationEnd={onSheetAnimationEnd}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-4 pb-2">
          {activeModel ? (
            <button
              type="button"
              aria-label="Back to models"
              onClick={() => setActiveCanonicalId(null)}
              className="flex items-center gap-2 font-display text-sm text-paper"
            >
              <span aria-hidden className="text-paper-soft">
                ‹
              </span>
              {activeModel.canonical.displayName}
            </button>
          ) : (
            <span className="font-display text-sm text-paper">Choose a model</span>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={requestClose}
            className="rounded-full p-1 text-paper-soft hover:text-paper"
          >
            ×
          </button>
        </div>

        {/* Step 1: model list (with sticky search) */}
        {!activeModel ? (
          <>
            <div className="sticky top-0 z-10 bg-ink px-4 pb-3">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models"
                aria-label="Search models"
                className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-paper placeholder:text-paper-soft/60 focus:border-white/20 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4">
              {visibleGroups.length === 0 ? (
                <EmptyState hiddenCount={data.hiddenCount} onBrowseProviders={onBrowseProviders} />
              ) : (
                visibleGroups.map((g) => (
                  <div key={g.family} className="flex flex-col gap-2">
                    <div className="text-[11px] uppercase tracking-wider text-paper-soft/70">
                      {g.family}
                    </div>
                    {g.models.map((m) => (
                      <button
                        key={m.canonical.id}
                        type="button"
                        onClick={() => setActiveCanonicalId(m.canonical.id)}
                        className="flex items-center justify-between gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04]"
                      >
                        <div className="font-display text-sm text-paper">
                          {m.canonical.displayName}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-paper-soft">
                          {m.teeAvailable ? <TrustBadge kind="tee" /> : null}
                          {m.zdrAvailable ? <TrustBadge kind="zdr" /> : null}
                          <span>
                            {m.offers.length} provider{m.offers.length === 1 ? '' : 's'}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          /* Step 2: provider list for the chosen model */
          <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-4">
            {activeModel.offers.map((po, i) => {
              const o = po.offering;
              const isActive =
                current?.providerTemplateId === o.providerId &&
                current?.upstreamSlug === o.upstreamSlug;
              return (
                <button
                  key={`${o.providerId}:${o.upstreamSlug}`}
                  type="button"
                  onClick={() => pick(activeModel, i)}
                  className={`flex items-center justify-between gap-3 rounded-md border p-3 text-left ${
                    isActive
                      ? 'border-paper bg-white/[0.04]'
                      : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm text-paper">
                        {po.providerDisplayName}
                      </span>
                      {o.trust.tee ? <TrustBadge kind="tee" /> : null}
                      {o.trust.zdr ? <TrustBadge kind="zdr" /> : null}
                      {o.trust.jurisdiction ? (
                        <JurisdictionBadge code={o.trust.jurisdiction} />
                      ) : null}
                      <FreedomBadge
                        state={effectiveFreedom(
                          activeModel.canonical.freedomOriented,
                          o.freedomOrientedDeployment,
                        )}
                      />
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-paper-soft">
                      <span>{o.context.recommended.toLocaleString()} ctx</span>
                      <span className="flex gap-1">
                        {o.profile.toolCalls.supported ? (
                          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-paper-soft">
                            Tools
                          </span>
                        ) : null}
                        {o.profile.vision ? (
                          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-paper-soft">
                            Vision
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </div>
                  {isActive ? <span>✓</span> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function EmptyState({
  hiddenCount,
  onBrowseProviders,
}: {
  hiddenCount: number;
  onBrowseProviders?: () => void;
}): JSX.Element {
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-center">
      <p className="text-sm text-paper-soft">
        {hiddenCount > 0
          ? `${hiddenCount} model${hiddenCount === 1 ? '' : 's'} unlock once you add a provider.`
          : 'No models match your search.'}
      </p>
      {hiddenCount > 0 && onBrowseProviders ? (
        <button
          type="button"
          onClick={onBrowseProviders}
          className="mt-2 text-[11px] text-aurora-200 underline"
        >
          Add a provider → My Settings
        </button>
      ) : null}
    </div>
  );
}
