// SPDX-License-Identifier: LGPL-3.0-only
import type { WebInterfacingProvider } from './web-interfacing.js';

/** A factory producing a web-interfacing adapter instance. */
export type WebAdapterFactory = () => WebInterfacingProvider;

const REGISTRY = new Map<string, WebAdapterFactory>();

/** Register a web adapter under a catalogue adapter id. Called at curation /
 *  bootstrap time (no registrations exist yet — the spine is dormant). */
export function registerWebAdapter(adapterId: string, factory: WebAdapterFactory): void {
  REGISTRY.set(adapterId, factory);
}

/** Resolve a web adapter by id, or `null` when none is registered. */
export function resolveWebAdapter(adapterId: string): WebInterfacingProvider | null {
  const factory = REGISTRY.get(adapterId);
  return factory ? factory() : null;
}

/** Test-only — clears registry state. */
export function _resetWebAdapterRegistryForTests(): void {
  REGISTRY.clear();
}
