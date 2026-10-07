// SPDX-License-Identifier: LGPL-3.0-only
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { _resetAdapterRegistryForTests } from '../adapter-registry.js';
import { registerBuiltinProviders } from '../providers/_register-builtins.js';
import { _resetRegistryForTests } from '../registry.js';
import { getTtiDescriptor } from './lookup.js';
import { upgradeImageSlot } from './upgrade.js';

beforeAll(() => {
  _resetRegistryForTests();
  _resetAdapterRegistryForTests();
  registerBuiltinProviders();
});
afterAll(() => {
  _resetRegistryForTests();
  _resetAdapterRegistryForTests();
});

const up = (stored: unknown) => upgradeImageSlot(stored, getTtiDescriptor);

describe('getTtiDescriptor', () => {
  test('resolves a ref whose slug contains slashes and colons-free paths', () => {
    expect(
      getTtiDescriptor('nano-gpt:xai/grok-imagine-image/v2.0/text-to-image')?.displayName,
    ).toBe('Grok Imagine 2.0');
    expect(getTtiDescriptor('nano-gpt:nope')).toBeUndefined();
    expect(getTtiDescriptor('no-colon')).toBeUndefined();
    expect(getTtiDescriptor('mistral:mistral-large-4')).toBeUndefined(); // not a TTI offering
  });
});

describe('upgradeImageSlot — legacy shapes', () => {
  test('xai-imagine: tier becomes quality', () => {
    expect(
      up({
        ref: 'xai:grok-imagine-image',
        config: { groupId: 'xai-imagine', tier: 'quality', resolution: '1k', aspect: '16:9' },
      }),
    ).toEqual({
      ref: 'xai:grok-imagine-image',
      config: { aspect: '16:9', resolution: '1k', quality: 'quality' },
    });
  });
  test('zimage turbo: size becomes aspect', () => {
    expect(
      up({
        ref: 'nano-gpt:z-image-turbo',
        config: { groupId: 'zimage', variant: 'turbo', size: '1280x720' },
      }),
    ).toEqual({
      ref: 'nano-gpt:z-image-turbo',
      config: { aspect: '16:9', resolution: null, quality: null },
    });
  });
  test('zimage turbo: a small square becomes 1:1', () => {
    expect(
      up({
        ref: 'nano-gpt:z-image-turbo',
        config: { groupId: 'zimage', variant: 'turbo', size: '512x512' },
      })?.config,
    ).toEqual({ aspect: '1:1', resolution: null, quality: null });
  });
  test('zimage base: the ref moves to the Base offering, an unsupported aspect falls back', () => {
    expect(
      up({
        ref: 'nano-gpt:z-image-turbo',
        config: { groupId: 'zimage', variant: 'base', size: '1536x1024' },
      }),
    ).toEqual({
      ref: 'nano-gpt:z-image-base',
      config: { aspect: '1:1', resolution: null, quality: null },
    });
  });
  test('seedream: standard/high/ultra become 2k/2.2k/2.7k', () => {
    const map = { standard: '2k', high: '2.2k', ultra: '2.7k' } as const;
    for (const [quality, resolution] of Object.entries(map)) {
      expect(
        up({
          ref: 'nano-gpt:seedream-v4.5',
          config: { groupId: 'seedream', aspect: '3:2', quality },
        })?.config,
      ).toEqual({ aspect: '3:2', resolution, quality: null });
    }
  });
  test('gpt-image-2: fields copied', () => {
    expect(
      up({
        ref: 'nano-gpt:gpt-image-2',
        config: { groupId: 'gpt-image-2', aspect: '21:9', resolution: '2k', quality: 'high' },
      })?.config,
    ).toEqual({ aspect: '21:9', resolution: '2k', quality: 'high' });
  });
});

describe('upgradeImageSlot — new shapes and failure cases', () => {
  test('a valid new slot is unchanged', () => {
    const slot = {
      ref: 'nano-gpt:bytedance/seedream-v5.0-flash',
      config: { aspect: '16:9', resolution: '1k', quality: null },
    };
    expect(up(slot)).toEqual(slot);
  });
  test('an invalid config on a known ref keeps what fits and defaults the rest', () => {
    expect(
      up({
        ref: 'nano-gpt:black-forest-labs/flux-3/text-to-image',
        config: { aspect: '16:9', resolution: '8k', quality: 'ultra' },
      }),
    ).toEqual({
      ref: 'nano-gpt:black-forest-labs/flux-3/text-to-image',
      config: { aspect: '16:9', resolution: '1k', quality: null },
    });
  });
  test('an unparseable config on a known ref takes the defaults', () => {
    expect(up({ ref: 'nano-gpt:seedream-v5.0-lite', config: 'garbage' })).toEqual({
      ref: 'nano-gpt:seedream-v5.0-lite',
      config: { aspect: '1:1', resolution: null, quality: null },
    });
  });
  test('a defaulted config is a copy, never the descriptor defaults object', () => {
    const slot = up({ ref: 'nano-gpt:seedream-v5.0-lite', config: 'garbage' });
    const meta = getTtiDescriptor('nano-gpt:seedream-v5.0-lite');
    expect(slot?.config).toEqual(meta?.defaults);
    expect(slot?.config).not.toBe(meta?.defaults);
  });
  test('an unknown ref, a null slot or junk yields null', () => {
    expect(
      up({
        ref: 'nano-gpt:retired-model',
        config: { aspect: '1:1', resolution: null, quality: null },
      }),
    ).toBeNull();
    expect(up(null)).toBeNull();
    expect(up({ config: {} })).toBeNull();
  });
  test('lastConfigByRef keeps only entries that still fit their offering', () => {
    const slot = up({
      ref: 'nano-gpt:gpt-image-2',
      config: { aspect: '1:1', resolution: '1k', quality: 'medium' },
      lastConfigByRef: {
        'nano-gpt:gpt-image-2': { aspect: '16:9', resolution: '2k', quality: 'high' },
        'nano-gpt:black-forest-labs/flux-3/text-to-image': {
          aspect: '1:1',
          resolution: '8k',
          quality: null,
        },
        'nano-gpt:retired-model': { aspect: '1:1', resolution: null, quality: null },
        'nano-gpt:seedream-v5.0-lite': 'junk',
      },
    });
    expect(slot?.lastConfigByRef).toEqual({
      'nano-gpt:gpt-image-2': { aspect: '16:9', resolution: '2k', quality: 'high' },
    });
  });
  test('an absent or empty lastConfigByRef is omitted', () => {
    const slot = up({
      ref: 'nano-gpt:gpt-image-2',
      config: { aspect: '1:1', resolution: '1k', quality: 'medium' },
      lastConfigByRef: {},
    });
    expect(slot).toEqual({
      ref: 'nano-gpt:gpt-image-2',
      config: { aspect: '1:1', resolution: '1k', quality: 'medium' },
    });
  });
});
