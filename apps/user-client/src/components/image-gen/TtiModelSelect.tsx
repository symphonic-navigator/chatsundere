// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from 'react';
import type { PickerFamily } from './tti-picker-model.js';

interface Props {
  families: PickerFamily[];
  /** True when no image provider is usable at all (shows the empty-state copy). */
  noUsableProvider: boolean;
  onTapFamily: (family: PickerFamily) => void;
  onClear: () => void;
  hasSelection: boolean;
  disabled?: boolean;
}

/**
 * Family-first picker (spec §3.1): one button per family. Unusable families
 * stay visible (disabled over hidden); a tap on one explains why instead of
 * selecting. A stale family (saved offering's provider unusable) is greyed too
 * but stays tappable, so the tap can move to a usable variant. The selected
 * family is marked with aria-pressed.
 */
export function TtiModelSelect({
  families,
  noUsableProvider,
  onTapFamily,
  onClear,
  hasSelection,
  disabled = false,
}: Props): JSX.Element {
  const [explained, setExplained] = useState<string | null>(null);

  return (
    <div>
      {noUsableProvider ? (
        <p className="mb-2 rounded-md border border-white/5 bg-white/[0.02] p-3 text-sm text-paper-soft">
          No image-capable provider configured yet — add one under Upstream Providers above to
          begin.
        </p>
      ) : null}
      <div className="flex items-start gap-2">
        <div className="flex flex-1 flex-wrap gap-1.5">
          {families.map((f) => (
            <button
              key={f.family}
              type="button"
              disabled={disabled}
              aria-pressed={f.selected}
              aria-disabled={f.usable ? undefined : true}
              onClick={() => {
                if (!f.usable) {
                  setExplained(`${f.family} — ${f.reason ?? 'unavailable'}.`);
                  return;
                }
                setExplained(null);
                onTapFamily(f);
              }}
              className={`rounded-md border px-3 py-2 text-left text-sm disabled:opacity-50 ${
                f.selected
                  ? 'border-paper/40 bg-white/[0.08] text-paper'
                  : 'border-white/5 bg-white/[0.02] text-paper-soft hover:bg-white/[0.04]'
              } ${f.usable && !f.stale ? '' : 'opacity-50'}`}
            >
              <span className="font-display">{f.family}</span>
            </button>
          ))}
        </div>
        {hasSelection ? (
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
      {explained ? <p className="mt-1.5 text-[11px] text-paper-soft">{explained}</p> : null}
    </div>
  );
}
