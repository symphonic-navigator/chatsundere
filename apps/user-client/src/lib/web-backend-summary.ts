// SPDX-License-Identifier: AGPL-3.0-only
import type { WebBackendOption } from './web-backend-options.js';
import { type WebBackendSetting, resolveWebBackend } from './web-backends.js';

/** Friendly display name matching the picker's own rendering logic. */
const optionDisplayName = (o: WebBackendOption): string =>
  o.label === o.providerName ? o.label : `${o.label} (${o.providerName})`;

function sideLabel(
  setting: WebBackendSetting,
  role: 'search' | 'fetch',
  options: WebBackendOption[],
): string {
  const ref = resolveWebBackend(setting, options, role);
  if (ref === null) return 'Off';
  const opt = options.find(
    (o) => o.providerId === ref.providerId && o.upstreamSlug === ref.upstreamSlug,
  );
  return opt ? optionDisplayName(opt) : 'Off';
}

/**
 * Produce a concise human-readable summary of the current web-backend settings
 * for display in a PickerField value. Returns `"Off"` when both sides are
 * inactive, otherwise `"Search: {name} · Fetch: {name}"` where either name may
 * be `"Off"` when that side is inactive.
 */
export function webBackendSummary(
  search: WebBackendSetting,
  fetch: WebBackendSetting,
  options: WebBackendOption[],
): string {
  const searchLabel = sideLabel(search, 'search', options);
  const fetchLabel = sideLabel(fetch, 'fetch', options);
  if (searchLabel === 'Off' && fetchLabel === 'Off') return 'Off';
  return `Search: ${searchLabel} · Fetch: ${fetchLabel}`;
}
