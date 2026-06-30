// SPDX-License-Identifier: LGPL-3.0-only
import { emojiShowerIntegration } from './screen-effects/emoji-shower.js';
import type { Integration } from './types.js';

const REGISTRY: ReadonlyMap<string, Integration> = new Map([
  [emojiShowerIntegration.prefix, emojiShowerIntegration],
]);

/** Set of registered prefixes — the streaming detector's weiche checks membership cheaply. */
export const INTEGRATION_PREFIXES: ReadonlySet<string> = new Set(REGISTRY.keys());

/** Resolve a prefix to its integration, or null when unregistered. */
export function getIntegration(prefix: string): Integration | null {
  return REGISTRY.get(prefix) ?? null;
}
