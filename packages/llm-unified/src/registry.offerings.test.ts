// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chutes } from './providers/chutes.js';
import { nanoGpt } from './providers/nano-gpt.js';
import { novita } from './providers/novita.js';
import { ollamaCloud } from './providers/ollama-cloud.js';
import {
  _resetRegistryForTests,
  getOffering,
  listOfferings,
  registerProvider,
} from './registry.js';

beforeEach(() => {
  _resetRegistryForTests();
  registerProvider(chutes);
  registerProvider(novita);
  registerProvider(ollamaCloud);
  registerProvider(nanoGpt);
});
afterEach(() => _resetRegistryForTests());

describe('listOfferings', () => {
  test('returns offerings for a canonical: TEE, then freedom-oriented, then priority', () => {
    const offers = listOfferings('glm-5.1');
    // chutes is TEE → first. All three others are now freedomOrientedDeployment:
    // true, so the freedom tier no longer separates them and they sort purely by
    // provider priority: novita 20 < ollama-cloud 30 < nano-gpt 40.
    //
    // ollama-cloud used to rank LAST here, demoted by a `null` freedom axis that
    // meant "never assessed" rather than "restricted". The Kimi K3 eval assessed
    // it (Chris, 2026-07-27) and the demotion disappeared — a reminder that an
    // unassessed axis is not cost-free: it silently ranks a provider below its
    // priority until someone measures it.
    expect(offers.map((o) => o.providerId)).toEqual([
      'chutes',
      'novita',
      'ollama-cloud',
      'nano-gpt',
    ]);
    expect(offers[0]?.trust.tee).toBe(true);
  });

  test('returns a single offering for a chutes-only canonical', () => {
    expect(listOfferings('deepseek-v3.2').map((o) => o.providerId)).toEqual(['chutes']);
  });

  test('empty for an unknown canonical', () => {
    expect(listOfferings('nope')).toEqual([]);
  });
});

describe('getOffering', () => {
  test('finds an offering by provider template + slug', () => {
    expect(getOffering('chutes', 'zai-org/GLM-5.1-TEE')?.canonicalRef).toBe('glm-5.1');
    expect(getOffering('ollama-cloud', 'deepseek-v4-pro')?.adapter.kind).toBe('catalogue');
    expect(getOffering('nano-gpt', 'zai-org/glm-5.1')?.adapter.kind).toBe('catalogue');
  });

  test('undefined for unknown provider or slug', () => {
    expect(getOffering('chutes', 'nope')).toBeUndefined();
    expect(getOffering('nope', 'x')).toBeUndefined();
  });
});
