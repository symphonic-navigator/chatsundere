// SPDX-License-Identifier: AGPL-3.0-only
import type { ReasoningIntent } from '@chatsundere/llm-unified';
import { INTEGRATIONS } from '../integrations/index.js';
import type { IntegrationContext } from '../integrations/types.js';
import { type KnowledgeContext, contributeKnowledgeTools } from '../knowledge/query-tool.js';
import { type McpToolContext, contributeMcpTools } from '../mcp/mcp-tools.js';
import { type ExpertBase, type ExpertWeb, createAskExpertTool } from './ask-expert.js';
import { calculateJs } from './calculate-js.js';
import { type ImageToolContext, contributeImageTool } from './generate-image.js';
import type { Tool } from './types.js';
import { type MemoryToolContext, contributeMemoryTool } from './write-memory.js';

/** Always-on tools (omakase — no per-tool toggle). */
const STATIC_TOOLS: readonly Tool[] = [calculateJs];

/** Resolved expert model context, passed in from the send path which holds the MasterKey. */
export interface ExpertToolContext {
  base: ExpertBase;
  modelLabel: string;
  reasoning: ReasoningIntent;
  runtimeEnabled: boolean;
  /** Optional web access for the expert: resolved tools + round cap. */
  web?: ExpertWeb;
}

/** The active tool set for this send: static tools, every integration-contributed
 *  tool, the local context tools (knowledgebase) when a context is present,
 *  the ask_expert tool when an expert context is given, the MCP server tools
 *  when an mcp context is given, the generate_image tool when an images
 *  context is given (always-offered design — present even when unconfigured),
 *  and the write_memory_entry tool when a memory context is given. */
export function resolveActiveTools(
  ctx: IntegrationContext,
  knowledge: KnowledgeContext | null = null,
  expert: ExpertToolContext | null = null,
  mcp: McpToolContext | null = null,
  images: ImageToolContext | null = null,
  memory: MemoryToolContext | null = null,
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
            undefined,
            expert.web,
          ),
        ]
      : []),
    ...(mcp ? contributeMcpTools(mcp) : []),
    ...(images ? contributeImageTool(images) : []),
    ...(memory ? contributeMemoryTool(memory) : []),
  ];
}

/** Joined non-null `systemPromptInstruction`s for the Band-3 tools segment, or
 *  `null` when nothing to add. */
export function systemPromptSegment(tools: Tool[]): string | null {
  const lines = tools.map((t) => t.systemPromptInstruction).filter((s): s is string => s !== null);
  return lines.length > 0 ? lines.join('\n\n') : null;
}

export { dispatch, toolDefs } from './tool-defs.js';
