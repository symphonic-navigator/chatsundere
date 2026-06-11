// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../../src/boot/client-data-db.js';
import {
  _voiceCacheOptsForTests,
  cacheDelete,
  cacheGet,
  cachePut,
  voiceCacheKey,
} from '../../../src/lib/voice/voice-cache.js';

function blobOf(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' });
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});

afterEach(async () => {
  _voiceCacheOptsForTests(); // reset to defaults
  await _resetClientDataDbForTests();
});

describe('voice cache', () => {
  it('voiceCacheKey is deterministic and scoped by every input', () => {
    const a = voiceCacheKey('hello', 'mistral', 'voxtral-mini-tts-2603', 'v1');
    expect(a).toBe(voiceCacheKey('hello', 'mistral', 'voxtral-mini-tts-2603', 'v1'));
    expect(a).not.toBe(voiceCacheKey('hello', 'mistral', 'voxtral-mini-tts-2603', 'v2'));
    expect(a).not.toBe(voiceCacheKey('hello!', 'mistral', 'voxtral-mini-tts-2603', 'v1'));
  });

  it('get touches lastUsedAt; eviction removes least-recently-used first; write counts as use', async () => {
    _voiceCacheOptsForTests({ maxBytes: 250 });
    await cachePut({ key: 'a', blob: blobOf(100), mimeType: 'audio/mpeg' });
    await cachePut({ key: 'b', blob: blobOf(100), mimeType: 'audio/mpeg' });
    await cacheGet('a'); // a is now fresher than b
    await cachePut({ key: 'c', blob: blobOf(100), mimeType: 'audio/mpeg' }); // 300 > 250 → evict b
    expect(await cacheGet('b')).toBeUndefined();
    expect(await cacheGet('a')).toBeDefined();
    expect(await cacheGet('c')).toBeDefined();
  });

  it('the just-written entry is never evicted, even when it alone exceeds the budget', async () => {
    _voiceCacheOptsForTests({ maxBytes: 50 });
    await cachePut({ key: 'big', blob: blobOf(100), mimeType: 'audio/mpeg' });
    expect(await cacheGet('big')).toBeDefined();
  });

  it('write order alone determines eviction rank when no gets have occurred', async () => {
    _voiceCacheOptsForTests({ maxBytes: 150 });
    await cachePut({ key: 'first', blob: blobOf(100), mimeType: 'audio/mpeg' });
    await cachePut({ key: 'second', blob: blobOf(100), mimeType: 'audio/mpeg' }); // 200 > 150 → evict first
    expect(await cacheGet('first')).toBeUndefined();
    expect(await cacheGet('second')).toBeDefined();
  });

  it('cacheDelete removes an entry', async () => {
    _voiceCacheOptsForTests({ maxBytes: 1000 });
    await cachePut({ key: 'x', blob: blobOf(10), mimeType: 'audio/mpeg' });
    await cacheDelete('x');
    expect(await cacheGet('x')).toBeUndefined();
  });
});
