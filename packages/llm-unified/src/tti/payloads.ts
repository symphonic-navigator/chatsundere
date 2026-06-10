// SPDX-License-Identifier: LGPL-3.0-only
import type { ImageModelConfig } from './config.js';
import { gptImage2Resolution } from './gpt-image-2-resolutions.js';
import { seedreamResolution } from './seedream-resolutions.js';

/**
 * Build the OpenAI-shaped `/images/generations` body for a config + prompt +
 * count. The `response_format` split is empirical (spec §10): xAI's image CDN
 * is CORS-closed to browsers, so bytes come inline as `b64_json`; nano-gpt's
 * R2 bucket is CORS-open, so `url` keeps the POST response small.
 */
export function buildImagePayload(
  config: ImageModelConfig,
  prompt: string,
  n: number,
): Record<string, unknown> {
  switch (config.groupId) {
    case 'xai-imagine':
      return {
        model: config.tier === 'quality' ? 'grok-imagine-image-quality' : 'grok-imagine-image',
        prompt,
        n,
        response_format: 'b64_json',
        aspect_ratio: config.aspect,
        resolution: config.resolution,
      };
    case 'zimage':
      return {
        model: config.variant === 'base' ? 'z-image-base' : 'z-image-turbo',
        prompt,
        n,
        size: config.size,
        response_format: 'url',
      };
    case 'seedream': {
      const [w, h] = seedreamResolution(config.aspect, config.quality);
      return {
        model: 'seedream-v4.5',
        prompt,
        n,
        size: `${w}x${h}`,
        response_format: 'url',
      };
    }
    case 'gpt-image-2': {
      // `quality` passes through nano-gpt to the upstream and steers both cost
      // and latency (probed 2026-06-10: low $0.018/~24 s, medium $0.066/~70 s,
      // high $0.156/~3.5 min at 1024x1024).
      const [w, h] = gptImage2Resolution(config.aspect, config.resolution);
      return {
        model: 'gpt-image-2',
        prompt,
        n,
        size: `${w}x${h}`,
        quality: config.quality,
        response_format: 'url',
      };
    }
  }
}
