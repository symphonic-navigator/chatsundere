// SPDX-License-Identifier: LGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import type { NormalisedUsage, StreamChunk } from './types.js';

describe('StreamChunk variants', () => {
  it('StreamChunk accepts a reasoning variant with text payload', () => {
    const chunk = { type: 'reasoning' as const, text: 'let me think …' } satisfies StreamChunk;
    expect(chunk.type).toBe('reasoning');
    expect(chunk.text).toBe('let me think …');
  });

  it('StreamChunk accepts a usage variant', () => {
    const chunk = {
      type: 'usage' as const,
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } satisfies NormalisedUsage,
    } satisfies StreamChunk;
    expect(chunk.usage.totalTokens).toBe(3);
  });
});
