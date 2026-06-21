// SPDX-License-Identifier: AGPL-3.0-only

/** Clamp a number into the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Compute a CSS `transform-origin` value placing the visual origin at the
 * centre of `trigger`, expressed as percentages of `stage`. Lets a surface
 * zoom out of the element that opened it (the Unified-Experience motion,
 * spec §3). Result is clamped to 0–100% so off-stage triggers stay sane.
 */
export function computeTransformOrigin(trigger: DOMRect, stage: DOMRect): string {
  const cx = trigger.left + trigger.width / 2 - stage.left;
  const cy = trigger.top + trigger.height / 2 - stage.top;
  const x = clamp((cx / stage.width) * 100, 0, 100);
  const y = clamp((cy / stage.height) * 100, 0, 100);
  return `${+x.toFixed(2)}% ${+y.toFixed(2)}%`;
}
