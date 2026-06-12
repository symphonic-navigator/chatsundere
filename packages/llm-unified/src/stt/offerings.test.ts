// SPDX-License-Identifier: LGPL-3.0-only
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { _resetAdapterRegistryForTests } from '../adapter-registry.js';
import { registerBuiltinProviders } from '../providers/_register-builtins.js';
import { _resetRegistryForTests, listSttOfferings } from '../registry.js';

describe('STT offerings', () => {
  beforeAll(() => {
    _resetRegistryForTests();
    _resetAdapterRegistryForTests();
    registerBuiltinProviders();
  });
  afterAll(() => {
    _resetRegistryForTests();
    _resetAdapterRegistryForTests();
  });

  test('mistral voxtral STT offering is present', () => {
    const stt = listSttOfferings();
    expect(stt.map((o) => `${o.providerId}:${o.upstreamSlug}`)).toEqual([
      'mistral:voxtral-mini-latest',
    ]);
    const offering = stt[0];
    expect(offering?.serviceKind).toBe('stt');
    expect(offering?.stt?.displayName).toBe('Voxtral Mini STT');
    expect(offering?.stt?.contentModerated).toBe(false);
    expect(offering?.adapter.kind).toBe('generic');
  });
});
