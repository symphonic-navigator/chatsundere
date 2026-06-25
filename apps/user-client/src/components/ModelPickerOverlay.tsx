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
import { PickerOverlay } from './ui/PickerOverlay.js';

export interface ModelPickerOverlayProps {
  open: boolean;
  onClose: () => void;
  onSelect: (sel: ModelSelection) => void;
  providers: ProviderRow[];
  configuredTemplateIds: string[];
  filter?: ModelFilter;
  /** Marks the active deployment with a check, in provider-template-id space. */
  current?: { providerTemplateId: string; upstreamSlug: string } | null;
  onBrowseProviders?: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Two-step model → provider picker rehoused in `PickerOverlay`. No Save button;
 * auto-closes on provider tap. `‹` steps from the provider list back to the model
 * list; on the model step it dismisses.
 */
export function ModelPickerOverlay({
  open,
  onClose,
  onSelect,
  providers,
  configuredTemplateIds,
  filter = 'all',
  current,
  onBrowseProviders,
  triggerRef,
}: ModelPickerOverlayProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [activeCanonicalId, setActiveCanonicalId] = useState<string | null>(null);

  // Fresh state every time the sheet opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveCanonicalId(null);
    }
  }, [open]);

  const pickerData = useMemo(
    () => buildPickerData(providers, configuredTemplateIds, filter),
    [providers, configuredTemplateIds, filter],
  );
  const visibleGroups = useMemo(
    () => filterGroupsByQuery(pickerData.groups, query),
    [pickerData.groups, query],
  );

  const activeModel: PickerModel | null = useMemo(() => {
    if (!activeCanonicalId) return null;
    for (const g of pickerData.groups) {
      const m = g.models.find((x) => x.canonical.id === activeCanonicalId);
      if (m) return m;
    }
    return null;
  }, [pickerData.groups, activeCanonicalId]);

  const pick = (model: PickerModel, offerIndex: number): void => {
    const o = model.offers[offerIndex];
    if (!o) return;
    onSelect({
      canonicalId: model.canonical.id,
      providerTemplateId: o.offering.providerId,
      providerRowId: o.providerRowId,
      upstreamSlug: o.offering.upstreamSlug,
    });
    onClose();
  };

  return (
    <PickerOverlay
      open={open}
      title="Choose a model"
      onClose={onClose}
      onBack={activeCanonicalId ? () => setActiveCanonicalId(null) : undefined}
      triggerRef={triggerRef}
    >
      {/* Step 1: model list (with search) — lifted from ModelPickerModal.tsx:164-209 */}
      {!activeModel ? (
        <>
          <div className="px-4 pb-3">
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
              <EmptyState
                hiddenCount={pickerData.hiddenCount}
                filter={filter}
                onBrowseProviders={onBrowseProviders}
              />
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
        /* Step 2: provider list for the chosen model — lifted from ModelPickerModal.tsx:210-267 */
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
    </PickerOverlay>
  );
}

function EmptyState({
  hiddenCount,
  filter,
  onBrowseProviders,
}: {
  hiddenCount: number;
  filter: ModelFilter;
  onBrowseProviders?: () => void;
}): JSX.Element {
  const message =
    hiddenCount > 0 && filter === 'vision'
      ? 'No image-capable models available — add a provider that offers vision.'
      : hiddenCount > 0
        ? `${hiddenCount} model${hiddenCount === 1 ? '' : 's'} unlock once you add a provider.`
        : 'No models match your search.';
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-center">
      <p className="text-sm text-paper-soft">{message}</p>
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
