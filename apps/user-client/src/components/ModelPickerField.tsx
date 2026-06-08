// SPDX-License-Identifier: AGPL-3.0-only

import { getCanonical, getOffering, getProvider } from '@chatsundere/llm-unified';
import { useState } from 'react';
import type { ProviderRow } from '../boot/client-data-db.js';
import { ModelPickerModal } from './ModelPickerModal.js';
import type { ModelFilter, ModelSelection } from './model-picker/model-picker-data.js';

export interface ModelPickerFieldProps {
  providers: ProviderRow[];
  configuredTemplateIds: string[];
  filter?: ModelFilter;
  /** Current selection in provider-template-id space; null = nothing chosen. */
  current: { providerTemplateId: string; upstreamSlug: string } | null;
  onSelect: (sel: ModelSelection) => void;
  /** When provided and a selection exists, a Clear control appears. */
  onClear?: () => void;
  onBrowseProviders?: () => void;
  /** Label shown on the trigger when nothing is selected (e.g. "Choose a model"). */
  emptyLabel: string;
}

export function ModelPickerField({
  providers,
  configuredTemplateIds,
  filter = 'all',
  current,
  onSelect,
  onClear,
  onBrowseProviders,
  emptyLabel,
}: ModelPickerFieldProps): JSX.Element {
  const [open, setOpen] = useState(false);

  let label = emptyLabel;
  let stale = false;
  if (current) {
    const offering = getOffering(current.providerTemplateId, current.upstreamSlug);
    const stillConfigured = providers.some(
      (p) => p.enabled && p.templateId === current.providerTemplateId,
    );
    if (offering && stillConfigured) {
      const canon = offering.canonicalRef ? getCanonical(offering.canonicalRef) : undefined;
      const prov = getProvider(current.providerTemplateId);
      label = `${canon?.displayName ?? offering.upstreamSlug} · ${prov?.displayName ?? current.providerTemplateId}`;
    } else {
      // Constructive stale state: name a provider the user could add to regain
      // the model, rather than leaving them at a dead end (the *dere* half).
      stale = true;
      const provName = getProvider(current.providerTemplateId)?.displayName;
      label = provName
        ? `Currently unavailable — add ${provName} or pick another model`
        : 'Currently unavailable — pick another model';
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex flex-1 items-center justify-between gap-3 rounded-md border p-3 text-left ${
          stale
            ? 'border-danger/30 bg-danger/[0.04]'
            : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
        }`}
      >
        <span className={`font-display text-sm ${stale ? 'text-danger' : 'text-paper'}`}>
          {label}
        </span>
        <span aria-hidden className="text-paper-soft">
          ›
        </span>
      </button>
      {onClear && current ? (
        <button
          type="button"
          aria-label="Clear selection"
          onClick={onClear}
          className="rounded-full p-2 text-paper-soft hover:text-paper"
        >
          ×
        </button>
      ) : null}
      <ModelPickerModal
        open={open}
        onClose={() => setOpen(false)}
        onSelect={onSelect}
        providers={providers}
        configuredTemplateIds={configuredTemplateIds}
        filter={filter}
        current={current}
        onBrowseProviders={onBrowseProviders}
      />
    </div>
  );
}
