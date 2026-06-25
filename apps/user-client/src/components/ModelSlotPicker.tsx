// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';
import type { ProviderRow } from '../boot/client-data-db.js';
import { ModelPickerOverlay } from './ModelPickerOverlay.js';
import {
  type ModelFilter,
  type ModelSelection,
  buildPickerData,
} from './model-picker/model-picker-data.js';
import { PickerField } from './ui/PickerField.js';

export interface ModelSlotPickerProps {
  label: string;
  emptyLabel: string;
  filter?: ModelFilter;
  providers: ProviderRow[];
  configuredTemplateIds: string[];
  current: { providerTemplateId: string; upstreamSlug: string } | null;
  onSelect: (sel: ModelSelection) => void;
  onClear?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  stale?: { reason: React.ReactNode };
}

/** Resolve the display name for the currently selected model by searching the
 *  picker data. Falls back to `upstreamSlug` when the model is no longer
 *  reachable (provider removed, key expired). */
function resolveDisplayName(
  current: { providerTemplateId: string; upstreamSlug: string },
  providers: ProviderRow[],
  configuredTemplateIds: string[],
  filter: ModelFilter,
): string {
  const { groups } = buildPickerData(providers, configuredTemplateIds, filter);
  for (const group of groups) {
    for (const model of group.models) {
      const matched = model.offers.some(
        (o) =>
          o.offering.providerId === current.providerTemplateId &&
          o.offering.upstreamSlug === current.upstreamSlug,
      );
      if (matched) return model.canonical.displayName;
    }
  }
  return current.upstreamSlug;
}

/**
 * One model slot: a PickerField trigger that opens the two-step
 * `ModelPickerOverlay` (spec §7/§8). When a model is set and `onClear` is given,
 * a quiet "Use none" control turns the slot off (disabled-over-hidden — the
 * capability stays visible). The vision filter is call-site-locked.
 */
export function ModelSlotPicker({
  label,
  emptyLabel,
  filter = 'all',
  providers,
  configuredTemplateIds,
  current,
  onSelect,
  onClear,
  disabled,
  disabledReason,
  stale,
}: ModelSlotPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  const displayName = current
    ? resolveDisplayName(current, providers, configuredTemplateIds, filter)
    : null;

  return (
    <div className="flex flex-col gap-1">
      <PickerField
        label={label}
        value={displayName ?? <span className="text-paper-soft">{emptyLabel}</span>}
        stale={stale}
        disabled={disabled}
        disabledReason={disabledReason}
        onOpen={(el) => {
          triggerRef.current = el;
          setOpen(true);
        }}
      />
      {current && onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="self-start text-[11px] text-paper-soft underline hover:text-paper"
        >
          Use none
        </button>
      ) : null}
      <ModelPickerOverlay
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(sel) => {
          onSelect(sel);
          setOpen(false);
        }}
        providers={providers}
        configuredTemplateIds={configuredTemplateIds}
        filter={filter}
        current={current}
        triggerRef={triggerRef}
      />
    </div>
  );
}
