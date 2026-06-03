// SPDX-License-Identifier: AGPL-3.0-only
import { type ProviderDefinition, type WebTrait, getProvider } from '@chatsundere/llm-unified';

/** A selectable web backend for the settings pickers, flattened from the
 *  usable providers' `web` offerings. */
export interface WebBackendOption {
  providerId: string;
  providerName: string;
  upstreamSlug: string;
  /** Friendly display name for the picker (e.g. "Linkup", "nano-gpt"). */
  label: string;
  canSearch: boolean;
  canFetch: boolean;
  traits: WebTrait[];
  requiresProxy: boolean;
}

/** Flatten the `web` offerings of the usable providers into selectable options.
 *  A backend whose endpoints lack CORS (`requiresProxy`) is only selectable when
 *  a CORS proxy is configured — otherwise it is dropped, so the UI never offers
 *  a web backend that cannot actually run. `lookup` is injectable for tests. */
export function webBackendOptions(
  usableTemplateIds: string[],
  hasProxy: boolean,
  lookup: (id: string) => ProviderDefinition | undefined = getProvider,
): WebBackendOption[] {
  const options: WebBackendOption[] = [];
  for (const id of usableTemplateIds) {
    const provider = lookup(id);
    if (!provider) continue;
    for (const o of provider.offerings) {
      if (o.serviceKind !== 'web' || !o.web) continue;
      if (o.web.requiresProxy && !hasProxy) continue;
      // Friendly name: a search backend is named by its engine ("web-linkup" →
      // "Linkup"); a fetch-only backend by its provider ("nano-gpt").
      const bare = o.upstreamSlug.replace(/^web-/, '');
      const label = o.web.canSearch
        ? bare.charAt(0).toUpperCase() + bare.slice(1)
        : provider.displayName;
      options.push({
        providerId: provider.id,
        providerName: provider.displayName,
        upstreamSlug: o.upstreamSlug,
        label,
        canSearch: o.web.canSearch,
        canFetch: o.web.canFetch,
        traits: o.web.traits,
        requiresProxy: o.web.requiresProxy,
      });
    }
  }
  return options;
}
