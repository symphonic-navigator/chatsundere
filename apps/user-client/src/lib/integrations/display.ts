// SPDX-License-Identifier: AGPL-3.0-only

/** Marker name the integration layer uses for soft-glow display spans. */
const GLOW_CLASS = 'sfx-glow';

/**
 * Resolve a non-TEAL display marker name to its CSS class, or null when it is
 * not an integration display class. Used by the shared rehype wrap-resolver so
 * an integration glow span survives Markdown the same way a TEAL wrap does.
 */
export function resolveDisplayGlow(name: string): string | null {
  return name === GLOW_CLASS ? GLOW_CLASS : null;
}
