// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Resolves a persona's chosen font slug to the CSS variable that fronts the
 * actual webfont. Centralised so MessageBlock, PersonaGreeting, and the
 * Persona Editor topbar render the persona "voice" identically.
 *
 * Note: cursive currently shares Lora with serif; the visual distinction is
 * driven by italics applied at the call site (the editor's Font and Voice
 * accordion does this for its chip).
 */
export const FONT_VAR: Record<'sans' | 'serif' | 'cursive', string> = {
  sans: 'var(--font-sans)',
  serif: 'var(--font-display)',
  cursive: 'var(--font-display)',
};
