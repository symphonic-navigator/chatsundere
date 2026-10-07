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

  test('the migrated offerings are present and none can do NSFW', () => {
    const refs = listTtiOfferings().map((o) => `${o.providerId}:${o.upstreamSlug}`);
    for (const ref of [
      'xai:grok-imagine-image',
      'nano-gpt:z-image-turbo',
      'nano-gpt:z-image-base',
      'nano-gpt:seedream-v4.5',
      'nano-gpt:gpt-image-2',
    ]) {
      expect(refs).toContain(ref);
    }
    for (const o of listTtiOfferings()) {
      expect(o.serviceKind).toBe('tti');
      expect(o.canonicalRef).toBeNull();
      expect(o.tti?.canDoNsfw).toBe(false);
    }
  });

  test('families and variants map as designed', () => {
    const z = getOffering('nano-gpt', 'z-image-turbo')?.tti;
    const zb = getOffering('nano-gpt', 'z-image-base')?.tti;
    expect([z?.family, z?.variant, z?.recommended]).toEqual(['Z-Image', 'Turbo', true]);
    expect([zb?.family, zb?.variant, zb?.latencyHint]).toEqual(['Z-Image', 'Base', '~10× slower']);
    expect(getOffering('nano-gpt', 'seedream-v4.5')?.tti?.variant).toBe('4.5');
    expect(getOffering('nano-gpt', 'gpt-image-2')?.tti?.variant).toBeNull();
    const xai = getOffering('xai', 'grok-imagine-image')?.tti;
    expect([xai?.family, xai?.variant, xai?.perItemModeration]).toEqual([
      'Grok Imagine',
      '1',
      true,
    ]);
  });
});
