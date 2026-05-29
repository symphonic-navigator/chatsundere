// SPDX-License-Identifier: LGPL-3.0-only
import type {
  CanonicalRequest,
  ModelAdapter,
  ModelProfile,
  ParseState,
  WireRequest,
} from '../adapter-contract.js';
import type { StreamChunk } from '../types.js';

const PROFILE: ModelProfile = {
  reasoning: {
    kind: 'optional',
    effort: { buckets: ['low', 'medium', 'high'], defaultBucket: 'medium' },
    defaultOn: true,
    replayReasoning: false,
  },
  toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
  vision: false,
  contextWindow: 200_000,
  confidence: 'verified',
};

/** Accumulator for one fragmented tool call, keyed by its stream index. */
interface PendingToolCall {
  id: string;
  name: string;
  args: string;
}

function getPending(state: ParseState): Record<string, PendingToolCall> {
  if (!state.toolCalls) state.toolCalls = {};
  return state.toolCalls as Record<string, PendingToolCall>;
}

interface Delta {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown';

function normaliseFinish(reason: string): FinishReason {
  switch (reason) {
    case 'stop':
    case 'length':
    case 'tool_calls':
    case 'content_filter':
      return reason;
    default:
      return 'unknown';
  }
}

export const deepseekBaselineAdapter: ModelAdapter = {
  profile: PROFILE,

  buildRequest(req: CanonicalRequest): WireRequest {
    const thinking = req.reasoning.enabled;
    const model = thinking ? 'deepseek/deepseek-v4-pro:thinking' : 'deepseek/deepseek-v4-pro';
    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
      stream: true,
    };
    if (thinking && req.reasoning.effort) body.reasoning_effort = req.reasoning.effort;
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    return { model, body };
  },

  parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
    const choice = (raw as Delta).choices?.[0];
    const events: StreamChunk[] = [];
    if (!choice) return { events, state };

    const reasoning = (choice.delta?.reasoning ?? '') + (choice.delta?.reasoning_content ?? '');
    if (reasoning) events.push({ type: 'reasoning', text: reasoning });
    if (choice.delta?.content) events.push({ type: 'token', text: choice.delta.content });

    const pending = getPending(state);
    for (const tc of choice.delta?.tool_calls ?? []) {
      const key = String(tc.index ?? 0);
      const acc = pending[key] ?? { id: '', name: '', args: '' };
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name = tc.function.name;
      if (typeof tc.function?.arguments === 'string') acc.args += tc.function.arguments;
      pending[key] = acc;
    }

    if (choice.finish_reason) {
      // On finish, flush every accumulated tool call as a complete chunk.
      for (const acc of Object.values(pending)) {
        if (acc.id && acc.name) {
          events.push({
            type: 'tool-call',
            toolCallId: acc.id,
            name: acc.name,
            argumentsJson: acc.args,
          });
        }
      }
      state.toolCalls = {};
      events.push({ type: 'finish', reason: normaliseFinish(choice.finish_reason) });
    }
    return { events, state };
  },
};
