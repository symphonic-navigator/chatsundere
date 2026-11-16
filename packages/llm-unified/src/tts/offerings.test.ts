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
      'elevenlabs:eleven_v4',
      'elevenlabs:eleven_v4_turbo',
      'mistral:voxtral-mini-tts-2603',
      'nano-gpt:xai-tts',
      'xai:grok-tts',
    ]);

    const mistral = tts.find((o) => o.providerId === 'mistral');
    expect(mistral?.tts?.teal).toBe('none');
    expect(mistral?.tts?.contentModerated).toBe(true);
    expect(mistral?.tts?.transport).toBe('mistral-speech');
    expect(mistral?.tts?.voices).toEqual({ kind: 'fetch', endpoint: 'mistral-paginated' });
    expect(mistral?.corsOverride).toBeUndefined();

    const xaiDirect = tts.find((o) => o.providerId === 'xai');
    expect(xaiDirect?.tts?.teal).toBe('v1');
    expect(xaiDirect?.tts?.contentModerated).toBe(false);
    expect(xaiDirect?.tts?.transport).toBe('xai-native');
    expect(xaiDirect?.tts?.voices).toEqual({ kind: 'fetch', endpoint: 'xai-flat' });
    expect(xaiDirect?.corsOverride).toBe('direct');
    expect(xaiDirect?.adapter.kind).toBe('generic');

    const nano = tts.find((o) => o.providerId === 'nano-gpt');
    expect(nano?.tts?.teal).toBe('v1');
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

  test('ElevenLabs: both Eleven v4 offerings are TEAL v2, are moderated and non-TEE', () => {
    const tts = listTtsOfferings().filter((o) => o.providerId === 'elevenlabs');
    expect(tts.map((o) => o.upstreamSlug).sort()).toEqual(['eleven_v4', 'eleven_v4_turbo']);
    for (const o of tts) {
      expect(o.tts?.teal).toBe('v2');
      expect(o.tts?.transport).toBe('elevenlabs');
      expect(o.tts?.voices).toEqual({ kind: 'fetch', endpoint: 'elevenlabs-v2' });
      expect(o.tts?.contentModerated).toBe(true);
      expect(o.trust).toEqual({ tee: false, zdr: false, jurisdiction: 'US' });
      expect(o.freedomOrientedDeployment).toBeNull();
      expect(o.adapter.kind).toBe('generic');
    }
    expect(tts.map((o) => o.tts?.displayName).sort()).toEqual(['Eleven v4', 'Eleven v4 Turbo']);
  });
});
