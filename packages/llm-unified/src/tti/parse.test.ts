// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { parseImagesResponse } from './parse.js';

describe('parseImagesResponse — xai', () => {
  test('b64 items pass through with mime; moderated items carry the reason', () => {
    const items = parseImagesResponse('xai-imagine', {
      data: [
        { b64_json: 'AAAA', mime_type: 'image/jpeg' },
        { respect_moderation: false, reason: 'content policy' },
      ],
    });
    expect(items).toEqual([
      { kind: 'b64', b64: 'AAAA', mime: 'image/jpeg' },
      { kind: 'moderated', reason: 'content policy' },
    ]);
  });
  test('missing mime_type defaults to null (caller falls back to image/jpeg)', () => {
    const items = parseImagesResponse('xai-imagine', { data: [{ b64_json: 'AAAA' }] });
    expect(items).toEqual([{ kind: 'b64', b64: 'AAAA', mime: null }]);
  });
});

describe('parseImagesResponse — nano-gpt groups', () => {
  test('url items pass through; cost may be absent (z-image turbo)', () => {
    const items = parseImagesResponse('zimage', {
      data: [{ url: 'https://r2.example/a.jpg', storageKey: 'k' }],
    });
    expect(items).toEqual([{ kind: 'url', url: 'https://r2.example/a.jpg' }]);
  });
  test('entries without url or b64 are dropped, not crashed on', () => {
    expect(parseImagesResponse('seedream', { data: [{}] })).toEqual([]);
  });
  test('malformed payload (no data array) returns []', () => {
    expect(parseImagesResponse('seedream', { error: 'nope' })).toEqual([]);
  });
});
