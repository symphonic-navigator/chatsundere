// SPDX-License-Identifier: AGPL-3.0-only
import type { ProviderDefinition } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import { webBackendOptions } from '../../src/lib/web-backend-options.js';

const fake = (): ProviderDefinition =>
  ({
    id: 'nano-gpt',
    displayName: 'nano-gpt',
    offerings: [
      {
        providerId: 'nano-gpt',
        upstreamSlug: 'web-exa',
        serviceKind: 'web',
        web: { canSearch: true, canFetch: false, requiresProxy: true, traits: ['ai', 'neural'] },
      },
    ],
  }) as unknown as ProviderDefinition;

describe('webBackendOptions', () => {
  it('surfaces traits, requiresProxy and a friendly label (with a proxy)', () => {
    const opts = webBackendOptions(['nano-gpt'], true, fake);
    expect(opts[0]).toMatchObject({
      providerId: 'nano-gpt',
      upstreamSlug: 'web-exa',
      label: 'Exa',
      canSearch: true,
      traits: ['ai', 'neural'],
      requiresProxy: true,
    });
  });

  it('labels a fetch-only backend by its provider name', () => {
    const fetchOnly = (): ProviderDefinition =>
      ({
        id: 'nano-gpt',
        displayName: 'nano-gpt',
        offerings: [
          {
            providerId: 'nano-gpt',
            upstreamSlug: 'web-scrape',
            serviceKind: 'web',
            web: { canSearch: false, canFetch: true, requiresProxy: true, traits: [] },
          },
        ],
      }) as unknown as ProviderDefinition;
    expect(webBackendOptions(['nano-gpt'], true, fetchOnly)[0]?.label).toBe('nano-gpt');
  });

  it('drops requiresProxy backends when no proxy is configured', () => {
    expect(webBackendOptions(['nano-gpt'], false, fake)).toEqual([]);
  });

  it('returns [] when no usable provider has a web offering', () => {
    expect(webBackendOptions([], true, () => undefined)).toEqual([]);
  });
});
