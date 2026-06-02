// SPDX-License-Identifier: AGPL-3.0-only
import type { OfferingRef } from '../integrations/types.js';
import type { WebBackendOption } from '../lib/web-backend-options.js';

interface WebInterfacingValue {
  search: OfferingRef | null;
  fetch: OfferingRef | null;
}

interface Props {
  options: WebBackendOption[];
  search: OfferingRef | null;
  fetch: OfferingRef | null;
  onChange: (next: WebInterfacingValue) => void;
}

const keyOf = (o: { providerId: string; upstreamSlug: string }): string =>
  `${o.providerId}::${o.upstreamSlug}`;

const refFromKey = (key: string): OfferingRef | null => {
  if (!key) return null;
  const [providerId, upstreamSlug] = key.split('::');
  return providerId && upstreamSlug ? { providerId, upstreamSlug } : null;
};

const labelFor = (o: WebBackendOption): string =>
  `${o.providerName} · ${o.upstreamSlug} (${o.qualityClass})`;

/**
 * Functional (unstyled) web-interfacing settings: two independent pickers for
 * the search and fetch backends. A backend that cannot serve a role is shown
 * disabled (disabled-over-hidden) with a title hint. Visibility of the whole
 * section is gated by the caller (only mounted when the `web` modality is lit).
 */
export function WebInterfacingSection({ options, search, fetch, onChange }: Props): JSX.Element {
  return (
    <section aria-label="Web interfacing">
      <h3>Web</h3>

      <label htmlFor="web-search-backend">Search backend</label>
      <select
        id="web-search-backend"
        value={search ? keyOf(search) : ''}
        onChange={(e) => onChange({ search: refFromKey(e.target.value), fetch })}
      >
        <option value="">None</option>
        {options.map((o) => (
          <option
            key={keyOf(o)}
            value={keyOf(o)}
            disabled={!o.canSearch}
            title={o.canSearch ? undefined : 'This backend cannot search'}
          >
            {labelFor(o)}
          </option>
        ))}
      </select>

      <label htmlFor="web-fetch-backend">Fetch backend</label>
      <select
        id="web-fetch-backend"
        value={fetch ? keyOf(fetch) : ''}
        onChange={(e) => onChange({ search, fetch: refFromKey(e.target.value) })}
      >
        <option value="">None</option>
        {options.map((o) => (
          <option
            key={keyOf(o)}
            value={keyOf(o)}
            disabled={!o.canFetch}
            title={o.canFetch ? undefined : 'This backend cannot fetch'}
          >
            {labelFor(o)}
          </option>
        ))}
      </select>
    </section>
  );
}
