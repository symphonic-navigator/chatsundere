// SPDX-License-Identifier: AGPL-3.0-only

/** Wire names of every tool Chatsundere itself provides (everything except MCP). */
export const BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'calculate_js',
  'list_artefacts',
  'create_artefact',
  'modify_artefact',
  'inspect_artefact',
  'web_search',
  'web_fetch',
  'query_knowledgebase',
  'ask_expert',
  'generate_image',
  'write_memory_entry',
]);
