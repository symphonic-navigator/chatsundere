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
  test('returns offerings for a canonical, TEE first then by provider priority', () => {
    const offers = listOfferings('glm-5.1');
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
    expect(getOffering('nano-gpt', 'zai-org/glm-5.1')?.adapter.kind).toBe('generic');
  });

  test('undefined for unknown provider or slug', () => {
    expect(getOffering('chutes', 'nope')).toBeUndefined();
    expect(getOffering('nope', 'x')).toBeUndefined();
  });
});
