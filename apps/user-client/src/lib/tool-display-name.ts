// SPDX-License-Identifier: AGPL-3.0-only

// One table for the chat pill and the Markdown export, so a tool reads the
// same in the file as on screen. Only tools whose raw name means little to a
// user get an entry.
const TOOL_DISPLAY_NAMES: ReadonlyMap<string, string> = new Map([
  ['write_memory_entry', 'Remembered'],
]);

/** The name a tool call shows to the user: its display name, else the raw tool name. */
export function toolDisplayName(name: string): string {
  return TOOL_DISPLAY_NAMES.get(name) ?? name;
}
