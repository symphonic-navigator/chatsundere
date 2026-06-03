// SPDX-License-Identifier: AGPL-3.0-only
import type { ProviderDefinition } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import type { ProviderRow } from '../../src/boot/client-data-db.js';
import { usableTemplateIds } from '../../src/lib/usable-providers.js';
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

const row = (templateId: string, createdAt: number): ProviderRow => ({
  id: `id-${templateId}`,
  templateId,
  displayName: templateId,
  baseUrl: '',
  // biome-ignore lint/suspicious/noExplicitAny: test stub for the sealed blob
  apiKey: {} as any,
  routing: { kind: 'direct' },
  enabled: true,
  createdAt,
  updatedAt: createdAt,
});

describe('usableTemplateIds ordering', () => {
  it('orders enabled providers by createdAt (first-configured first)', () => {
    const providers = [row('nano-gpt', 200), row('ollama-cloud', 100)];
    expect(usableTemplateIds(providers, true)).toEqual(['ollama-cloud', 'nano-gpt']);
  });
});

const webProvider = (id: string, slug: string, canSearch: boolean): ProviderDefinition =>
  ({
    id,
    displayName: id === 'ollama-cloud' ? 'Ollama Cloud' : id,
    offerings: [
      {
        upstreamSlug: slug,
        serviceKind: 'web',
        web: { canSearch, canFetch: !canSearch, traits: [], requiresProxy: false },
      },
    ],
    // biome-ignore lint/suspicious/noExplicitAny: partial stub, only fields read by webBackendOptions
  }) as any;

describe('webBackendOptions labels', () => {
  it('strips web- prefix and -search/-fetch suffix for search labels', () => {
    const lookup = (id: string) => webProvider(id, 'web-ollama-search', true);
    const [o] = webBackendOptions(['ollama-cloud'], false, lookup);
    expect(o?.label).toBe('Ollama');
  });

  it('keeps engine names like Linkup intact', () => {
    const lookup = () => webProvider('nano-gpt', 'web-linkup', true);
    const [o] = webBackendOptions(['nano-gpt'], false, lookup);
    expect(o?.label).toBe('Linkup');
  });
});
