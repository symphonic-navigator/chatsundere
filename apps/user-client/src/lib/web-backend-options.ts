// SPDX-License-Identifier: AGPL-3.0-only
import { type ProviderDefinition, getProvider } from '@chatsundere/llm-unified';

/** A selectable web backend for the settings pickers, flattened from the
 *  usable providers' `web` offerings. */
export interface WebBackendOption {
  providerId: string;
  providerName: string;
  upstreamSlug: string;
  canSearch: boolean;
  canFetch: boolean;
  qualityClass: 'classic' | 'ai-friendly';
}

/** Flatten the `web` offerings of the usable providers into selectable options.
 *  `lookup` is injectable for tests (defaults to the live registry). */
export function webBackendOptions(
  usableTemplateIds: string[],
  lookup: (id: string) => ProviderDefinition | undefined = getProvider,
): WebBackendOption[] {
  const options: WebBackendOption[] = [];
  for (const id of usableTemplateIds) {
    const provider = lookup(id);
    if (!provider) continue;
    for (const o of provider.offerings) {
      if (o.serviceKind !== 'web' || !o.web) continue;
      options.push({
        providerId: provider.id,
        providerName: provider.displayName,
        upstreamSlug: o.upstreamSlug,
        canSearch: o.web.canSearch,
        canFetch: o.web.canFetch,
        qualityClass: o.web.qualityClass,
      });
    }
  }
  return options;
}
