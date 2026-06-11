// SPDX-License-Identifier: LGPL-3.0-only

import type { Offering, ServiceKind } from './catalogue/types.js';
import type { ProviderDefinition } from './types.js';

interface Entry {
  defn: ProviderDefinition;
  order: number;
}

let counter = 0;
const registry = new Map<string, Entry>();

/**
 * Register a provider definition. Duplicate ids throw — registration is
 * expected to happen exactly once at module load.
 */
export function registerProvider(defn: ProviderDefinition): void {
  if (registry.has(defn.id)) {
    throw new Error(`provider '${defn.id}' already registered`);
  }
  registry.set(defn.id, { defn, order: counter++ });
}

export function getProvider(id: string): ProviderDefinition | undefined {
  return registry.get(id)?.defn;
}

/**
 * All registered providers, sorted by sortPriority ascending. Ties are
 * broken by registration order. Returns a fresh array on each call so
 * callers can mutate freely.
 */
export function listProviders(): ProviderDefinition[] {
  return [...registry.values()]
    .sort((a, b) => a.defn.sortPriority - b.defn.sortPriority || a.order - b.order)
    .map((e) => e.defn);
}

/** Test-only — clears registry state. */
export function _resetRegistryForTests(): void {
  registry.clear();
  counter = 0;
}

const CONFIDENCE_RANK: Record<Offering['confidence'], number> = {
  verified: 0,
  partial: 1,
  heuristic: 2,
};

/**
 * Deterministic pick-time ordering: TEE first, then freedom-oriented
 * deployments, then provider sortPriority, then confidence. Never called on
 * the send path.
 */
export function rankOfferings(offerings: Offering[]): Offering[] {
  return [...offerings].sort((a, b) => {
    if (a.trust.tee !== b.trust.tee) return a.trust.tee ? -1 : 1;
    const fa = a.freedomOrientedDeployment === true ? 0 : 1;
    const fb = b.freedomOrientedDeployment === true ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const pa = getProvider(a.providerId)?.sortPriority ?? Number.MAX_SAFE_INTEGER;
    const pb = getProvider(b.providerId)?.sortPriority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
  });
}

/** All offerings across providers for a canonical, rank-sorted. */
export function listOfferings(canonicalId: string): Offering[] {
  const all = listProviders().flatMap((p) => p.offerings);
  return rankOfferings(all.filter((o) => o.canonicalRef === canonicalId));
}

/** Every curated TTS offering across all registered providers. */
export function listTtsOfferings(): Offering[] {
  return listProviders().flatMap((p) => p.offerings.filter((o) => o.serviceKind === 'tts'));
}

/** Every curated TTI offering across all registered providers. */
export function listTtiOfferings(): Offering[] {
  return listProviders().flatMap((p) => p.offerings.filter((o) => o.serviceKind === 'tti'));
}

/** Exact lookup for the send path: provider template id + upstream slug. */
export function getOffering(
  providerTemplateId: string,
  upstreamSlug: string,
): Offering | undefined {
  return getProvider(providerTemplateId)?.offerings.find((o) => o.upstreamSlug === upstreamSlug);
}

/** Canonical modality ordering used everywhere modalities are listed. */
export const MODALITY_ORDER: ServiceKind[] = ['llm', 'web', 'tts', 'stt', 'tti'];

function orderKinds(set: Set<ServiceKind>): ServiceKind[] {
  return MODALITY_ORDER.filter((k) => set.has(k));
}

/** Distinct modalities of a provider's offerings, in MODALITY_ORDER; [] if unknown. */
export function providerServiceKinds(providerId: string): ServiceKind[] {
  const defn = getProvider(providerId);
  if (!defn) return [];
  return orderKinds(new Set(defn.offerings.map((o) => o.serviceKind)));
}

/** Union of modalities across the given providers, in MODALITY_ORDER. */
export function aggregateServiceKinds(templateIds: string[]): ServiceKind[] {
  const set = new Set<ServiceKind>();
  for (const id of templateIds) for (const k of providerServiceKinds(id)) set.add(k);
  return orderKinds(set);
}

/** Template ids of registered providers with at least one offering of the kind. */
export function providersContributing(kind: ServiceKind): string[] {
  return listProviders()
    .filter((p) => p.offerings.some((o) => o.serviceKind === kind))
    .map((p) => p.id);
}
