// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Offering,
  type WebContext,
  type WebInterfacingProvider,
  getOffering as realGetOffering,
  resolveWebAdapter as realResolveWebAdapter,
} from '@chatsundere/llm-unified';
import type { Tool } from '../../tools/types.js';
import type { Integration, IntegrationContext, OfferingRef } from '../types.js';
import { buildWebTools } from './build-web-tools.js';

/** Injectable resolvers so the integration is unit-testable without the live
 *  catalogue/registry. */
export interface WebIntegrationDeps {
  getOffering: (providerId: string, upstreamSlug: string) => Offering | undefined;
  resolveWebAdapter: (adapterId: string) => WebInterfacingProvider | null;
}

interface Resolved {
  offering: Offering;
  provider: WebInterfacingProvider;
}

function toWebContext(ctx: IntegrationContext): WebContext {
  return {
    nsfwAllowed: ctx.nsfwAllowed,
    location: ctx.location,
    useProxy: ctx.useProxy,
  };
}

/** Build the WebInterfacing integration over injectable resolvers. The default
 *  `webIntegration` wires the real catalogue + registry. */
export function createWebIntegration(deps: WebIntegrationDeps): Integration {
  const resolve = (ref: OfferingRef | null, ctx: IntegrationContext): Resolved | null => {
    if (!ref) return null;
    const offering = deps.getOffering(ref.providerId, ref.upstreamSlug);
    if (!offering || offering.serviceKind !== 'web' || !offering.web) return null;
    if (offering.web.requiresProxy && !ctx.useProxy) return null;
    if (offering.adapter.kind !== 'catalogue') return null;
    const provider = deps.resolveWebAdapter(offering.adapter.adapterId);
    return provider ? { offering, provider } : null;
  };

  return {
    id: 'web-interfacing',
    capability: 'web',
    contributesTools(ctx: IntegrationContext): Tool[] {
      const searchR = resolve(ctx.webSearch, ctx);
      const fetchR = resolve(ctx.webFetch, ctx);

      const search =
        searchR?.offering.web?.canSearch && searchR.provider.search
          ? (() => {
              const tiers = searchR.offering.web?.searchTiers ?? [];
              const tier = tiers.find((t) => t.id === ctx.webSearchTierId) ?? tiers[0];
              return {
                provider: searchR.provider,
                providerId: searchR.offering.providerId,
                tierParams: tier?.params ?? {},
              };
            })()
          : null;
      const fetch =
        fetchR?.offering.web?.canFetch && fetchR.provider.fetch
          ? { provider: fetchR.provider, providerId: fetchR.offering.providerId }
          : null;

      return buildWebTools({ search, fetch, ctx: toWebContext(ctx), getKey: ctx.getKey });
    },
  };
}

/** The application's WebInterfacing integration, wired to the live catalogue and
 *  the (currently empty) web-adapter-registry. Dormant until a backend is
 *  curated and its adapter registered. The real resolvers are referenced lazily
 *  (only when a backend is actually resolved) rather than at module load, so a
 *  partially-mocked `@chatsundere/llm-unified` in unrelated tests that merely
 *  import this chain does not trip on missing exports. */
export const webIntegration = createWebIntegration({
  getOffering: (providerId, upstreamSlug) => realGetOffering(providerId, upstreamSlug),
  resolveWebAdapter: (adapterId) => realResolveWebAdapter(adapterId),
});
