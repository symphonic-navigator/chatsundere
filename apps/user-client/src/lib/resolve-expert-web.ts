// SPDX-License-Identifier: AGPL-3.0-only
import {
  type WebContext,
  type WebInterfacingProvider,
  getOffering,
  resolveWebAdapter,
} from '@chatsundere/llm-unified';
import type { OfferingRef } from '../integrations/types.js';
import type { ResolvedFetch, ResolvedSearch } from '../integrations/web/build-web-tools.js';
import type { WebBackendOption } from './web-backend-options.js';
import { type WebBackendSetting, resolveWebBackend } from './web-backends.js';

const EXA_SLUG = 'web-exa';

/** Pure ref selection: honour an explicit pick / 'off'; on auto (null) prefer the
 *  exa backend when present, else fall back to resolveWebBackend's recommendation. */
export function pickExpertSearchRef(
  setting: WebBackendSetting,
  options: WebBackendOption[],
): OfferingRef | null {
  if (setting === 'off') return null;
  if (setting && typeof setting === 'object') return setting;
  const exa = options.find((o) => o.upstreamSlug === EXA_SLUG && o.canSearch);
  if (exa) return { providerId: exa.providerId, upstreamSlug: exa.upstreamSlug };
  return resolveWebBackend(null, options, 'search');
}

/** Pick the fetch ref: explicit / off / auto via resolveWebBackend. */
export function pickExpertFetchRef(
  setting: WebBackendSetting,
  options: WebBackendOption[],
): OfferingRef | null {
  if (setting === 'off') return null;
  if (setting && typeof setting === 'object') return setting;
  return resolveWebBackend(null, options, 'fetch');
}

export interface ResolvedExpertWeb {
  search: ResolvedSearch | null;
  fetch: ResolvedFetch | null;
  ctx: WebContext;
}

interface ResolveArgs {
  expertWeb: { search: WebBackendSetting; fetch: WebBackendSetting; searchTierId: string | null };
  options: WebBackendOption[];
  nsfwAllowed: boolean;
  useProxy: boolean;
}

/** Resolve the expert's web backends into a ResolvedExpertWeb. Returns null when
 *  neither search nor fetch resolves (the expert then has no web tools). The
 *  catalogue + adapter registry are consulted; the API key is NOT fetched here —
 *  the caller supplies a getKey to buildWebTools at call time. */
export function resolveExpertWeb(args: ResolveArgs): ResolvedExpertWeb | null {
  const ctx: WebContext = {
    nsfwAllowed: args.nsfwAllowed,
    location: null,
    useProxy: args.useProxy,
  };

  const resolveOne = (
    ref: OfferingRef | null,
    role: 'search' | 'fetch',
  ): {
    provider: WebInterfacingProvider;
    providerId: string;
    upstreamSlug: string;
    web: NonNullable<ReturnType<typeof getOffering>>['web'];
  } | null => {
    if (!ref) return null;
    const offering = getOffering(ref.providerId, ref.upstreamSlug);
    if (!offering || offering.serviceKind !== 'web' || !offering.web) return null;
    if (offering.web.requiresProxy && !args.useProxy) return null;
    if (offering.adapter.kind !== 'catalogue') return null;
    const provider = resolveWebAdapter(offering.adapter.adapterId);
    if (!provider) return null;
    if (role === 'search' && (!offering.web.canSearch || !provider.search)) return null;
    if (role === 'fetch' && (!offering.web.canFetch || !provider.fetch)) return null;
    return {
      provider,
      providerId: offering.providerId,
      upstreamSlug: offering.upstreamSlug,
      web: offering.web,
    };
  };

  const searchRes = resolveOne(pickExpertSearchRef(args.expertWeb.search, args.options), 'search');
  const fetchRes = resolveOne(pickExpertFetchRef(args.expertWeb.fetch, args.options), 'fetch');

  let search: ResolvedSearch | null = null;
  if (searchRes) {
    const tiers = searchRes.web?.searchTiers ?? [];
    const preferNeural = searchRes.upstreamSlug === EXA_SLUG;
    const tier =
      tiers.find((t) => t.id === args.expertWeb.searchTierId) ??
      (preferNeural ? tiers.find((t) => t.id === 'neural') : undefined) ??
      tiers[0];
    search = {
      provider: searchRes.provider,
      providerId: searchRes.providerId,
      tierParams: tier?.params ?? {},
    };
  }
  const fetch: ResolvedFetch | null = fetchRes
    ? { provider: fetchRes.provider, providerId: fetchRes.providerId }
    : null;

  if (!search && !fetch) return null;
  return { search, fetch, ctx };
}
