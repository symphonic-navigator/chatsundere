// SPDX-License-Identifier: AGPL-3.0-only
import type { ToolDef } from '@chatsundere/llm-unified';
import type { Tool, ToolProgress, ToolResult } from './types.js';

/** Wire tool definitions for the given active tools. */
export function toolDefs(tools: Tool[]): ToolDef[] {
  return tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

/** Execute a tool by name within the given active set. An unknown name returns a
 *  structured error rather than throwing — a model can hallucinate a tool name. */
export function dispatch(
  tools: Tool[],
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  onProgress?: (p: ToolProgress) => void,
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return Promise.resolve({ ok: false, output: '', error: `Unknown tool: ${name}` });
  }
  return tool.execute(args, signal, onProgress);
}
