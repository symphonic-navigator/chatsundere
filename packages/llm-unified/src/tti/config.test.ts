// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { defaultConfigFor, isImageModelConfig, maxCountFor } from './config.js';

describe('defaultConfigFor', () => {
  test('xai-imagine defaults to normal/1k/1:1', () => {
    expect(defaultConfigFor('xai-imagine')).toEqual({
      groupId: 'xai-imagine',
      tier: 'normal',
      resolution: '1k',
      aspect: '1:1',
    });
  });
  test('zimage defaults to turbo/1024x1024', () => {
    expect(defaultConfigFor('zimage')).toEqual({
      groupId: 'zimage',
      variant: 'turbo',
      size: '1024x1024',
    });
  });
  test('seedream defaults to 1:1/standard', () => {
    expect(defaultConfigFor('seedream')).toEqual({
      groupId: 'seedream',
      aspect: '1:1',
      quality: 'standard',
    });
  });
  test('gpt-image-2 defaults to 1:1/1k/medium', () => {
    expect(defaultConfigFor('gpt-image-2')).toEqual({
      groupId: 'gpt-image-2',
      aspect: '1:1',
      resolution: '1k',
      quality: 'medium',
    });
  });
});

describe('maxCountFor', () => {
  test('grok imagine allows up to 10', () => {
    expect(maxCountFor(defaultConfigFor('xai-imagine'))).toBe(10);
  });
  test('z-image turbo allows up to 10, base only 4', () => {
    expect(maxCountFor({ groupId: 'zimage', variant: 'turbo', size: '1024x1024' })).toBe(10);
    expect(maxCountFor({ groupId: 'zimage', variant: 'base', size: '1024x1024' })).toBe(4);
  });
  test('seedream is hard-capped at 4', () => {
    expect(maxCountFor(defaultConfigFor('seedream'))).toBe(4);
  });
  test('gpt-image-2 is hard-capped at 4', () => {
    expect(maxCountFor(defaultConfigFor('gpt-image-2'))).toBe(4);
  });
});

describe('isImageModelConfig', () => {
  test('accepts each default config', () => {
    expect(isImageModelConfig(defaultConfigFor('xai-imagine'))).toBe(true);
    expect(isImageModelConfig(defaultConfigFor('zimage'))).toBe(true);
    expect(isImageModelConfig(defaultConfigFor('seedream'))).toBe(true);
    expect(isImageModelConfig(defaultConfigFor('gpt-image-2'))).toBe(true);
  });
  test('rejects junk', () => {
    expect(isImageModelConfig(null)).toBe(false);
    expect(isImageModelConfig({ groupId: 'unknown' })).toBe(false);
    expect(isImageModelConfig({ groupId: 'zimage', variant: 'hyper', size: '1024x1024' })).toBe(
      false,
    );
    expect(
      isImageModelConfig({
        groupId: 'xai-imagine',
        tier: 'normal',
        resolution: '1k',
        aspect: 'INVALID',
      }),
    ).toBe(false);
    expect(isImageModelConfig({ groupId: 'zimage', variant: 'turbo', size: '999x999' })).toBe(
      false,
    );
    expect(
      isImageModelConfig({ groupId: 'seedream', aspect: 'INVALID', quality: 'standard' }),
    ).toBe(false);
    expect(
      isImageModelConfig({
        groupId: 'gpt-image-2',
        aspect: '21:9',
        resolution: '4k',
        quality: 'medium',
      }),
    ).toBe(false);
    expect(
      isImageModelConfig({
        groupId: 'gpt-image-2',
        aspect: '1:1',
        resolution: '1k',
        quality: 'ultra',
      }),
    ).toBe(false);
  });
});
