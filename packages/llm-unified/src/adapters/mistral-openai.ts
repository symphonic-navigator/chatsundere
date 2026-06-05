// SPDX-License-Identifier: LGPL-3.0-only
import type {
  CanonicalRequest,
  ModelAdapter,
  ModelProfile,
  ParseState,
  WireRequest,
} from '../adapter-contract.js';
import type { ReasoningControl } from '../catalogue/types.js';
import type { NormalisedUsage, StreamChunk } from '../types.js';

/** One fragmented tool call, accumulated across SSE events. */
interface PendingToolCall {
  id: string;
  name: string;
  args: string;
}

function getPending(state: ParseState): Record<string, PendingToolCall> {
  if (!state.toolCalls) state.toolCalls = {};
  return state.toolCalls as Record<string, PendingToolCall>;
}

interface MistralUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  // Mistral does NOT report a reasoning-token breakdown (probed live 2026-05-31);
  // these are read defensively only in case a future revision adds them.
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

/**
 * One typed item inside Mistral's polymorphic `delta.content` array. When
 * reasoning is active Mistral abandons OpenAI's plain-string content and sends a
 * list of `{type:'thinking'|'text', ...}` items; a `thinking` item nests its own
 * `{type:'text', text}` array (probed live 2026-05-31).
 */
interface MistralContentItem {
  type?: string;
  text?: string | null;
  thinking?: Array<{ type?: string; text?: string | null }> | null;
}

interface MistralDelta {
  choices?: Array<{
    delta?: {
      // Polymorphic: a plain string when reasoning is off / unsupported, or a
      // typed-item array when reasoning is active. See foldDeltaContent.
      content?: string | MistralContentItem[] | null;
      // Kept as a fallback only — Mistral packs thinking into `content`, NOT
      // here, but a future schema convergence to OpenAI's shape would land here.
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: MistralUsage | null;
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

function normaliseUsage(u: MistralUsage): NormalisedUsage {
  const usage: NormalisedUsage = {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
  const reasoning = u.completion_tokens_details?.reasoning_tokens;
  if (reasoning !== undefined && reasoning !== null) usage.reasoningTokens = reasoning;
  const cached = u.prompt_tokens_details?.cached_tokens;
  if (cached !== undefined) usage.cachedTokens = cached;
  return usage;
}

/**
 * Fold Mistral's polymorphic `delta.content` into separate visible-text and
 * thinking-text strings. A plain string is treated as visible text (the
 * reasoning-off and large-3 path); the typed-item array form
 * `[{type:'thinking', thinking:[{type:'text', text}]}, {type:'text', text}]`
 * is split so `parseChunk` can emit `reasoning` and `token` chunks cleanly. A
 * single chunk legitimately carries both (the thinking→text transition chunk
 * has an empty `thinking:[]` item alongside the first `text` item — probed live
 * 2026-05-31). Mirrors chatsune's `_translate_delta_content`.
 */
function foldDeltaContent(content: string | MistralContentItem[] | null | undefined): {
  visible: string;
  thinking: string;
} {
  if (typeof content === 'string') return { visible: content, thinking: '' };
  if (!Array.isArray(content)) return { visible: '', thinking: '' };
  const visibleParts: string[] = [];
  const thinkingParts: string[] = [];
  for (const item of content) {
    if (item === null || typeof item !== 'object') continue;
    if (item.type === 'text') {
      if (typeof item.text === 'string') visibleParts.push(item.text);
    } else if (item.type === 'thinking') {
      for (const inner of item.thinking ?? []) {
        if (inner?.type === 'text' && typeof inner.text === 'string') {
          thinkingParts.push(inner.text);
        }
      }
    }
    // Other item types are ignored intentionally: tool calls arrive on
    // delta.tool_calls, never inline in content.
  }
  return { visible: visibleParts.join(''), thinking: thinkingParts.join('') };
}

export interface MistralAdapterOptions {
  vision: boolean;
  /**
   * The offering's reasoning control — the source of truth for the profile.
   * A `none`-mode control means the model never receives a `reasoning_effort`
   * param (Mistral Large 3); a `toggle` means a binary high/none flag (Small 4,
   * Medium 3.5).
   */
  reasoning: ReasoningControl;
}

/**
 * Build a Mistral Cloud adapter bound to one upstream slug. Mistral is
 * OpenAI-compatible on the wire (`/chat/completions`, Bearer auth) with two
 * hard-won quirks (probed live 2026-05-31):
 *
 *   - Reasoning is a BINARY toggle via `reasoning_effort`: `'high'` on, `'none'`
 *     off, accepted only by the reasoning-capable models (Small 4, Medium 3.5).
 *     `'none'` is a GENUINE off — content reverts to a plain string with no
 *     thinking items. Mistral Large 3 takes no reasoning param at all.
 *   - When reasoning is active, `delta.content` is a polymorphic typed-item
 *     ARRAY carrying thinking blocks, not OpenAI's `reasoning_content`. The
 *     `foldDeltaContent` helper splits visible vs thinking text;
 *     `reasoning_content` is read only as a fallback.
 *
 * Tool calls arrive on `delta.tool_calls` (a single block in practice, but the
 * fragment buffer is kept for safety) and `usage` arrives on the SAME terminal
 * chunk that carries `finish_reason` (not a separate `choices: []` event), so we
 * emit the usage chunk before processing the terminal choice.
 */
export function mistralAdapter(slug: string, opts: MistralAdapterOptions): ModelAdapter {
  const reasons = opts.reasoning.mode !== 'none';
  const profile: ModelProfile = {
    reasoning: opts.reasoning,
    toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
    vision: opts.vision,
    replayReasoning: false, // Mistral reasoning is soft-CoT — not replayed into history
  };

  return {
    profile,

    buildRequest(req: CanonicalRequest): WireRequest {
      const body: Record<string, unknown> = {
        model: slug,
        messages: req.messages,
        stream: true,
        stream_options: { include_usage: true },
      };
      // Binary reasoning toggle for the reasoning-capable models. Mistral accepts
      // only 'high' and 'none' here — effort buckets are NOT honoured, so the
      // engine's effort intent is collapsed to on→'high'.
      if (reasons) {
        body.reasoning_effort = req.reasoning.enabled ? 'high' : 'none';
      }
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }
      return { model: slug, body };
    },

    parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
      const events: StreamChunk[] = [];
      const p = raw as MistralDelta;

      // Mistral attaches usage to the SAME chunk that carries the terminal
      // choice (probed live), so emit it first, then fall through to the choice.
      if (p.usage) events.push({ type: 'usage', usage: normaliseUsage(p.usage) });

      const choice = p.choices?.[0];
      if (!choice) return { events, state };

      const { visible, thinking } = foldDeltaContent(choice.delta?.content);
      // Prefer the in-content thinking; fall back to OpenAI-style
      // reasoning_content only when the content array carried none, to avoid a
      // double `reasoning` chunk during a hypothetical future schema transition.
      const reasoningText = thinking || (choice.delta?.reasoning_content ?? '');
      if (reasoningText) events.push({ type: 'reasoning', text: reasoningText });
      if (visible) events.push({ type: 'token', text: visible });

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
}
