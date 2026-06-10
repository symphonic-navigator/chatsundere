// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Aspect × resolution -> [width, height] for GPT Image 2 on nano-gpt
 * (wavespeed-routed). Hardcoded so the same config always hits the same
 * upstream size — deterministic tests, quotable dimensions. The upstream
 * accepts arbitrary sizes within 512–2560 px per dimension and
 * 655,360–3,686,400 total pixels, but only returns the requested size
 * pixel-exact when both dimensions are multiples of 32; off-grid requests are
 * snapped up ratio-preserving (1080x1920 came back as 1152x2048). Every cell
 * below is a multiple of 32, an exact ratio, and was delivered pixel-exact in
 * the live probe sweep of 2026-06-10. The 2K 21:9 cell is width-capped at the
 * 2560 px dimension limit, so its pixel count sits below the other 2K cells.
 */
export const GPT_IMAGE_2_RESOLUTIONS: Record<string, [number, number]> = {
  '1:1|1k': [1024, 1024],
  '1:1|2k': [1920, 1920],
  '16:9|1k': [1536, 864],
  '16:9|2k': [2560, 1440],
  '9:16|1k': [864, 1536],
  '9:16|2k': [1440, 2560],
  '4:3|1k': [1152, 864],
  '4:3|2k': [2176, 1632],
  '3:4|1k': [864, 1152],
  '3:4|2k': [1632, 2176],
  '3:2|1k': [1248, 832],
  '3:2|2k': [2304, 1536],
  '2:3|1k': [832, 1248],
  '2:3|2k': [1536, 2304],
  '21:9|1k': [1568, 672],
  '21:9|2k': [2464, 1056],
};

/** Look up [width, height]; throws on an unknown combination (programming error —
 *  the typed GptImage2Config prevents it at every call site). */
export function gptImage2Resolution(aspect: string, resolution: string): [number, number] {
  const hit = GPT_IMAGE_2_RESOLUTIONS[`${aspect}|${resolution}`];
  if (!hit) throw new Error(`gpt-image-2: no resolution for ${aspect} x ${resolution}`);
  return hit;
}
