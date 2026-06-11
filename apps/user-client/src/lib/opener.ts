// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The single user-turn instruction the opener is generated from. The system
 * prompt is the persona's own (job 'greeting'), so the message arrives in
 * character and honours the roleplay formatting rules.
 */
export function buildOpenerInstruction(rules: string): string {
  return `Compose your opening message to the user — the very first thing you say as they arrive. Follow these rules:

${rules.trim()}

Reply with the opening message only.`;
}
