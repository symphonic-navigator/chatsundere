// SPDX-License-Identifier: AGPL-3.0-only
import type { ProviderDefinition } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import { webBackendOptions } from '../../src/lib/web-backend-options.js';

const provider = {
  id: 'nano-gpt',
  displayName: 'Nano-GPT',
  offerings: [
    {
      providerId: 'nano-gpt',
      upstreamSlug: 'brave',
      serviceKind: 'web',
      web: { canSearch: true, canFetch: true, qualityClass: 'classic' },
      canonicalRef: null,
      // biome-ignore lint/suspicious/noExplicitAny: only web fields matter here
    } as any,
    {
      providerId: 'nano-gpt',
      upstreamSlug: 'some-llm',
      serviceKind: 'llm',
      // biome-ignore lint/suspicious/noExplicitAny: non-web offering, ignored
    } as any,
  ],
} as unknown as ProviderDefinition;

describe('webBackendOptions', () => {
  it('returns only web offerings of usable providers, with metadata', () => {
    const opts = webBackendOptions(['nano-gpt'], (id) =>
      id === 'nano-gpt' ? provider : undefined,
    );
    expect(opts).toEqual([
      {
        providerId: 'nano-gpt',
        providerName: 'Nano-GPT',
        upstreamSlug: 'brave',
        canSearch: true,
        canFetch: true,
        qualityClass: 'classic',
      },
    ]);
  });

  it('returns [] when no usable provider has a web offering', () => {
    const opts = webBackendOptions([], () => undefined);
    expect(opts).toEqual([]);
  });
});
