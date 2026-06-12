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

  test('TTS offerings: mistral strip + the two probed Grok paths', () => {
    const tts = listTtsOfferings();
    expect(tts.map((o) => `${o.providerId}:${o.upstreamSlug}`).sort()).toEqual([
      'mistral:voxtral-mini-tts-2603',
      'nano-gpt:xai-tts',
      'xai:grok-tts',
    ]);

    const mistral = tts.find((o) => o.providerId === 'mistral');
    expect(mistral?.tts?.teal).toBe('strip');
    expect(mistral?.tts?.contentModerated).toBe(true);
    expect(mistral?.tts?.transport).toBe('mistral-speech');
    expect(mistral?.tts?.voices).toEqual({ kind: 'fetch', endpoint: 'mistral-paginated' });
    expect(mistral?.corsOverride).toBeUndefined();

    const xaiDirect = tts.find((o) => o.providerId === 'xai');
    expect(xaiDirect?.tts?.teal).toBe('passthrough');
    expect(xaiDirect?.tts?.contentModerated).toBe(false);
    expect(xaiDirect?.tts?.transport).toBe('xai-native');
    expect(xaiDirect?.tts?.voices).toEqual({ kind: 'fetch', endpoint: 'xai-flat' });
    expect(xaiDirect?.corsOverride).toBe('direct');
    expect(xaiDirect?.adapter.kind).toBe('generic');

    const nano = tts.find((o) => o.providerId === 'nano-gpt');
    expect(nano?.tts?.teal).toBe('passthrough');
    expect(nano?.tts?.contentModerated).toBe(false);
    expect(nano?.tts?.transport).toBe('openai-speech');
    expect(nano?.tts?.voices).toEqual({
      kind: 'static',
      list: [
        { id: 'ara', name: 'Ara' },
        { id: 'eve', name: 'Eve' },
        { id: 'leo', name: 'Leo' },
        { id: 'rex', name: 'Rex' },
        { id: 'sal', name: 'Sal' },
      ],
    });
    expect(nano?.corsOverride).toBeUndefined();
  });
});
