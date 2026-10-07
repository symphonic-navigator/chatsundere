// SPDX-License-Identifier: LGPL-3.0-only
import type { ImageModelConfig, TtiDescriptor, TtiOption } from './descriptor.js';

/** The key under which `priceCents` and `latency` store a config's values. */
export function priceKey(c: Pick<ImageModelConfig, 'resolution' | 'quality'>): string {
  return `${c.resolution ?? '-'}|${c.quality ?? '-'}`;
}

/** Shape guard for configs deserialised from Dexie or sync. */
export function isImageModelConfig(v: unknown): v is ImageModelConfig {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  if ('groupId' in c) return false;
  return (
    typeof c.aspect === 'string' &&
    (c.resolution === null || typeof c.resolution === 'string') &&
    (c.quality === null || typeof c.quality === 'string')
  );
}

function rowAccepts(options: readonly TtiOption[] | null, value: string | null): boolean {
  if (options === null) return value === null;
  return value !== null && options.some((o) => o.id === value);
}

/** True when every choice in `c` is one the offering actually offers. */
export function isValidConfigFor(meta: TtiDescriptor, c: ImageModelConfig): boolean {
  return (
    meta.aspects.includes(c.aspect) &&
    rowAccepts(meta.resolutions, c.resolution) &&
    rowAccepts(meta.qualities, c.quality)
  );
}

/**
 * Carry the previous choices onto another offering: each field survives when
 * the next offering supports it, otherwise it takes the next offering's default.
 */
export function carryOverConfig(prev: ImageModelConfig, next: TtiDescriptor): ImageModelConfig {
  return {
    aspect: next.aspects.includes(prev.aspect) ? prev.aspect : next.defaults.aspect,
    resolution: next.resolutions?.some((r) => r.id === prev.resolution)
      ? prev.resolution
      : next.defaults.resolution,
    quality: next.qualities?.some((q) => q.id === prev.quality)
      ? prev.quality
      : next.defaults.quality,
  };
}

/** Estimated cents per image for a config, if the descriptor prices it. */
export function priceCentsFor(meta: TtiDescriptor, c: ImageModelConfig): number | undefined {
  return meta.priceCents[priceKey(c)];
}

/** Wait-time hint for a config, if the descriptor has one. */
export function latencyFor(meta: TtiDescriptor, c: ImageModelConfig): string | undefined {
  return meta.latency?.[priceKey(c)];
}

/** `5¢`, `2.7¢`, `$1.20`; a leading `~` marks usage-billed estimates. */
export function formatPriceCents(cents: number, billing: 'fixed' | 'usage'): string {
  const body = cents >= 100 ? `$${(cents / 100).toFixed(2)}` : `${Number(cents.toFixed(1))}¢`;
  return billing === 'usage' ? `~${body}` : body;
}
