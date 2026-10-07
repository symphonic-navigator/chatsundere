// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import type { TtiDescriptor } from './descriptor.js';
import {
  carryOverConfig,
  formatPriceCents,
  isImageModelConfig,
  isValidConfigFor,
  latencyFor,
  priceCentsFor,
  priceKey,
} from './image-config.js';

function meta(over: Partial<TtiDescriptor> = {}): TtiDescriptor {
  return {
    family: 'Test',
    variant: null,
    displayName: 'Test',
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 300_000,
    aspects: ['1:1', '16:9'],
    resolutions: [
      { id: '1k', label: '1k' },
      { id: '2k', label: '2k' },
    ],
    qualities: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
    ],
    priceCents: { '1k|low': 4, '1k|medium': 6, '2k|low': 6, '2k|medium': 8 },
    latency: { '1k|low': '~20 s' },
    billing: 'fixed',
    defaults: { aspect: '1:1', resolution: '1k', quality: 'low' },
    wire: { kind: 'aspect-resolution', sendResolution: true, responseFormat: 'url' },
    perItemModeration: false,
    ...over,
  };
}

const flat = meta({
  resolutions: null,
  qualities: null,
  priceCents: { '-|-': 9 },
  latency: undefined,
  defaults: { aspect: '1:1', resolution: null, quality: null },
});

describe('priceKey', () => {
  test('joins resolution and quality, using - for absent rows', () => {
    expect(priceKey({ resolution: '2k', quality: 'low' })).toBe('2k|low');
    expect(priceKey({ resolution: null, quality: null })).toBe('-|-');
    expect(priceKey({ resolution: '1k', quality: null })).toBe('1k|-');
  });
});

describe('isImageModelConfig', () => {
  test('accepts the new shape', () => {
    expect(isImageModelConfig({ aspect: '1:1', resolution: null, quality: null })).toBe(true);
    expect(isImageModelConfig({ aspect: '16:9', resolution: '2k', quality: 'low' })).toBe(true);
  });
  test('rejects legacy and malformed shapes', () => {
    expect(isImageModelConfig({ groupId: 'seedream', aspect: '1:1', quality: 'high' })).toBe(false);
    expect(
      isImageModelConfig({
        groupId: 'gpt-image-2',
        aspect: '1:1',
        resolution: '1k',
        quality: 'low',
      }),
    ).toBe(false);
    expect(isImageModelConfig({ aspect: '1:1' })).toBe(false);
    expect(isImageModelConfig(null)).toBe(false);
    expect(isImageModelConfig('1:1')).toBe(false);
  });
});

describe('isValidConfigFor', () => {
  test('accepts the defaults', () => {
    expect(isValidConfigFor(meta(), meta().defaults)).toBe(true);
    expect(isValidConfigFor(flat, flat.defaults)).toBe(true);
  });
  test('rejects an aspect the model lacks', () => {
    expect(isValidConfigFor(meta(), { aspect: '21:9', resolution: '1k', quality: 'low' })).toBe(
      false,
    );
  });
  test('rejects a resolution on a model without a Resolution row, and vice versa', () => {
    expect(isValidConfigFor(flat, { aspect: '1:1', resolution: '1k', quality: null })).toBe(false);
    expect(isValidConfigFor(meta(), { aspect: '1:1', resolution: null, quality: 'low' })).toBe(
      false,
    );
  });
  test('rejects an unknown quality', () => {
    expect(isValidConfigFor(meta(), { aspect: '1:1', resolution: '1k', quality: 'high' })).toBe(
      false,
    );
  });
});

describe('carryOverConfig', () => {
  test('keeps every field the next model supports', () => {
    const prev = { aspect: '16:9', resolution: '2k', quality: 'medium' };
    expect(carryOverConfig(prev, meta())).toEqual(prev);
  });
  test('falls back field by field to the next model defaults', () => {
    const prev = { aspect: '21:9', resolution: '4k', quality: 'medium' };
    expect(carryOverConfig(prev, meta())).toEqual({
      aspect: '1:1',
      resolution: '1k',
      quality: 'medium',
    });
  });
  test('switching to a model without rows nulls them', () => {
    const prev = { aspect: '16:9', resolution: '2k', quality: 'low' };
    expect(carryOverConfig(prev, flat)).toEqual({
      aspect: '16:9',
      resolution: null,
      quality: null,
    });
  });
  test('switching from a model without rows takes the next defaults', () => {
    const prev = { aspect: '16:9', resolution: null, quality: null };
    expect(carryOverConfig(prev, meta())).toEqual({
      aspect: '16:9',
      resolution: '1k',
      quality: 'low',
    });
  });
});

describe('priceCentsFor / latencyFor', () => {
  test('look up by the config key', () => {
    expect(priceCentsFor(meta(), { aspect: '1:1', resolution: '2k', quality: 'medium' })).toBe(8);
    expect(priceCentsFor(flat, flat.defaults)).toBe(9);
    expect(latencyFor(meta(), { aspect: '1:1', resolution: '1k', quality: 'low' })).toBe('~20 s');
    expect(latencyFor(meta(), { aspect: '1:1', resolution: '2k', quality: 'low' })).toBeUndefined();
  });
});

describe('formatPriceCents', () => {
  test('whole, fractional and dollar amounts', () => {
    expect(formatPriceCents(5, 'fixed')).toBe('5¢');
    expect(formatPriceCents(2.7, 'fixed')).toBe('2.7¢');
    expect(formatPriceCents(1.19, 'fixed')).toBe('1.2¢');
    expect(formatPriceCents(65, 'fixed')).toBe('65¢');
    expect(formatPriceCents(120, 'fixed')).toBe('$1.20');
  });
  test('usage billing gets a leading tilde', () => {
    expect(formatPriceCents(6.1, 'usage')).toBe('~6.1¢');
  });
});
