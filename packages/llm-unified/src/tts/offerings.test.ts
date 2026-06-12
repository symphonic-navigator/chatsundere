// SPDX-License-Identifier: LGPL-3.0-only
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { _resetAdapterRegistryForTests } from '../adapter-registry.js';
import { registerBuiltinProviders } from '../providers/_register-builtins.js';
import { _resetRegistryForTests, listTtsOfferings } from '../registry.js';

describe('TTS offerings', () => {
  beforeAll(() => {
    _resetRegistryForTests();
    _resetAdapterRegistryForTests();
    registerBuiltinProviders();
  });
  afterAll(() => {
    _resetRegistryForTests();
    _resetAdapterRegistryForTests();
  });

  test('mistral voxtral TTS offering is present with teal strip', () => {
    const tts = listTtsOfferings();
    expect(tts.map((o) => `${o.providerId}:${o.upstreamSlug}`)).toEqual([
      'mistral:voxtral-mini-tts-2603',
    ]);
    const offering = tts[0];
    expect(offering?.serviceKind).toBe('tts');
    expect(offering?.tts?.teal).toBe('strip');
    expect(offering?.tts?.contentModerated).toBe(true);
    expect(offering?.adapter.kind).toBe('generic');
  });
});
