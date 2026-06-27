// SPDX-License-Identifier: AGPL-3.0-only
import type { TreasuryType } from '../../lib/treasury-filter.js';

interface Props {
  value: TreasuryType;
  onChange: (next: TreasuryType) => void;
}

const TABS: { value: TreasuryType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'app', label: 'Apps' },
  { value: 'doc', label: 'Docs' },
  { value: 'code', label: 'Code' },
  { value: 'image', label: 'Images' },
];

/** Segmented type filter for the Treasury (and the attach picker). */
export function TypeTabs({ value, onChange }: Props): JSX.Element {
  return (
    <div className="cs-segmented" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          className="cs-seg"
          data-active={value === t.value || undefined}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
