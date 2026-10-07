// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { buildImagePayload } from './build-payload.js';
import type { TtiDescriptor } from './descriptor.js';
import { Z_IMAGE_TURBO_SIZES } from './size-tables.js';

function meta(over: Partial<TtiDescriptor>): TtiDescriptor {
  return {
    family: 'Test',
    variant: null,
    displayName: 'Test',
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 300_000,
    aspects: ['1:1', '16:9'],
    resolutions: null,
    qualities: null,
    priceCents: { '-|-': 1 },
    billing: 'fixed',
    defaults: { aspect: '1:1', resolution: null, quality: null },
    wire: { kind: 'aspect-resolution', sendResolution: true, responseFormat: 'url' },
    perItemModeration: false,
    ...over,
  };
}

describe('buildImagePayload — aspect-resolution', () => {
  test('sends aspect_ratio and resolution', () => {
    const m = meta({ resolutions: [{ id: '1k', label: '1k' }] });
    expect(
      buildImagePayload(
        'minimax-h3/text-to-image',
        m,
        { aspect: '16:9', resolution: '1k', quality: null },
        'a fox',
        1,
      ),
    ).toEqual({
      model: 'minimax-h3/text-to-image',
      prompt: 'a fox',
      n: 1,
      response_format: 'url',
      aspect_ratio: '16:9',
      resolution: '1k',
    });
  });
  test('omits resolution when the wire says the model ignores it', () => {
    const m = meta({
      wire: { kind: 'aspect-resolution', sendResolution: false, responseFormat: 'url' },
    });
    expect(
      buildImagePayload(
        'bytedance/seedream-v5.0-pro',
        m,
        { aspect: '3:4', resolution: null, quality: null },
        'p',
        2,
      ),
    ).toEqual({
      model: 'bytedance/seedream-v5.0-pro',
      prompt: 'p',
      n: 2,
      response_format: 'url',
      aspect_ratio: '3:4',
    });
  });
  test('sends the quality under the descriptor field name, plus fixed extras', () => {
    const m = meta({
      wire: {
        kind: 'aspect-resolution',
        sendResolution: true,
        qualityParam: 'thinking_level',
        extra: { output_format: 'jpeg' },
        responseFormat: 'url',
      },
    });
    expect(
      buildImagePayload(
        'nano-banana-2.1',
        m,
        { aspect: '1:1', resolution: '2k', quality: 'high' },
        'p',
        1,
      ),
    ).toEqual({
      model: 'nano-banana-2.1',
      prompt: 'p',
      n: 1,
      response_format: 'url',
      aspect_ratio: '1:1',
      resolution: '2k',
      thinking_level: 'high',
      output_format: 'jpeg',
    });
  });
  test('modelByQuality swaps the upstream model and sends no quality field', () => {
    const m = meta({
      wire: {
        kind: 'aspect-resolution',
        sendResolution: true,
        modelByQuality: { normal: 'grok-imagine-image', quality: 'grok-imagine-image-quality' },
        responseFormat: 'b64_json',
      },
    });
    expect(
      buildImagePayload(
        'grok-imagine-image',
        m,
        { aspect: '4:3', resolution: '2k', quality: 'quality' },
        'p',
        3,
      ),
    ).toEqual({
      model: 'grok-imagine-image-quality',
      prompt: 'p',
      n: 3,
      response_format: 'b64_json',
      aspect_ratio: '4:3',
      resolution: '2k',
    });
  });
});

describe('buildImagePayload — size-table', () => {
  test('looks the size up and sends it as WxH', () => {
    const m = meta({
      aspects: ['1:1', '16:9'],
      wire: { kind: 'size-table', sizes: Z_IMAGE_TURBO_SIZES, responseFormat: 'url' },
    });
    expect(
      buildImagePayload(
        'z-image-turbo',
        m,
        { aspect: '16:9', resolution: null, quality: null },
        'p',
        1,
      ),
    ).toEqual({
      model: 'z-image-turbo',
      prompt: 'p',
      n: 1,
      response_format: 'url',
      size: '1280x720',
    });
  });
  test('sends the quality param when the table model has one', () => {
    const m = meta({
      resolutions: [{ id: '1k', label: '1k' }],
      qualities: [{ id: 'low', label: 'Low' }],
      wire: {
        kind: 'size-table',
        sizes: { '1:1|1k': [1024, 1024] },
        qualityParam: 'quality',
        responseFormat: 'url',
      },
    });
    expect(
      buildImagePayload(
        'gpt-image-2',
        m,
        { aspect: '1:1', resolution: '1k', quality: 'low' },
        'p',
        1,
      ),
    ).toEqual({
      model: 'gpt-image-2',
      prompt: 'p',
      n: 1,
      response_format: 'url',
      size: '1024x1024',
      quality: 'low',
    });
  });
  test('throws on a combination the table lacks (programming error)', () => {
    const m = meta({
      wire: { kind: 'size-table', sizes: Z_IMAGE_TURBO_SIZES, responseFormat: 'url' },
    });
    expect(() =>
      buildImagePayload(
        'z-image-turbo',
        m,
        { aspect: '4:3', resolution: null, quality: null },
        'p',
        1,
      ),
    ).toThrow('z-image-turbo: no size for 4:3 x -');
  });
});
