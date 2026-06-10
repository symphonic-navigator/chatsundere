// SPDX-License-Identifier: AGPL-3.0-only
import type { ToolDef, WireMessage, WireToolCall } from '@chatsundere/llm-unified';
import type { ContentBlock, PillRow } from '../boot/client-data-db.js';
import type { ToolResult } from '../tools/types.js';
import { flattenAnswerText } from './content-blocks.js';
import type { StreamEngineResult } from './stream-engine.js';

/** Default cap on tool-executing rounds before a tools-less answer is forced. */
export const MAX_TOOL_ROUNDS = 5;

export interface ToolLoopDeps {
  /** Run one engine pass with the given accumulated tool exchange and offered tools. */
  streamOnce: (toolExchange: WireMessage[], tools: ToolDef[]) => Promise<StreamEngineResult>;
  /** Execute a tool by name. */
  dispatch: (
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onProgress?: (p: import('../tools/types.js').ToolProgress) => void,
  ) => Promise<ToolResult>;
  /** Tool definitions offered on tool-executing rounds. */
  toolDefs: ToolDef[];
  /** Max tool-executing rounds (rounds 0..maxRounds-1). */
  maxRounds: number;
  /** Optional callback fired when a pill's status/payload changes, for live UI. */
  onPillUpdate?: (pill: PillRow) => void;
  /** Optional abort signal forwarded to tool execution. */
  signal?: AbortSignal;
}

interface ToolCallPayload {
  name: string;
  argumentsJson: string;
  toolCallId: string;
  result?: string;
  error?: string;
}

function parseArgs(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsJson);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Drive the model→tool→model round-trip. Each round streams one engine pass and
 * accumulates its content/pill blocks. If the model emitted tool-call pills, each
 * is executed (status pending→completed/failed), an `assistant(tool_calls)`
 * message plus one `tool` message per call is appended to the exchange, and the
 * loop re-streams. After `maxRounds` tool rounds, one final pass runs with no
 * tools so the model must answer.
 */
export async function runToolLoop(deps: ToolLoopDeps): Promise<StreamEngineResult> {
  const allBlocks: ContentBlock[] = [];
  const allPills: PillRow[] = [];
  const toolExchange: WireMessage[] = [];
  let finishReason: StreamEngineResult['finishReason'] = 'unknown';

  for (let round = 0; ; round++) {
    const forceAnswer = round >= deps.maxRounds;
    const result = await deps.streamOnce(toolExchange, forceAnswer ? [] : deps.toolDefs);

    allBlocks.push(...result.finalContentBlocks);
    allPills.push(...result.pillRows);
    finishReason = result.finishReason;

    const toolPills = result.pillRows.filter((p) => p.kind === 'tool-call');
    if (toolPills.length === 0 || forceAnswer) break;

    const toolCalls: WireToolCall[] = [];
    const toolMessages: WireMessage[] = [];
    for (const pill of toolPills) {
      const payload = pill.payload as ToolCallPayload;
      console.info(
        `[tool-call] ${payload.name} · args ${payload.argumentsJson.length} chars · ${payload.argumentsJson.slice(0, 100)}`,
      );
      pill.status = 'pending';
      deps.onPillUpdate?.(pill);

      const onProgress = (p: import('../tools/types.js').ToolProgress): void => {
        pill.payload = { ...(pill.payload as Record<string, unknown>), ...p };
        deps.onPillUpdate?.(pill);
      };

      const r = await deps.dispatch(
        payload.name,
        parseArgs(payload.argumentsJson),
        deps.signal,
        onProgress,
      );
      const content = r.ok ? r.output : (r.error ?? r.output);
      pill.status = r.ok ? 'completed' : 'failed';
      pill.payload = {
        ...(pill.payload as Record<string, unknown>),
        result: r.ok ? r.output : undefined,
        error: r.ok ? undefined : (r.error ?? ''),
        ...(r.meta ?? {}),
      };
      deps.onPillUpdate?.(pill);

      toolCalls.push({
        id: payload.toolCallId,
        type: 'function',
        function: { name: payload.name, arguments: payload.argumentsJson },
      });
      toolMessages.push({ role: 'tool', tool_call_id: payload.toolCallId, content });
    }

    // The assistant message that made the calls; content = any text it emitted
    // this round (usually empty for a pure tool-call turn).
    toolExchange.push({
      role: 'assistant',
      content: flattenAnswerText(result.finalContentBlocks),
      tool_calls: toolCalls,
    });
    toolExchange.push(...toolMessages);
  }

  return { finalContentBlocks: allBlocks, pillRows: allPills, finishReason };
}
