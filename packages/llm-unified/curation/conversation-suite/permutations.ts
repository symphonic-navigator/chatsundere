// SPDX-License-Identifier: LGPL-3.0-only
import type { ReasoningControl } from '../../src/catalogue/types.js';
import { assertReasoningAbsent, assertReasoningPresent } from './assertions.js';
import type { ReasoningPermutation } from './scenario.js';

const EFFORTS = new Set(['low', 'medium', 'high']);

/**
 * Build the reasoning permutation matrix from an offering's ReasoningControl,
 * attaching the correct reasoning assertion to each (design D3): a reasoning-off
 * permutation asserts `reasoning-absent`; every reasoning-on / effort permutation
 * asserts `reasoning-present`. This is what catches a model that reasons when
 * asked off (the chutes GLM 5.1 `reasoning_effort` omit-vs-`none` bug) or stays
 * silent when asked on.
 */
export function permutationsForReasoning(control: ReasoningControl): ReasoningPermutation[] {
  switch (control.mode) {
    case 'none':
      return [
        { label: 'reasoning-off', intent: { enabled: false }, assertions: [assertReasoningAbsent] },
      ];
    case 'fixed-on':
      return [
        { label: 'reasoning-on', intent: { enabled: true }, assertions: [assertReasoningPresent] },
      ];
    case 'toggle':
      return [
        { label: 'reasoning-off', intent: { enabled: false }, assertions: [assertReasoningAbsent] },
        { label: 'reasoning-on', intent: { enabled: true }, assertions: [assertReasoningPresent] },
      ];
    case 'steps': {
      const perms: ReasoningPermutation[] = [];
      if (control.offStep !== null) {
        perms.push({
          label: 'reasoning-off',
          intent: { enabled: false },
          assertions: [assertReasoningAbsent],
        });
      }
      for (const step of control.steps) {
        const effort = EFFORTS.has(step) ? (step as 'low' | 'medium' | 'high') : undefined;
        perms.push({
          label: `effort:${step}`,
          intent: effort ? { enabled: true, effort } : { enabled: true },
          assertions: [assertReasoningPresent],
        });
      }
      return perms;
    }
  }
}
