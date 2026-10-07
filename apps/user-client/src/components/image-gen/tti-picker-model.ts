// SPDX-License-Identifier: AGPL-3.0-only
import type { TtiDescriptor } from '@chatsundere/llm-unified';

export interface PickerOffering {
  ref: string;
  providerId: string;
  providerName: string;
  meta: TtiDescriptor;
  usable: boolean;
  /** null when usable. */
  reason: string | null;
}

export interface PickerFamily {
  family: string;
  /** Every offering of the family (after the nsfw filter), in catalogue order. */
  offerings: PickerOffering[];
  usable: boolean;
  /** The saved slot's offering is in this family. */
  selected: boolean;
  /** The saved slot's offering is in this family but its provider is unusable. */
  stale: boolean;
  /** Why the family is unusable (its first offering's reason); null when usable. */
  reason: string | null;
}

export interface VariantEntry {
  ref: string;
  label: string;
  disabled: boolean;
  selected: boolean;
  reason: string | null;
}

/**
 * Group TTI offerings into picker families (spec §3.1). Families without a
 * usable provider are kept and marked unusable — disabled over hidden.
 */
export function buildPickerFamilies(input: {
  offerings: ReadonlyArray<{ providerId: string; upstreamSlug: string; tti?: TtiDescriptor }>;
  usableTemplateIds: readonly string[];
  providerName: (providerId: string) => string;
  reasonFor: (providerId: string) => string;
  nsfwOnly: boolean;
  savedRef: string | null;
}): PickerFamily[] {
  const byFamily = new Map<string, PickerOffering[]>();
  for (const o of input.offerings) {
    const meta = o.tti;
    if (!meta) continue;
    if (input.nsfwOnly && !meta.canDoNsfw) continue;
    const usable = input.usableTemplateIds.includes(o.providerId);
    const entry: PickerOffering = {
      ref: `${o.providerId}:${o.upstreamSlug}`,
      providerId: o.providerId,
      providerName: input.providerName(o.providerId),
      meta,
      usable,
      reason: usable ? null : input.reasonFor(o.providerId),
    };
    const list = byFamily.get(meta.family) ?? [];
    list.push(entry);
    byFamily.set(meta.family, list);
  }
  return [...byFamily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, offerings]) => {
      const usable = offerings.some((o) => o.usable);
      const saved = offerings.find((o) => o.ref === input.savedRef);
      return {
        family,
        offerings,
        usable,
        selected: saved !== undefined,
        stale: saved !== undefined && !saved.usable,
        reason: usable ? null : (offerings[0]?.reason ?? null),
      };
    });
}

/**
 * The ref a tap on `family` should select, or null for "no change". A tap is a
 * no-op only when the saved offering is in this family AND usable — a stale
 * saved offering moves to a usable variant, so the user is never stuck.
 */
export function familyTapTarget(family: PickerFamily, savedRef: string | null): string | null {
  const saved = family.offerings.find((o) => o.ref === savedRef);
  if (saved?.usable) return null;
  const usable = family.offerings.filter((o) => o.usable);
  return (usable.find((o) => o.meta.recommended) ?? usable[0])?.ref ?? null;
}

/**
 * The Variant row: usable offerings plus the saved one when stale (greyed,
 * with its reason). The provider is appended only when the row spans several
 * providers; a latency hint is appended when the descriptor has one.
 */
export function variantEntries(family: PickerFamily, savedRef: string | null): VariantEntry[] {
  const shown = family.offerings.filter((o) => o.usable || o.ref === savedRef);
  const spansProviders = new Set(shown.map((o) => o.providerId)).size > 1;
  return shown.map((o) => {
    const parts = [o.meta.variant ?? o.meta.displayName];
    if (spansProviders) parts.push(o.providerName);
    if (o.meta.latencyHint) parts.push(o.meta.latencyHint);
    return {
      ref: o.ref,
      label: parts.join(' · '),
      disabled: !o.usable,
      selected: o.ref === savedRef,
      reason: o.reason,
    };
  });
}
