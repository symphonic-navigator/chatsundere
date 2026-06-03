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
    // chutes is TEE → first. novita + nano-gpt are freedomOrientedDeployment:true
    // (Chris, 2026-05-30) so they rank ahead of ollama-cloud (freedom-unassessed,
    // `null`), and within that freedom group sort by provider priority (novita 20
    // < nano-gpt 40). ollama-cloud's GLM 5.1 is verified now but freedom-null → last.
    expect(offers.map((o) => o.providerId)).toEqual([
      'chutes',
      'novita',
      'nano-gpt',
      'ollama-cloud',
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
