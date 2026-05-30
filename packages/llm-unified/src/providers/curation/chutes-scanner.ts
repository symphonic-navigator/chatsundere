// SPDX-License-Identifier: LGPL-3.0-only
import type { DiscoveredOffering } from './provider-scanner.js';

/** One raw entry from chutes' GET /v1/models. */
export interface ChutesModelEntry {
  id: string;
  confidential_compute?: boolean;
}

/**
 * Group chutes' model list into offerings. Chutes is simple compared to the
 * nano-gpt slug-zoo: one offering per model, TEE identified by the
 * `confidential_compute` boolean (the authoritative signal — not the `-TEE`
 * suffix). Reasoning is a body param (`reasoning_effort`), so there is no
 * reasoning-sibling slug to group.
 */
export function groupChutesModels(models: ChutesModelEntry[]): DiscoveredOffering[] {
  return models.map((m) => ({
    providerId: 'chutes',
    baseSlug: m.id,
    teeVariant: m.confidential_compute === true,
  }));
}
