// SPDX-License-Identifier: LGPL-3.0-only
import type { ImageModelConfig, TtiDescriptor } from './descriptor.js';
import { carryOverConfig, isImageModelConfig, isValidConfigFor } from './image-config.js';

/**
 * The four per-group config shapes stored before the 2026-10-07 unification.
 * They still exist in synced settings from older devices and in the
 * `configSnapshot` of older generated-image artefacts.
 */
export type LegacyImageModelConfig =
  | { groupId: 'xai-imagine'; tier: 'normal' | 'quality'; resolution: '1k' | '2k'; aspect: string }
  | { groupId: 'zimage'; variant: 'turbo' | 'base'; size: string }
  | { groupId: 'seedream'; aspect: string; quality: 'standard' | 'high' | 'ultra' }
  | {
      groupId: 'gpt-image-2';
      aspect: string;
      resolution: '1k' | '2k';
      quality: 'low' | 'medium' | 'high';
    };

/** One image-generation settings slot as stored after the unification. */
export interface ImageSlot {
  ref: string;
  config: ImageModelConfig;
  /** Last config per offering picked in this slot — restored on return. */
  lastConfigByRef?: Record<string, ImageModelConfig>;
}

const SEEDREAM_TIER: Record<string, string> = { standard: '2k', high: '2.2k', ultra: '2.7k' };

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** '1280x720' → '16:9'; squares → '1:1'. Accepts `x` or `*` as separator. */
function aspectOfSize(size: string): string {
  const [w, h] = size.split(/[x*]/).map(Number);
  if (!w || !h) return '1:1';
  const d = gcd(w, h);
  return `${w / d}:${h / d}`;
}

/** Translate a legacy config (and, for Z-Image, its ref) into the new shape. */
function fromLegacy(
  ref: string,
  c: Record<string, unknown>,
): { ref: string; config: ImageModelConfig } | null {
  const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  switch (c.groupId) {
    case 'xai-imagine':
      return {
        ref,
        config: { aspect: s(c.aspect) ?? '1:1', resolution: s(c.resolution), quality: s(c.tier) },
      };
    case 'zimage':
      return {
        ref: c.variant === 'base' ? 'nano-gpt:z-image-base' : 'nano-gpt:z-image-turbo',
        config: { aspect: aspectOfSize(s(c.size) ?? ''), resolution: null, quality: null },
      };
    case 'seedream':
      return {
        ref,
        config: {
          aspect: s(c.aspect) ?? '1:1',
          resolution: SEEDREAM_TIER[s(c.quality) ?? ''] ?? null,
          quality: null,
        },
      };
    case 'gpt-image-2':
      return {
        ref,
        config: {
          aspect: s(c.aspect) ?? '1:1',
          resolution: s(c.resolution),
          quality: s(c.quality),
        },
      };
    default:
      return null;
  }
}

/**
 * Upgrade a stored slot of any vintage to the current shape. Runs wherever a
 * slot is read; the result is written back on the next save, so no Dexie
 * version is needed. Returns null only when the slot is junk or its offering no
 * longer exists — a known offering always yields a usable config.
 */
export function upgradeImageSlot(
  stored: unknown,
  lookup: (ref: string) => TtiDescriptor | undefined,
): ImageSlot | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const raw = stored as Record<string, unknown>;
  if (typeof raw.ref !== 'string') return null;

  let ref = raw.ref;
  let candidate: ImageModelConfig | null = null;
  if (isImageModelConfig(raw.config)) {
    candidate = raw.config;
  } else if (typeof raw.config === 'object' && raw.config !== null) {
    const legacy = fromLegacy(ref, raw.config as Record<string, unknown>);
    if (legacy) {
      ref = legacy.ref;
      candidate = legacy.config;
    }
  }

  const meta = lookup(ref);
  if (!meta) return null;
  let config = meta.defaults;
  if (candidate)
    config = isValidConfigFor(meta, candidate) ? candidate : carryOverConfig(candidate, meta);

  const slot: ImageSlot = { ref, config };
  if (typeof raw.lastConfigByRef === 'object' && raw.lastConfigByRef !== null) {
    const kept: Record<string, ImageModelConfig> = {};
    for (const [key, value] of Object.entries(raw.lastConfigByRef as Record<string, unknown>)) {
      const m = lookup(key);
      if (m && isImageModelConfig(value) && isValidConfigFor(m, value)) kept[key] = value;
    }
    if (Object.keys(kept).length > 0) slot.lastConfigByRef = kept;
  }
  return slot;
}
