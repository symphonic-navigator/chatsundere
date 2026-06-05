// SPDX-License-Identifier: LGPL-3.0-only

export interface DiscoveredOffering {
  providerId: string;
  baseSlug: string;
  reasoningVariant?: string;
  teeVariant?: boolean;
}

export interface ProviderScanner {
  providerId: string;
  listOfferings(): Promise<DiscoveredOffering[]>;
}

/**
 * Group nano-gpt's raw slug list into logical offerings, taming the nano-gptism
 * zoo: a model has a bare slug and an optional `:thinking` reasoning sibling;
 * TEE deployments live under a `TEE/` prefix and use `-thinking` (hyphen, not
 * colon) for their reasoning sibling. Bare and TEE are SEPARATE offerings.
 */
export function groupNanoGptSlugs(slugs: string[]): DiscoveredOffering[] {
  const set = new Set(slugs);
  const out: DiscoveredOffering[] = [];
  for (const slug of slugs) {
    const isTee = slug.startsWith('TEE/');
    if (!isTee && slug.endsWith(':thinking')) continue;
    if (isTee && slug.endsWith('-thinking')) continue;
    if (isTee) {
      const thinking = `${slug}-thinking`;
      out.push({
        providerId: 'nano-gpt',
        baseSlug: slug,
        teeVariant: true,
        ...(set.has(thinking) ? { reasoningVariant: thinking } : {}),
      });
    } else {
      const thinking = `${slug}:thinking`;
      out.push({
        providerId: 'nano-gpt',
        baseSlug: slug,
        ...(set.has(thinking) ? { reasoningVariant: thinking } : {}),
      });
    }
  }
  return out;
}
