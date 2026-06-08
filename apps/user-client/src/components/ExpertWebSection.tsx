// SPDX-License-Identifier: AGPL-3.0-only
import type { SearchTier } from '@chatsundere/llm-unified';
import { pickExpertFetchRef, pickExpertSearchRef } from '../lib/resolve-expert-web.js';
import type { WebBackendOption } from '../lib/web-backend-options.js';
import type { WebBackendSetting } from '../lib/web-backends.js';

export interface ExpertWebValue {
  search: WebBackendSetting;
  fetch: WebBackendSetting;
  searchTierId: string | null;
}

interface Props {
  options: WebBackendOption[];
  value: ExpertWebValue;
  searchTiers: SearchTier[];
  onChange: (next: ExpertWebValue) => void;
}

const keyOf = (o: { providerId: string; upstreamSlug: string }): string =>
  `${o.providerId}::${o.upstreamSlug}`;

/** "Exa (nano-gpt)" when label differs from provider name; plain label otherwise. */
const displayName = (o: WebBackendOption): string =>
  o.label === o.providerName ? o.label : `${o.label} (${o.providerName})`;

function settingFromValue(v: string): WebBackendSetting {
  if (v === '') return 'off';
  const [providerId, upstreamSlug] = v.split('::');
  return providerId && upstreamSlug ? { providerId, upstreamSlug } : 'off';
}

function BackendSelect({
  id,
  kind,
  options,
  effectiveKey,
  onChange,
}: {
  id: string;
  kind: 'search' | 'fetch';
  options: WebBackendOption[];
  effectiveKey: string;
  onChange: (s: WebBackendSetting) => void;
}): JSX.Element {
  const roleOptions = options.filter((o) => (kind === 'search' ? o.canSearch : o.canFetch));
  return (
    <div className="web-select-wrap">
      <select
        id={id}
        className="web-select"
        value={effectiveKey}
        onChange={(e) => onChange(settingFromValue(e.target.value))}
      >
        {roleOptions.map((o) => (
          <option key={keyOf(o)} value={keyOf(o)}>
            {displayName(o)}
          </option>
        ))}
        <option value="">Off</option>
      </select>
    </div>
  );
}

/**
 * Settings for the expert uplink's own web access: search/fetch backend pickers
 * and a search-depth picker. The displayed effective backend uses the expert's
 * exa-preference (`pickExpert*Ref`) so the UI matches what actually runs. Pure —
 * the data wrapper supplies `searchTiers` (derived from the effective backend).
 */
export function ExpertWebSection({ options, value, searchTiers, onChange }: Props): JSX.Element {
  const searchRef = pickExpertSearchRef(value.search, options);
  const fetchRef = pickExpertFetchRef(value.fetch, options);
  const searchKey = value.search === 'off' || !searchRef ? '' : keyOf(searchRef);
  const fetchKey = value.fetch === 'off' || !fetchRef ? '' : keyOf(fetchRef);
  const defaultTierId = searchTiers.find((t) => t.id === 'neural')?.id ?? searchTiers[0]?.id ?? '';
  const selectedTier = value.searchTierId ?? defaultTierId;

  return (
    <div className="expert-web">
      <p className="web-zk-note">
        The expert&apos;s web queries and fetched pages leave your device and are sent to the chosen
        provider via your proxy.
      </p>

      <div className="web-field">
        <label htmlFor="expert-web-search">Search backend</label>
        <BackendSelect
          id="expert-web-search"
          kind="search"
          options={options}
          effectiveKey={searchKey}
          onChange={(s) => onChange({ ...value, search: s })}
        />
      </div>

      <div className="web-field">
        <label htmlFor="expert-web-depth">Search depth</label>
        <div className="web-select-wrap">
          <select
            id="expert-web-depth"
            className="web-select"
            disabled={searchTiers.length === 0}
            value={selectedTier}
            onChange={(e) => onChange({ ...value, searchTierId: e.target.value || null })}
          >
            {searchTiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="web-field">
        <label htmlFor="expert-web-fetch">Fetch backend</label>
        <BackendSelect
          id="expert-web-fetch"
          kind="fetch"
          options={options}
          effectiveKey={fetchKey}
          onChange={(s) => onChange({ ...value, fetch: s })}
        />
      </div>
    </div>
  );
}
