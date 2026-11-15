// SPDX-License-Identifier: AGPL-3.0-only

import type { TtsVoice } from '@chatsundere/llm-unified';

/** Origin filter of the voice picker. */
export type OriginFilter = 'all' | 'own' | 'predefined';
/** Gender filter of the voice picker. */
export type GenderFilter = 'any' | 'female' | 'male';

/** The picker's search and filter state; the defaults are All / Any. */
export interface VoiceFilters {
  query: string;
  origin: OriginFilter;
  gender: GenderFilter;
}

/** Fresh filters: empty search, All / Any (spec §7.1, reset on every open). */
export const DEFAULT_VOICE_FILTERS: VoiceFilters = { query: '', origin: 'all', gender: 'any' };

/** True when the list carries ElevenLabs-style metadata (any `origin` set). */
export function hasVoiceMetadata(voices: readonly TtsVoice[]): boolean {
  return voices.some((v) => v.origin !== undefined);
}

/** Apply search (name and description, case-insensitive substring) and both filters. */
export function filterVoices(voices: readonly TtsVoice[], f: VoiceFilters): TtsVoice[] {
  const q = f.query.trim().toLowerCase();
  return voices.filter(
    (v) =>
      (f.origin === 'all' || v.origin === f.origin) &&
      (f.gender === 'any' || v.gender === f.gender) &&
      (q === '' ||
        v.name.toLowerCase().includes(q) ||
        (v.description?.toLowerCase().includes(q) ?? false)),
  );
}

const ORIGINS: ReadonlyArray<[OriginFilter, string]> = [
  ['all', 'All'],
  ['own', 'Own'],
  ['predefined', 'Predefined'],
];
const GENDERS: ReadonlyArray<[GenderFilter, string]> = [
  ['any', 'Any'],
  ['female', 'Female'],
  ['male', 'Male'],
];

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<[T, string]>;
  value: T;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div className="cs-segmented" role="tablist" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          data-active={value === key || undefined}
          className="cs-seg"
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

interface Props {
  filters: VoiceFilters;
  onChange: (next: VoiceFilters) => void;
}

/**
 * Search field and the Origin / Gender segmented filters above the voice list.
 * Deliberately not autofocused: the mobile keyboard would cover the list.
 */
export function VoiceFilterBar({ filters, onChange }: Props): JSX.Element {
  return (
    <div className="flex flex-col gap-2 border-b border-white/5 px-3 py-2">
      <input
        type="search"
        aria-label="Search voices"
        placeholder="Search voices…"
        value={filters.query}
        onChange={(e) => onChange({ ...filters, query: e.target.value })}
        className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-paper placeholder:text-paper-soft focus:border-paper-soft focus:outline-none"
      />
      <Segmented
        label="Origin"
        options={ORIGINS}
        value={filters.origin}
        onChange={(origin) => onChange({ ...filters, origin })}
      />
      <Segmented
        label="Gender"
        options={GENDERS}
        value={filters.gender}
        onChange={(gender) => onChange({ ...filters, gender })}
      />
    </div>
  );
}
