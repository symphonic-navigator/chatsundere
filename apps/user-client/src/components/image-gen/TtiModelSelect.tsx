// SPDX-License-Identifier: AGPL-3.0-only

import { type TtiGroupId, getProvider, listTtiOfferings } from '@chatsundere/llm-unified';

export interface TtiSelection {
  ref: string;
  groupId: TtiGroupId;
}

interface Props {
  /** Template ids of usable providers (enabled + working route). */
  usableTemplateIds: string[];
  /** Stored "providerId:upstreamSlug" ref; null = nothing chosen. */
  selectedRef: string | null;
  onSelect: (sel: TtiSelection) => void;
  onClear: () => void;
  /** Restrict the list to NSFW-capable offerings (the second slot). */
  nsfwOnly?: boolean;
  disabled?: boolean;
}

/**
 * Slim picker for TTI offerings. TTI models have no canonical entry, so this
 * is a flat one-button-per-offering list rather than the ModelPickerField
 * modal. Selection is marked via aria-pressed; a clear control resets to null.
 */
export function TtiModelSelect({
  usableTemplateIds,
  selectedRef,
  onSelect,
  onClear,
  nsfwOnly = false,
  disabled = false,
}: Props): JSX.Element {
  const options = listTtiOfferings().flatMap((o) => {
    const tti = o.tti;
    if (!tti) return [];
    if (!usableTemplateIds.includes(o.providerId)) return [];
    if (nsfwOnly && !tti.canDoNsfw) return [];
    return [
      {
        ref: `${o.providerId}:${o.upstreamSlug}`,
        groupId: tti.groupId,
        modelName: tti.displayName,
        providerName: getProvider(o.providerId)?.displayName ?? o.providerId,
      },
    ];
  });

  if (options.length === 0) {
    return (
      <p className="rounded-md border border-white/5 bg-white/[0.02] p-3 text-sm text-paper-soft">
        No image-capable provider configured yet — add one under Upstream Providers above to begin.
      </p>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <div className="flex flex-1 flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.ref}
            type="button"
            disabled={disabled}
            aria-pressed={o.ref === selectedRef}
            onClick={() => onSelect({ ref: o.ref, groupId: o.groupId })}
            className={`rounded-md border px-3 py-2 text-left text-sm disabled:opacity-50 ${
              o.ref === selectedRef
                ? 'border-paper/40 bg-white/[0.08] text-paper'
                : 'border-white/5 bg-white/[0.02] text-paper-soft hover:bg-white/[0.04]'
            }`}
          >
            <span className="font-display">{o.modelName}</span>
            <span className="text-paper-soft"> · {o.providerName}</span>
          </button>
        ))}
      </div>
      {selectedRef !== null ? (
        <button
          type="button"
          aria-label="Clear selection"
          disabled={disabled}
          onClick={onClear}
          className="rounded-full p-2 text-paper-soft hover:text-paper disabled:opacity-50"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
