// SPDX-License-Identifier: AGPL-3.0-only
import type { WebTrait } from '@chatsundere/llm-unified';
import type { WebBackendOption } from '../lib/web-backend-options.js';
import { type WebBackendSetting, resolveWebBackend } from '../lib/web-backends.js';

interface WebInterfacingValue {
  search: WebBackendSetting;
  fetch: WebBackendSetting;
}
interface Props {
  options: WebBackendOption[];
  search: WebBackendSetting;
  fetch: WebBackendSetting;
  onChange: (next: WebInterfacingValue) => void;
}

const TRAIT_LABEL: Record<WebTrait, string> = {
  recommended: 'Recommended',
  ai: 'AI',
  neural: 'Neural',
  privacy: 'Privacy',
};

const keyOf = (o: { providerId: string; upstreamSlug: string }): string =>
  `${o.providerId}::${o.upstreamSlug}`;

/** "Brave (nano-gpt)" for a search engine, plain "nano-gpt" when the backend
 *  name already is the provider (the scrape fetch backend). */
const displayName = (o: WebBackendOption): string =>
  o.label === o.providerName ? o.label : `${o.label} (${o.providerName})`;

// Picker value encoding: '' = Off (explicit), else the backend key. There is no
// abstract "Default" entry — an unset setting shows the auto-picked recommended
// backend as a concrete, selected option.
function valueToSetting(v: string): WebBackendSetting {
  if (v === '') return 'off';
  const [providerId, upstreamSlug] = v.split('::');
  return providerId && upstreamSlug ? { providerId, upstreamSlug } : 'off';
}

function Picker({
  id,
  kind,
  options,
  setting,
  onChange,
}: {
  id: string;
  kind: 'search' | 'fetch';
  options: WebBackendOption[];
  setting: WebBackendSetting;
  onChange: (s: WebBackendSetting) => void;
}): JSX.Element {
  const effective = resolveWebBackend(setting, options, kind);
  // Only the backends that can serve THIS role (search backends in the search
  // picker, fetch backends in the fetch picker) — not the whole web catalogue.
  const roleOptions = options.filter((o) => (kind === 'search' ? o.canSearch : o.canFetch));
  const effectiveOption = effective
    ? roleOptions.find(
        (o) => o.providerId === effective.providerId && o.upstreamSlug === effective.upstreamSlug,
      )
    : undefined;
  // 'off' → empty; otherwise show the effective backend (the user's pick, or the
  // auto-default when unset) as the selected concrete option.
  const value = setting === 'off' || !effective ? '' : keyOf(effective);
  return (
    <div className="web-picker">
      <div className="web-select-wrap">
        <select
          id={id}
          className="web-select"
          value={value}
          onChange={(e) => onChange(valueToSetting(e.target.value))}
        >
          {roleOptions.map((o) => (
            <option key={keyOf(o)} value={keyOf(o)}>
              {displayName(o)}
            </option>
          ))}
          <option value="">Off</option>
        </select>
      </div>
      {effectiveOption && effectiveOption.traits.length > 0 ? (
        <span className="web-traits">
          {effectiveOption.traits.map((t) => (
            <span key={t} className="web-trait-pill">
              {TRAIT_LABEL[t]}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Web-interfacing settings: two independent pickers (search + fetch). Each lists
 * the concrete backends that can serve its role and the auto-picked recommended
 * backend is pre-selected (no abstract "Default" entry); "Off" disables the
 * role. Trait badges describe the effective choice. Mounted only when the `web`
 * modality is available (the caller gates it).
 */
export function WebInterfacingSection({ options, search, fetch, onChange }: Props): JSX.Element {
  return (
    <div className="web-interfacing">
      <p className="web-zk-note">
        Search queries and fetched pages leave your device and are sent to the chosen provider via
        your proxy.
      </p>

      <div className="web-field">
        <label htmlFor="web-search-backend">Search backend</label>
        <Picker
          id="web-search-backend"
          kind="search"
          options={options}
          setting={search}
          onChange={(s) => onChange({ search: s, fetch })}
        />
      </div>

      <div className="web-field">
        <label htmlFor="web-fetch-backend">Fetch backend</label>
        <Picker
          id="web-fetch-backend"
          kind="fetch"
          options={options}
          setting={fetch}
          onChange={(s) => onChange({ search, fetch: s })}
        />
      </div>
    </div>
  );
}
