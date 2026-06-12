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

  test('STT offerings: mistral + the two probed Grok paths', () => {
    const stt = listSttOfferings();
    expect(stt.map((o) => `${o.providerId}:${o.upstreamSlug}`).sort()).toEqual([
      'mistral:voxtral-mini-latest',
      'nano-gpt:xai/speech-to-text/v1',
      'xai:grok-stt',
    ]);

    const mistral = stt.find((o) => o.providerId === 'mistral');
    expect(mistral?.stt?.transport).toBe('openai-transcriptions');
    expect(mistral?.stt?.spoofWebmAsMatroska).toBeUndefined();

    const xaiDirect = stt.find((o) => o.providerId === 'xai');
    expect(xaiDirect?.stt?.transport).toBe('xai-native');
    expect(xaiDirect?.stt?.contentModerated).toBe(false);
    expect(xaiDirect?.corsOverride).toBe('direct');

    const nano = stt.find((o) => o.providerId === 'nano-gpt');
    expect(nano?.stt?.transport).toBe('openai-transcriptions');
    expect(nano?.stt?.contentModerated).toBe(false);
    expect(nano?.stt?.spoofWebmAsMatroska).toBe(true);
  });
});
