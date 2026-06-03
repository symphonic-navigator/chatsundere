// SPDX-License-Identifier: AGPL-3.0-only
import { type SearchTier, getOffering } from '@chatsundere/llm-unified';
import { useSettings } from '../data/settings.js';
import { useUsableTemplateIds } from './usable-providers.js';
import { webBackendOptions } from './web-backend-options.js';
import { resolveWebBackend } from './web-backends.js';

/** The curated search-depth tiers of the effective search backend (resolved
 *  from settings), or undefined when web search is off/unavailable. Used by the
 *  cockpit to offer a depth control only when the chosen backend has tiers. */
export function useActiveSearchTiers(): SearchTier[] | undefined {
  const usable = useUsableTemplateIds();
  const settings = useSettings();
  const options = webBackendOptions(usable, settings.data?.corsProxy != null);
  const ref = resolveWebBackend(settings.data?.webInterfacing?.search ?? null, options, 'search');
  if (!ref) return undefined;
  return getOffering(ref.providerId, ref.upstreamSlug)?.web?.searchTiers;
}
