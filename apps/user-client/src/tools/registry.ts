// SPDX-License-Identifier: AGPL-3.0-only
import type { ToolDef } from '@chatsundere/llm-unified';
import { calculateJs } from './calculate-js.js';
import type { Tool, ToolResult } from './types.js';

/** Every tool is always offered (omakase — no per-tool toggle). One entry today. */
const TOOLS: readonly Tool[] = [calculateJs];

const BY_NAME = new Map<string, Tool>(TOOLS.map((t) => [t.name, t]));

/** Wire tool definitions for the request. The manager passes these to
 *  `runStreamEngine` → `streamCompletion` only when the offering supports tools. */
export function toolDefs(): ToolDef[] {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

/** Joined non-null `systemPromptInstruction`s for the prompt's Band-3 tools
 *  segment, or `null` when nothing to add. */
export function systemPromptSegment(): string | null {
  const lines = TOOLS.map((t) => t.systemPromptInstruction).filter((s): s is string => s !== null);
  return lines.length > 0 ? lines.join('\n\n') : null;
}

/** Execute a tool by name. An unknown name returns a structured error rather
 *  than throwing — a model can hallucinate a tool name. */
export function dispatch(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const tool = BY_NAME.get(name);
  if (!tool) {
    return Promise.resolve({ ok: false, output: '', error: `Unknown tool: ${name}` });
  }
  return tool.execute(args, signal);
}
