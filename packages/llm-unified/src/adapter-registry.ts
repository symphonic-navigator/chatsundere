// SPDX-License-Identifier: LGPL-3.0-only
import type { ModelAdapter } from './adapter-contract.js';

const registry = new Map<string, ModelAdapter>();

/**
 * Register a hand-written adapter under a stable id (e.g. 'chutes-openai').
 * Duplicate ids throw — registration happens once at module load.
 */
export function registerAdapter(id: string, adapter: ModelAdapter): void {
  if (registry.has(id)) {
    throw new Error(`adapter '${id}' already registered`);
  }
  registry.set(id, adapter);
}

/** Resolve an adapter by id, or undefined if none is registered. */
export function getAdapter(id: string): ModelAdapter | undefined {
  return registry.get(id);
}

/** Test-only — clears registry state. */
export function _resetAdapterRegistryForTests(): void {
  registry.clear();
}
