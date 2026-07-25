// SPDX-License-Identifier: AGPL-3.0-only
import type { ToolDef, WireMessage, WireToolCall } from '@chatsundere/llm-unified';
import type { ToolResult } from '../tools/types.js';

/** One executed craft-tool step recorded for outer meta / honesty reporting. */
export interface AgentLedgerEntry {
  op: string;
  targetId?: string;
  success: boolean;
  error?: string;
  resultingUpdatedAt?: number;
  at: number;
}

/** Outcome of a full headless agent run (modify / inspect craft subagents). */
export interface AgentLoopResult {
  finalText: string;
  ledger: AgentLedgerEntry[];
  /** Number of stream passes that offered tools (force-answer pass is excluded). */
  roundsUsed: number;
  roundLimitReached: boolean;
  stoppedByAbort: boolean;
}

/** One model pass: assistant text plus any tool calls. */
export interface AgentLoopStreamResult {
  text: string;
  toolCalls: Array<{ id: string; name: string; argumentsJson: string }>;
}

export interface AgentLoopDeps {
  streamOnce: (exchange: WireMessage[], tools: ToolDef[]) => Promise<AgentLoopStreamResult>;
  dispatch: (
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<ToolResult>;
  toolDefs: ToolDef[];
  maxRounds: number;
  signal?: AbortSignal;
  onProgress?: (p: { phase?: string; charCount?: number }) => void;
  /** Appended as a user nudge only on the forced final tools-free pass (optional). */
  finalRoundNudge?: string;
}

function parseArgs(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsJson);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function ledgerFromResult(name: string, result: ToolResult): AgentLedgerEntry {
  const meta = result.meta ?? {};
  const op = typeof meta.op === 'string' ? meta.op : name;
  const targetId = typeof meta.targetId === 'string' ? meta.targetId : undefined;
  const resultingUpdatedAt =
    typeof meta.resultingUpdatedAt === 'number' ? meta.resultingUpdatedAt : undefined;
  return {
    op,
    targetId,
    success: result.ok,
    error: result.error ?? undefined,
    resultingUpdatedAt,
    at: Date.now(),
  };
}

function emptyAbortResult(ledger: AgentLedgerEntry[], roundsUsed: number): AgentLoopResult {
  return {
    finalText: '',
    ledger,
    roundsUsed,
    roundLimitReached: false,
    stoppedByAbort: true,
  };
}

/**
 * Drive a UI-independent model→tool→model loop for craft subagents.
 * Accumulates an execution ledger; does not touch chat ContentBlocks or pills.
 * After `maxRounds` tool-capable streams without a natural stop, one final
 * tools-free stream is forced so the model must answer.
 */
export async function runAgentLoop(deps: AgentLoopDeps): Promise<AgentLoopResult> {
  const exchange: WireMessage[] = [];
  const ledger: AgentLedgerEntry[] = [];
  let roundsUsed = 0;

  for (let round = 0; ; round++) {
    if (deps.signal?.aborted) {
      return emptyAbortResult(ledger, roundsUsed);
    }

    const forceAnswer = round >= deps.maxRounds;

    if (forceAnswer && deps.finalRoundNudge) {
      exchange.push({ role: 'user', content: deps.finalRoundNudge });
    }

    const streamResult = await deps.streamOnce(exchange, forceAnswer ? [] : deps.toolDefs);

    if (!forceAnswer) {
      roundsUsed += 1;
    }

    deps.onProgress?.({
      phase: forceAnswer ? 'answer' : 'tools',
      charCount: streamResult.text.length,
    });

    const toolCalls = streamResult.toolCalls;
    if (toolCalls.length === 0 || forceAnswer) {
      return {
        finalText: streamResult.text,
        ledger,
        roundsUsed,
        roundLimitReached: forceAnswer,
        stoppedByAbort: false,
      };
    }

    const wireCalls: WireToolCall[] = [];
    const toolMessages: WireMessage[] = [];

    for (const call of toolCalls) {
      if (deps.signal?.aborted) {
        return emptyAbortResult(ledger, roundsUsed);
      }

      const args = parseArgs(call.argumentsJson);
      const result = await deps.dispatch(call.name, args, deps.signal);
      ledger.push(ledgerFromResult(call.name, result));

      const content = result.ok ? result.output : (result.error ?? result.output);
      wireCalls.push({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.argumentsJson },
      });
      toolMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content,
      });
    }

    // Abort may have been set during the last dispatch; stop before another stream.
    if (deps.signal?.aborted) {
      return emptyAbortResult(ledger, roundsUsed);
    }

    exchange.push({
      role: 'assistant',
      content: streamResult.text,
      tool_calls: wireCalls,
    });
    exchange.push(...toolMessages);
  }
}
