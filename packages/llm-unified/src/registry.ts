// SPDX-License-Identifier: LGPL-3.0-only

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
