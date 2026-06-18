// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { convertChatsuneCrop } from '../../../src/lib/chatsune-import/crop-convert.js';

describe('convertChatsuneCrop', () => {
  it('maps chatsune default framing (zoom = diameter/shortSide) to chatsundere zoom 1', () => {
    // shortSide 1000, default chatsune zoom = 220/1000 = 0.22 → expect zoom 1.
    const out = convertChatsuneCrop({ x: 0, y: 0, zoom: 220 / 1000, width: 1000, height: 1000 });
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.zoom).toBeCloseTo(1, 5);
  });

  it('converts pixel offsets to fractions of 220', () => {
    const out = convertChatsuneCrop({ x: 44, y: -22, zoom: 220 / 1000, width: 1000, height: 1000 });
    expect(out.x).toBeCloseTo(0.2, 5);
    expect(out.y).toBeCloseTo(-0.1, 5);
  });

  it('clamps a below-cover zoom up to 1', () => {
    // chatsune zoom below the cover threshold → chatsundere cannot represent → clamp to 1.
    const out = convertChatsuneCrop({ x: 0, y: 0, zoom: 0.05, width: 1000, height: 1000 });
    expect(out.zoom).toBe(1);
  });

  it('clamps a very large zoom down to 3', () => {
    const out = convertChatsuneCrop({ x: 0, y: 0, zoom: 5, width: 1000, height: 1000 });
    expect(out.zoom).toBe(3);
  });
});
