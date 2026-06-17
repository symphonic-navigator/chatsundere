// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'vitest';
import { RedemptionTracker } from '../../../../src/lib/voice/dictation/redemption-tracker.js';

const opts = {
  positiveSpeechThreshold: 0.65,
  negativeSpeechThreshold: 0.5,
  redemptionMs: 960, // 10 frames at 96 ms — round numbers for the test
  frameMs: 96,
};

describe('RedemptionTracker', () => {
  test('stays at 0 before any speech is detected', () => {
    const t = new RedemptionTracker(opts);
    expect(t.frame(0.1)).toBe(0);
    expect(t.frame(0.4)).toBe(0);
  });

  test('fills from 0 to 1 over the redemption window once speech then silence', () => {
    const t = new RedemptionTracker(opts);
    expect(t.frame(0.9)).toBe(0); // speech — resets/holds at 0
    // five silent frames = 480 ms of 960 ms ⇒ 0.5
    let f = 0;
    for (let i = 0; i < 5; i++) f = t.frame(0.1);
    expect(f).toBeCloseTo(0.5, 5);
    // five more ⇒ clamps at 1
    for (let i = 0; i < 5; i++) f = t.frame(0.1);
    expect(f).toBe(1);
    // never exceeds 1
    expect(t.frame(0.1)).toBe(1);
  });

  test('resumed speech resets the fill to 0', () => {
    const t = new RedemptionTracker(opts);
    t.frame(0.9);
    t.frame(0.1);
    t.frame(0.1);
    expect(t.frame(0.9)).toBe(0); // back above the positive threshold ⇒ reset
    expect(t.frame(0.1)).toBeCloseTo(96 / 960, 5);
  });

  test('reset() returns to the pre-speech state', () => {
    const t = new RedemptionTracker(opts);
    t.frame(0.9);
    t.frame(0.1);
    t.reset();
    expect(t.frame(0.1)).toBe(0); // no speech seen since reset ⇒ still 0
  });
});
