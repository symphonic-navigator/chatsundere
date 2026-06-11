// SPDX-License-Identifier: LGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { _resetAdapterRegistryForTests } from './adapter-registry.js';
import { registerBuiltinProviders } from './providers/_register-builtins.js';
import {
  MODALITY_ORDER,
  _resetRegistryForTests,
  aggregateServiceKinds,
  providerServiceKinds,
  providersContributing,
} from './registry.js';

// Importing the package via per-module paths avoids the `./index.js` import-time
// auto-registration. We register the built-ins ourselves from a clean slate so
// this file neither depends on, nor disturbs, the shared registry state of other
// test files (the adapter registry has no implicit reset — see
// `_resetAdapterRegistryForTests`).
describe('modality derivation', () => {
  beforeAll(() => {
    _resetRegistryForTests();
    _resetAdapterRegistryForTests();
    registerBuiltinProviders();
  });
  afterAll(() => {
    _resetRegistryForTests();
    _resetAdapterRegistryForTests();
  });

  it('MODALITY_ORDER lists the five modalities in display order', () => {
    expect(MODALITY_ORDER).toEqual(['llm', 'web', 'tts', 'stt', 'tti']);
  });

  it('unknown provider id returns empty service kinds', () => {
    expect(providerServiceKinds('does-not-exist')).toEqual([]);
  });

  it('providerServiceKinds returns distinct service kinds in MODALITY_ORDER (llm only today)', () => {
    expect(providerServiceKinds('wafer')).toEqual(['llm']);
  });

  it('aggregateServiceKinds unions provider kinds, deduped, in MODALITY_ORDER order', () => {
    expect(aggregateServiceKinds(['wafer', 'chutes'])).toEqual(['llm']);
  });

  it('aggregateServiceKinds returns empty for no providers', () => {
    expect(aggregateServiceKinds([])).toEqual([]);
  });

  it('providersContributing returns provider ids offering a kind', () => {
    expect(providersContributing('llm')).toContain('wafer');
  });

  it('providersContributing returns the contributing provider when a kind is offered', () => {
    expect(providersContributing('tts')).toEqual(['mistral']);
  });
});
