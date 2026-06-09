// SPDX-License-Identifier: LGPL-3.0-only

/** Grok Imagine (xAI). `tier: 'quality'` maps to `grok-imagine-image-quality`. */
export interface XaiImagineConfig {
  groupId: 'xai-imagine';
  tier: 'normal' | 'quality';
  resolution: '1k' | '2k';
  aspect: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
}

/** Z-Image (nano-gpt). `variant: 'base'` maps to `z-image-base` (~10x slower). */
export interface ZImageConfig {
  groupId: 'zimage';
  variant: 'turbo' | 'base';
  size:
    | '256x256'
    | '512x512'
    | '768x768'
    | '1024x1024'
    | '1280x720'
    | '720x1280'
    | '1536x1024'
    | '1024x1536'
    | '1536x1536';
}

/** Seedream 4.5 (nano-gpt). Aspect x quality resolves via the resolution table. */
export interface SeedreamConfig {
  groupId: 'seedream';
  aspect: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3';
  quality: 'standard' | 'high' | 'ultra';
}

export type ImageModelConfig = XaiImagineConfig | ZImageConfig | SeedreamConfig;
export type TtiGroupId = ImageModelConfig['groupId'];

const XAI_ASPECTS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4']);
const ZIMAGE_SIZES = new Set([
  '256x256',
  '512x512',
  '768x768',
  '1024x1024',
  '1280x720',
  '720x1280',
  '1536x1024',
  '1024x1536',
  '1536x1536',
]);
const SEEDREAM_ASPECTS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']);

/** The defaults a freshly picked model starts from. */
export function defaultConfigFor(groupId: TtiGroupId): ImageModelConfig {
  switch (groupId) {
    case 'xai-imagine':
      return { groupId, tier: 'normal', resolution: '1k', aspect: '1:1' };
    case 'zimage':
      return { groupId, variant: 'turbo', size: '1024x1024' };
    case 'seedream':
      return { groupId, aspect: '1:1', quality: 'standard' };
  }
}

/** Hard cap for the tool's `count` parameter, per group (and Z-Image variant). */
export function maxCountFor(config: ImageModelConfig): number {
  switch (config.groupId) {
    case 'xai-imagine':
      return 10;
    case 'zimage':
      return config.variant === 'base' ? 4 : 10;
    case 'seedream':
      return 4;
  }
}

/** Runtime guard for configs deserialised from Dexie. */
export function isImageModelConfig(v: unknown): v is ImageModelConfig {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  switch (c.groupId) {
    case 'xai-imagine':
      return (
        (c.tier === 'normal' || c.tier === 'quality') &&
        (c.resolution === '1k' || c.resolution === '2k') &&
        typeof c.aspect === 'string' &&
        XAI_ASPECTS.has(c.aspect)
      );
    case 'zimage':
      return (
        (c.variant === 'turbo' || c.variant === 'base') &&
        typeof c.size === 'string' &&
        ZIMAGE_SIZES.has(c.size)
      );
    case 'seedream':
      return (
        typeof c.aspect === 'string' &&
        SEEDREAM_ASPECTS.has(c.aspect) &&
        (c.quality === 'standard' || c.quality === 'high' || c.quality === 'ultra')
      );
    default:
      return false;
  }
}
