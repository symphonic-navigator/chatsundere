// SPDX-License-Identifier: LGPL-3.0-only

export type FreedomState = 'free' | 'restricted' | 'unknown';

/**
 * Effective freedom is the AND of model-intrinsic and deployment freedom.
 * `null` on either side (uncurated / unassessed) yields 'unknown' — absence of
 * evidence is not evidence of restriction.
 */
export function effectiveFreedom(
  modelFreedom: boolean | null,
  deploymentFreedom: boolean | null,
): FreedomState {
  if (modelFreedom === null || deploymentFreedom === null) return 'unknown';
  return modelFreedom && deploymentFreedom ? 'free' : 'restricted';
}
