// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { isCompactable, shouldFireValve, shouldShowToast } from '../../src/compaction/trigger.js';

describe('isCompactable', () => {
  it('is false for tiny chats', () => {
    expect(isCompactable(5, 100000)).toBe(false);
    expect(isCompactable(50, 100)).toBe(false);
  });
  it('is true past both thresholds', () => {
    expect(isCompactable(13, 4001)).toBe(true);
  });
});

describe('shouldShowToast', () => {
  it('fires once at 80 % when compactable and not yet shown', () => {
    expect(shouldShowToast(80, false, true)).toBe(true);
  });
  it('does not re-fire once shown', () => {
    expect(shouldShowToast(95, true, true)).toBe(false);
  });
  it('stays quiet below threshold or when not compactable', () => {
    expect(shouldShowToast(79, false, true)).toBe(false);
    expect(shouldShowToast(85, false, false)).toBe(false);
  });
});

describe('shouldFireValve', () => {
  it('fires at and above 90 %', () => {
    expect(shouldFireValve(90)).toBe(true);
    expect(shouldFireValve(99)).toBe(true);
  });
  it('stays quiet below 90 %', () => {
    expect(shouldFireValve(89)).toBe(false);
  });
});
