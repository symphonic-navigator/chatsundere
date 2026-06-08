// SPDX-License-Identifier: AGPL-3.0-only
import type { ReasoningIntent, ToolDef } from '@chatsundere/llm-unified';
import { INTEGRATIONS } from '../integrations/index.js';
import type { IntegrationContext } from '../integrations/types.js';
import { type KnowledgeContext, contributeKnowledgeTools } from '../knowledge/query-tool.js';
import { type ExpertBase, createAskExpertTool } from './ask-expert.js';
import { calculateJs } from './calculate-js.js';
import type { Tool, ToolResult } from './types.js';

/** Always-on tools (omakase — no per-tool toggle). */
const STATIC_TOOLS: readonly Tool[] = [calculateJs];

/** Resolved expert model context, passed in from the send path which holds the MasterKey. */
export interface ExpertToolContext {
  base: ExpertBase;
  modelLabel: string;
  reasoning: ReasoningIntent;
  runtimeEnabled: boolean;
}

/** The active tool set for this send: static tools, every integration-contributed
 *  tool, the local context tools (knowledgebase) when a context is present, and
 *  the ask_expert tool when an expert context is given. */
export function resolveActiveTools(
  ctx: IntegrationContext,
  knowledge: KnowledgeContext | null = null,
  expert: ExpertToolContext | null = null,
): Tool[] {
  return [
    ...STATIC_TOOLS,
    ...INTEGRATIONS.flatMap((i) => i.contributesTools(ctx)),
    ...(knowledge ? contributeKnowledgeTools(knowledge) : []),
    ...(expert
      ? [
          createAskExpertTool(
            expert.base,
            expert.modelLabel,
            expert.reasoning,
            expert.runtimeEnabled,
          ),
        ]
      : []),
  ];
}

/** Wire tool definitions for the given active tools. */
export function toolDefs(tools: Tool[]): ToolDef[] {
  return tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

/** Joined non-null `systemPromptInstruction`s for the Band-3 tools segment, or
 *  `null` when nothing to add. */
export function systemPromptSegment(tools: Tool[]): string | null {
  const lines = tools.map((t) => t.systemPromptInstruction).filter((s): s is string => s !== null);
  return lines.length > 0 ? lines.join('\n\n') : null;
}

/** Execute a tool by name within the given active set. An unknown name returns a
 *  structured error rather than throwing — a model can hallucinate a tool name. */
export function dispatch(
  tools: Tool[],
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  onProgress?: (p: import('./types.js').ToolProgress) => void,
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return Promise.resolve({ ok: false, output: '', error: `Unknown tool: ${name}` });
  }
  return tool.execute(args, signal, onProgress);
}
