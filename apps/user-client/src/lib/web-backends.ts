// SPDX-License-Identifier: AGPL-3.0-only
import type { OfferingRef } from '../integrations/types.js';
import type { WebBackendOption } from './web-backend-options.js';

/** Stored web-backend setting: an explicit ref, explicit `'off'`, or `null` =
 *  unset (→ recommended default once the modality is available). */
export type WebBackendSetting = OfferingRef | 'off' | null;

const canRole = (o: WebBackendOption, role: 'search' | 'fetch'): boolean =>
  role === 'search' ? o.canSearch : o.canFetch;

const refOf = (o: WebBackendOption): OfferingRef => ({
  providerId: o.providerId,
  upstreamSlug: o.upstreamSlug,
});

/** Resolve a stored setting against the currently available options into the
 *  effective backend (`null` = off / unavailable). The recommended default is
 *  the first option that can serve the role (offerings are freedom-first
 *  ordered, with Linkup first for search). */
export function resolveWebBackend(
  setting: WebBackendSetting,
  options: WebBackendOption[],
  role: 'search' | 'fetch',
): OfferingRef | null {
  const usable = options.filter((o) => canRole(o, role));
  if (setting === 'off') return null;
  if (setting === null) return usable[0] ? refOf(usable[0]) : null;
  const match = usable.find(
    (o) => o.providerId === setting.providerId && o.upstreamSlug === setting.upstreamSlug,
  );
  return match ? refOf(match) : null;
}
