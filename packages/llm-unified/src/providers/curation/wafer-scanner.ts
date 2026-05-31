// SPDX-License-Identifier: LGPL-3.0-only
import type { DiscoveredOffering } from './provider-scanner.js';

/** One raw entry from wafer's GET /v1/models (the fields we care about). */
export interface WaferModelEntry {
  id: string;
  zdr_supported?: boolean;
}

/**
 * Group wafer's model list into offerings. Wafer is even simpler than chutes:
 * one offering per model id, no reasoning-sibling slugs and no TEE-prefix zoo.
 * ZDR is a per-model boolean (`zdr_supported`) on /models, but discovery only
 * tames slugs — the authoritative ZDR posture lives on the hand-written
 * Offering's `trust.zdr` (which drives the `Wafer-ZDR: required` header in the
 * adapter), so it is not carried here.
 */
export function groupWaferModels(models: WaferModelEntry[]): DiscoveredOffering[] {
  return models.map((m) => ({
    providerId: 'wafer',
    baseSlug: m.id,
  }));
}
