// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Aspect × quality -> [width, height] for Seedream 4.5 on nano-gpt. Hardcoded
 * (not computed) so the same config always hits the same upstream size --
 * deterministic tests, quotable dimensions. Every cell satisfies nano-gpt's
 * 3,686,400-pixel minimum and is a multiple of 32 in both dimensions.
 * Quality tiers target ~3.7M / ~5M / ~7M total pixels. Ported verbatim from
 * chatsune's `_nano_gpt_image_groups.py`.
 */
export const SEEDREAM_RESOLUTIONS: Record<string, [number, number]> = {
  '1:1|standard': [1920, 1920],
  '1:1|high': [2240, 2240],
  '1:1|ultra': [2656, 2656],
  '16:9|standard': [2560, 1440],
  '16:9|high': [2976, 1664],
  '16:9|ultra': [3520, 1984],
  '9:16|standard': [1440, 2560],
  '9:16|high': [1664, 2976],
  '9:16|ultra': [1984, 3520],
  '4:3|standard': [2240, 1664],
  '4:3|high': [2592, 1952],
  '4:3|ultra': [3072, 2304],
  '3:4|standard': [1664, 2240],
  '3:4|high': [1952, 2592],
  '3:4|ultra': [2304, 3072],
  '3:2|standard': [2368, 1568],
  '3:2|high': [2752, 1824],
  '3:2|ultra': [3264, 2176],
  '2:3|standard': [1568, 2368],
  '2:3|high': [1824, 2752],
  '2:3|ultra': [2176, 3264],
};

/** Look up [width, height]; throws on an unknown combination (programming error --
 *  the typed SeedreamConfig prevents it at every call site). */
export function seedreamResolution(aspect: string, quality: string): [number, number] {
  const hit = SEEDREAM_RESOLUTIONS[`${aspect}|${quality}`];
  if (!hit) throw new Error(`seedream: no resolution for ${aspect} x ${quality}`);
  return hit;
}
