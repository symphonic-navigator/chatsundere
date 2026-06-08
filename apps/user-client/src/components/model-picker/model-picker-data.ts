// SPDX-License-Identifier: AGPL-3.0-only

import {
  type CanonicalModel,
  type Offering,
  getProvider,
  listCanonicals,
  listOfferings,
} from '@chatsundere/llm-unified';
import type { ProviderRow } from '../../boot/client-data-db.js';

export type ModelFilter = 'all' | 'vision';

/** A configured, filter-matching deployment of one canonical model. */
export interface PickerOffering {
  offering: Offering;
  /** Configured provider DB row id (what the persona draft stores). */
  providerRowId: string;
  providerDisplayName: string;
}

/** One canonical model with its reachable deployments. */
export interface PickerModel {
  canonical: CanonicalModel;
  offers: PickerOffering[];
  teeAvailable: boolean;
  zdrAvailable: boolean;
  /** Lowest provider sortPriority among `offers`; drives family ordering. */
  sortPriority: number;
}

export interface FamilyGroup {
  family: string;
  models: PickerModel[];
  sortPriority: number;
}

export interface PickerData {
  groups: FamilyGroup[];
  /** Canonicals relevant to the filter but with no reachable deployment yet. */
  hiddenCount: number;
}

/** The value the modal hands back; each call site maps it to its own storage. */
export interface ModelSelection {
  canonicalId: string;
  providerTemplateId: string;
  providerRowId: string;
  upstreamSlug: string;
}

/**
 * Group models under their family heading. Families are ordered by the lowest
 * provider sortPriority among their members (higher-priority providers' families
 * surface first), tie-broken alphabetically. Within a family the input order is
 * preserved, which is the curated catalogue order.
 */
export function groupModelsByFamily(models: PickerModel[]): FamilyGroup[] {
  const byFamily = new Map<string, PickerModel[]>();
  for (const m of models) {
    const arr = byFamily.get(m.canonical.family);
    if (arr) arr.push(m);
    else byFamily.set(m.canonical.family, [m]);
  }
  const groups: FamilyGroup[] = [];
  for (const [family, members] of byFamily) {
    const sortPriority = Math.min(...members.map((m) => m.sortPriority));
    groups.push({ family, models: members, sortPriority });
  }
  groups.sort((a, b) => a.sortPriority - b.sortPriority || a.family.localeCompare(b.family));
  return groups;
}

/**
 * Filter groups by a search query against model display names. Case-insensitive,
 * trimmed, substring ("contains"). An empty/whitespace query returns the groups
 * unchanged; families with no surviving model are dropped.
 */
export function filterGroupsByQuery(groups: FamilyGroup[], query: string): FamilyGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const out: FamilyGroup[] = [];
  for (const g of groups) {
    const models = g.models.filter((m) => m.canonical.displayName.toLowerCase().includes(q));
    if (models.length > 0) out.push({ ...g, models });
  }
  return out;
}

/**
 * Build the picker's model groups from the user's configured providers. An
 * offering counts only when its provider is both enabled (a DB row exists) and
 * usable (in `configuredTemplateIds`, which already accounts for the CORS proxy).
 * `hiddenCount` is how many otherwise-matching models would unlock with more
 * providers.
 */
export function buildPickerData(
  providers: ProviderRow[],
  configuredTemplateIds: string[],
  filter: ModelFilter,
): PickerData {
  const configuredByTemplate = new Map(
    providers.filter((p) => p.enabled).map((p) => [p.templateId, p] as const),
  );
  const usable = new Set(configuredTemplateIds);
  const matchesFilter = (o: Offering): boolean => filter === 'all' || o.profile.vision;

  const models: PickerModel[] = [];
  let hiddenCount = 0;

  for (const canonical of listCanonicals()) {
    // `listOfferings` is already rank-sorted (TEE → freedom → priority → confidence).
    const matching = listOfferings(canonical.id).filter(matchesFilter);
    if (matching.length === 0) continue; // not relevant to this filter at all

    const offers: PickerOffering[] = [];
    for (const offering of matching) {
      const row = configuredByTemplate.get(offering.providerId);
      if (!row || !usable.has(offering.providerId)) continue;
      offers.push({
        offering,
        providerRowId: row.id,
        providerDisplayName: getProvider(offering.providerId)?.displayName ?? offering.providerId,
      });
    }

    if (offers.length === 0) {
      hiddenCount += 1; // exists for this filter, just not on a configured provider
      continue;
    }

    const sortPriority = Math.min(
      ...offers.map(
        (o) => getProvider(o.offering.providerId)?.sortPriority ?? Number.MAX_SAFE_INTEGER,
      ),
    );
    models.push({
      canonical,
      offers,
      teeAvailable: offers.some((o) => o.offering.trust.tee),
      zdrAvailable: offers.some((o) => o.offering.trust.zdr),
      sortPriority,
    });
  }

  return { groups: groupModelsByFamily(models), hiddenCount };
}
