// SPDX-License-Identifier: AGPL-3.0-only

/** The instruction every new persona starts with: chat-ready out of the box,
 *  and cleared the moment the user focuses the field to write their own. */
export const DEFAULT_PERSONA_INSTRUCTIONS = 'You are a friendly assistant.';

/** Imported instructions, or the default when the import carries none — an
 *  import must never leave a persona incomplete on instructions. */
export function instructionsOrDefault(raw: string): string {
  return raw.trim() ? raw : DEFAULT_PERSONA_INSTRUCTIONS;
}
