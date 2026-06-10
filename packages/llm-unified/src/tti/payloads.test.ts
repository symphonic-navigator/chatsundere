// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { buildImagePayload } from './payloads.js';

describe('buildImagePayload', () => {
  test('xai quality/2k/16:9 → b64_json with quality model id', () => {
    expect(
      buildImagePayload(
        { groupId: 'xai-imagine', tier: 'quality', resolution: '2k', aspect: '16:9' },
        'a fox',
        2,
      ),
    ).toEqual({
      model: 'grok-imagine-image-quality',
      prompt: 'a fox',
      n: 2,
      response_format: 'b64_json',
      aspect_ratio: '16:9',
      resolution: '2k',
    });
  });
  test('xai normal tier uses the base model id', () => {
    const body = buildImagePayload(
      { groupId: 'xai-imagine', tier: 'normal', resolution: '1k', aspect: '1:1' },
      'a fox',
      1,
    );
    expect(body.model).toBe('grok-imagine-image');
  });
  test('zimage base → url with size passthrough', () => {
    expect(
      buildImagePayload({ groupId: 'zimage', variant: 'base', size: '1536x1024' }, 'a fox', 1),
    ).toEqual({
      model: 'z-image-base',
      prompt: 'a fox',
      n: 1,
      size: '1536x1024',
      response_format: 'url',
    });
  });
  test('zimage turbo uses the turbo model id', () => {
    const body = buildImagePayload(
      { groupId: 'zimage', variant: 'turbo', size: '1024x1024' },
      'a fox',
      1,
    );
    expect(body.model).toBe('z-image-turbo');
  });
  test('gpt-image-2 resolves size from its table and passes quality through', () => {
    expect(
      buildImagePayload(
        { groupId: 'gpt-image-2', aspect: '21:9', resolution: '2k', quality: 'high' },
        'a fox',
        2,
      ),
    ).toEqual({
      model: 'gpt-image-2',
      prompt: 'a fox',
      n: 2,
      size: '2464x1056',
      quality: 'high',
      response_format: 'url',
    });
  });
  test('seedream resolves size from the resolution table', () => {
    const body = buildImagePayload(
      { groupId: 'seedream', aspect: '16:9', quality: 'ultra' },
      'a fox',
      4,
    );
    expect(body).toEqual({
      model: 'seedream-v4.5',
      prompt: 'a fox',
      n: 4,
      size: '3520x1984',
      response_format: 'url',
    });
  });
});
