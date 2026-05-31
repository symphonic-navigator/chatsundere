// SPDX-License-Identifier: LGPL-3.0-only
import type { DiscoveredOffering } from './provider-scanner.js';

/** One raw entry from Tensorix's GET /v1/models (the fields we care about). */
export interface TensorixModelEntry {
  id: string;
}

/**
 * Group Tensorix's model list into offerings. Tensorix uses flat `org/model`
 * slugs — no reasoning-sibling slugs (reasoning is the body `reasoning_effort`
 * param) and no TEE-prefix zoo, so it is one offering per id, like wafer.
 *
 * The one wrinkle: Tensorix lists the same model twice under different casing
 * (e.g. `moonshotai/Kimi-K2.6` and `moonshotai/kimi-k2.6` — confirmed live
 * 2026-05-31, identical specs). We deduplicate case-insensitively, keeping the
 * first occurrence, so discovery surfaces each model once.
 */
export function groupTensorixModels(models: TensorixModelEntry[]): DiscoveredOffering[] {
  const seen = new Set<string>();
  const offerings: DiscoveredOffering[] = [];
  for (const m of models) {
    const key = m.id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    offerings.push({ providerId: 'tensorix', baseSlug: m.id });
  }
  return offerings;
}
