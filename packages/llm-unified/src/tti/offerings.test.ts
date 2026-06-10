// SPDX-License-Identifier: LGPL-3.0-only
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { _resetAdapterRegistryForTests } from '../adapter-registry.js';
import { registerBuiltinProviders } from '../providers/_register-builtins.js';
import { _resetRegistryForTests, getOffering, listTtiOfferings } from '../registry.js';

describe('TTI offerings', () => {
  beforeAll(() => {
    _resetRegistryForTests();
    _resetAdapterRegistryForTests();
    registerBuiltinProviders();
  });
  afterAll(() => {
    _resetRegistryForTests();
    _resetAdapterRegistryForTests();
  });

  test('the four curated offerings are present and none can do NSFW', () => {
    const ttis = listTtiOfferings();
    const refs = ttis.map((o) => `${o.providerId}:${o.upstreamSlug}`).sort();
    expect(refs).toEqual([
      'nano-gpt:gpt-image-2',
      'nano-gpt:seedream-v4.5',
      'nano-gpt:z-image-turbo',
      'xai:grok-imagine-image',
    ]);
    const expectedDisplayNames: Record<string, string> = {
      'xai:grok-imagine-image': 'Grok Imagine',
      'nano-gpt:z-image-turbo': 'Z-Image',
      'nano-gpt:seedream-v4.5': 'Seedream 4.5',
      'nano-gpt:gpt-image-2': 'GPT Image 2',
    };
    for (const o of ttis) {
      expect(o.serviceKind).toBe('tti');
      expect(o.canonicalRef).toBeNull();
      expect(o.tti?.canDoNsfw).toBe(false);
      expect(o.tti?.displayName).toBe(expectedDisplayNames[`${o.providerId}:${o.upstreamSlug}`]);
    }
  });
  test('groupIds map as designed', () => {
    expect(getOffering('xai', 'grok-imagine-image')?.tti?.groupId).toBe('xai-imagine');
    expect(getOffering('nano-gpt', 'z-image-turbo')?.tti?.groupId).toBe('zimage');
    expect(getOffering('nano-gpt', 'seedream-v4.5')?.tti?.groupId).toBe('seedream');
    expect(getOffering('nano-gpt', 'gpt-image-2')?.tti?.groupId).toBe('gpt-image-2');
  });
});
