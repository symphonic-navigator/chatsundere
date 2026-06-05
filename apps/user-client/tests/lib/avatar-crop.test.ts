// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { cropToBackground, fitDimensions } from '../../src/lib/avatar-crop.js';

describe('fitDimensions', () => {
  it('leaves small images untouched', () => {
    expect(fitDimensions(300, 200, 512)).toEqual({ width: 300, height: 200 });
  });
  it('scales the longest edge down to max, preserving aspect', () => {
    expect(fitDimensions(2048, 1024, 512)).toEqual({ width: 512, height: 256 });
    expect(fitDimensions(1000, 2000, 512)).toEqual({ width: 256, height: 512 });
  });
});

describe('cropToBackground', () => {
  it('covers a square box and centres a square image at zoom 1', () => {
    const bg = cropToBackground(100, 100, { x: 0, y: 0, zoom: 1 }, 200);
    expect(bg.backgroundSize).toBe('200px 200px');
    expect(bg.backgroundPosition).toBe('0px 0px');
  });
  it('applies zoom and fractional pan', () => {
    const bg = cropToBackground(100, 100, { x: 0.25, y: -0.25, zoom: 2 }, 200);
    // coverScale 2, *zoom 2 => 4 => 400px; centre offset (200-400)/2 = -100
    // pan x: +0.25*200 = +50 -> -50 ; pan y: -0.25*200 = -50 -> -150
    expect(bg.backgroundSize).toBe('400px 400px');
    expect(bg.backgroundPosition).toBe('-50px -150px');
  });
});
