// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Pixel tables for the `size-table` wire, keyed `${aspect}|${resolution ?? '-'}`.
 * Hardcoded so the same config always hits the same upstream size —
 * deterministic tests, quotable dimensions.
 */
type SizeTable = Readonly<Record<string, readonly [number, number]>>;

/**
 * Seedream 4.5 (nano-gpt). Every cell meets nano-gpt's 3,686,400-pixel minimum
 * and is a multiple of 32. The tiers target ~3.7M / ~5M / ~7M pixels; they were
 * labelled standard / high / ultra before the 2026-10-07 unification. Ported
 * from chatsune's `_nano_gpt_image_groups.py`.
 */
export const SEEDREAM_4_5_SIZES: SizeTable = {
  '1:1|2k': [1920, 1920],
  '1:1|2.2k': [2240, 2240],
  '1:1|2.7k': [2656, 2656],
  '16:9|2k': [2560, 1440],
  '16:9|2.2k': [2976, 1664],
  '16:9|2.7k': [3520, 1984],
  '9:16|2k': [1440, 2560],
  '9:16|2.2k': [1664, 2976],
  '9:16|2.7k': [1984, 3520],
  '4:3|2k': [2240, 1664],
  '4:3|2.2k': [2592, 1952],
  '4:3|2.7k': [3072, 2304],
  '3:4|2k': [1664, 2240],
  '3:4|2.2k': [1952, 2592],
  '3:4|2.7k': [2304, 3072],
  '3:2|2k': [2368, 1568],
  '3:2|2.2k': [2752, 1824],
  '3:2|2.7k': [3264, 2176],
  '2:3|2k': [1568, 2368],
  '2:3|2.2k': [1824, 2752],
  '2:3|2.7k': [2176, 3264],
};

/**
 * GPT Image 2 (nano-gpt, wavespeed-routed). The upstream accepts 512–2560 px per
 * side and 655,360–3,686,400 pixels, and is pixel-exact only when both sides are
 * multiples of 32; every cell is, and was delivered exactly in the 2026-06-10
 * sweep. The 2k 21:9 cell is width-capped at 2560 px.
 */
export const GPT_IMAGE_2_SIZES: SizeTable = {
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

/** Z-Image Turbo (nano-gpt): one catalogue size per aspect. */
export const Z_IMAGE_TURBO_SIZES: SizeTable = {
  '1:1|-': [1024, 1024],
  '16:9|-': [1280, 720],
  '9:16|-': [720, 1280],
  '3:2|-': [1536, 1024],
  '2:3|-': [1024, 1536],
};

/** Z-Image Base (nano-gpt): its catalogue sizes top out at 1024 px. */
export const Z_IMAGE_BASE_SIZES: SizeTable = {
  '1:1|-': [1024, 1024],
  '16:9|-': [1024, 576],
  '9:16|-': [576, 1024],
  '4:3|-': [1024, 768],
  '3:4|-': [768, 1024],
};

/** Seedream 5.0 Lite (nano-gpt): catalogue sizes, pixel-exact in the 2026-10-07 probe. */
export const SEEDREAM_5_LITE_SIZES: SizeTable = {
  '1:1|-': [2048, 2048],
  '16:9|-': [2560, 1440],
  '9:16|-': [1440, 2560],
  '3:2|-': [3072, 2048],
  '2:3|-': [2048, 3072],
};

/** Qwen Image 2.1 Pro (nano-gpt): catalogue sizes, pixel-exact in the 2026-10-07 probe. */
export const QWEN_IMAGE_2_1_PRO_SIZES: SizeTable = {
  '1:1|-': [2048, 2048],
  '16:9|-': [2730, 1536],
  '9:16|-': [1536, 2730],
  '4:3|-': [2364, 1773],
  '3:4|-': [1773, 2364],
  '3:2|-': [2508, 1672],
  '2:3|-': [1672, 2508],
};
