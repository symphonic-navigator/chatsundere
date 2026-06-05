// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { MAX_EDGE, targetSize } from '../../src/attachments/image-normalise.js';

describe('targetSize', () => {
  it('does not upscale a small image', () => {
    expect(targetSize(600, 400)).toEqual({ width: 600, height: 400, resized: false });
  });

  it('scales the longest edge to MAX_EDGE preserving aspect (landscape)', () => {
    const r = targetSize(3000, 2000);
    expect(r.resized).toBe(true);
    expect(Math.max(r.width, r.height)).toBe(MAX_EDGE);
    expect(r.width).toBe(1024);
    expect(r.height).toBe(683);
  });

  it('scales the longest edge to MAX_EDGE preserving aspect (portrait)', () => {
    const r = targetSize(1000, 4000);
    expect(r.height).toBe(MAX_EDGE);
    expect(r.width).toBe(256);
  });
});
