// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { isReasoningControl } from './types.js';

describe('isReasoningControl', () => {
  it('accepts each of the four control modes', () => {
    expect(isReasoningControl({ mode: 'none' })).toBe(true);
    expect(isReasoningControl({ mode: 'fixed-on' })).toBe(true);
    expect(isReasoningControl({ mode: 'toggle', defaultOn: true })).toBe(true);
    expect(
      isReasoningControl({
        mode: 'steps',
        steps: ['off', 'low'],
        offStep: 'off',
        defaultStep: 'low',
      }),
    ).toBe(true);
  });

  it('rejects an unknown mode', () => {
    expect(isReasoningControl({ mode: 'wat' })).toBe(false);
    expect(isReasoningControl(null)).toBe(false);
  });
});
