// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { computeTransformOrigin } from '../../src/lib/origin-zoom.js';

function rect(x: number, y: number, w: number, h: number): DOMRect {
  return {
    left: x,
    top: y,
    width: w,
    height: h,
    right: x + w,
    bottom: y + h,
    x,
    y,
    toJSON: () => ({}),
  };
}

describe('computeTransformOrigin', () => {
  it('returns the centre of a trigger as a percentage of the stage', () => {
    const stage = rect(0, 0, 200, 400);
    const trigger = rect(50, 100, 100, 100); // centre at (100, 150)
    expect(computeTransformOrigin(trigger, stage)).toBe('50% 37.5%');
  });

  it('offsets by the stage origin', () => {
    const stage = rect(100, 200, 200, 200);
    const trigger = rect(150, 250, 100, 100); // centre (200, 300) → (100,100) within stage
    expect(computeTransformOrigin(trigger, stage)).toBe('50% 50%');
  });

  it('clamps to the 0–100 range for triggers outside the stage', () => {
    const stage = rect(0, 0, 100, 100);
    const trigger = rect(-50, 200, 10, 10); // centre (-45, 205)
    expect(computeTransformOrigin(trigger, stage)).toBe('0% 100%');
  });
});
