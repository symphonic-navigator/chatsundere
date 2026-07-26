// SPDX-License-Identifier: LGPL-3.0-only
//
// ollama.com NATIVE adapter (`/api/chat`, NDJSON). ollama's OpenAI-compatible
// shim (`/v1/chat/completions`) mis-handles the multi-turn tool replay for
// reasoning-native models — after a tool result they re-call the tool instead of
// answering (live-measured 2026-06-03). The native endpoint answers correctly
// (and is what chatsune uses), so we talk to it directly: native message shape
// (`tool_calls[].function.arguments` as a parsed object, `images` as raw base64),
// the `think` boolean for reasoning, and NDJSON response framing.
import type {
  CanonicalRequest,
  ModelAdapter,
  ParseState,
  WireRequest,
} from '../adapter-contract.js';
import type { ModelProfile, ReasoningControl } from '../catalogue/types.js';
import type { NormalisedUsage, StreamChunk, WireMessage } from '../types.js';

/** Pull the visible text + image base64 out of a wire content body. */
function splitContent(content: WireMessage['content']): { text: string; images: string[] } {
  if (typeof content === 'string') return { text: content, images: [] };
  const text = content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
  const images = content
    .filter((p): p is { type: 'image_url'; image_url: { url: string } } => p.type === 'image_url')
    // ollama wants raw base64, not a data URL — strip the `data:…;base64,` prefix.
    .map((p) => {
      const url = p.image_url.url;
      const comma = url.indexOf(',');
      return url.startsWith('data:') && comma !== -1 ? url.slice(comma + 1) : url;
    });
  return { text, images };
}

/** Translate one canonical WireMessage into ollama's native `/api/chat` shape. */
function toNative(msg: WireMessage): Record<string, unknown> {
  const { text, images } = splitContent(msg.content);
  const out: Record<string, unknown> = { role: msg.role, content: text };
  if (images.length > 0) out.images = images;
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    out.tool_calls = msg.tool_calls.map((tc) => ({
      // Native ollama expects `arguments` as an object, not a JSON string.
      function: { name: tc.function.name, arguments: safeParse(tc.function.arguments) },
    }));
  }
  if (msg.tool_call_id) out.tool_call_id = msg.tool_call_id;
  return out;
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

interface OllamaChunk {
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>;
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Build an ollama-native adapter for one model. `reasoning` decides the `think`
 * default; `vision` is reflected in the profile only (images travel in the
 * messages regardless).
 */
export function ollamaNativeAdapter(
  slug: string,
  opts: { vision: boolean; reasoning: ReasoningControl },
): ModelAdapter {
  const profile: ModelProfile = {
    reasoning: opts.reasoning,
    toolCalls: { supported: true, streaming: true, concurrentWithReasoning: false },
    vision: opts.vision,
    replayReasoning: false,
  };

  // Whether an off may reach the wire at all — the Grok-4.5 guard of 2026-07-15,
  // which this adapter never received. A `fixed-on` control (and a `steps`
  // control with no off step) describes a model that always reasons, and the
  // cockpit deliberately emits NO intent for such a control, so `composeWire`
  // hands us `{enabled:false}` by default. Sending that verbatim is how GLM 5.2
  // silently stopped reasoning on 2026-07-26: ollama had turned `think:false`
  // from a no-op into a real off-switch, and nothing on our side had changed.
  const canDisableReasoning =
    opts.reasoning.mode === 'toggle' ||
    (opts.reasoning.mode === 'steps' && opts.reasoning.offStep !== null);

  /** The `think` value for one intent: a level, a plain on, or a guarded off. */
  function reasoningValue(intent: CanonicalRequest['reasoning']): boolean | string {
    // An off the control does not offer is refused, not forwarded — the model
    // always reasons, so `think:true` is the honest wire value.
    if (!intent.enabled) return !canDisableReasoning;
    return intent.effort ?? true;
  }

  return {
    profile,
    responseFraming: 'ndjson',

    mapSampling(sampling: Record<string, unknown>): Record<string, unknown> {
      // ollama reads sampling ONLY under `options` — top-level keys are accepted
      // and silently ignored (an out-of-range `options.temperature` 400s, the
      // same value top-level does not). Fields per ollama's documented
      // ModelOptions schema. `num_ctx` is omitted deliberately: ollama.com
      // applies no small default (no truncation measured to 25k prompt tokens).
      const options: Record<string, unknown> = {};
      if ('temperature' in sampling) options.temperature = sampling.temperature;
      if ('max_tokens' in sampling) options.num_predict = sampling.max_tokens;
      if ('top_p' in sampling) options.top_p = sampling.top_p;
      if ('seed' in sampling) options.seed = sampling.seed;
      if ('stop' in sampling) options.stop = sampling.stop;
      return Object.keys(options).length > 0 ? { options } : {};
    },

    buildRequest(req: CanonicalRequest): WireRequest {
      const body: Record<string, unknown> = {
        model: slug,
        messages: req.messages.map(toNative),
        stream: true,
        // `think` accepts a boolean OR one of ollama's levels (`low`, `medium`,
        // `high`, `max`); the server validates the value and 400s on anything
        // else. Levels arrived with ollama's 2026-07 build-out — before that it
        // was boolean-only. An off is emitted only where the offering's control
        // actually offers one; see `canDisableReasoning` above.
        // (`think` being ignored entirely is a `/v1` shim-only quirk — there
        // `reasoning_effort: 'none'` is the lever.)
        think: reasoningValue(req.reasoning),
      };
      if (req.tools && req.tools.length > 0) {
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }
      return { model: slug, body, path: '/api/chat' };
    },

    parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
      const chunk = raw as OllamaChunk;
      const events: StreamChunk[] = [];
      const message = chunk.message;

      if (message?.thinking) events.push({ type: 'reasoning', text: message.thinking });
      if (message?.content) events.push({ type: 'token', text: message.content });

      // Tool calls arrive atomically in a single chunk (the whole list, args
      // already a complete object) — no cross-chunk accumulation needed.
      const calls = message?.tool_calls ?? [];
      for (let i = 0; i < calls.length; i++) {
        const tc = calls[i];
        const fn = tc?.function;
        if (!fn?.name) continue;
        events.push({
          type: 'tool-call',
          toolCallId: tc?.id || `call_${fn.name}_${i}`,
          name: fn.name,
          argumentsJson: JSON.stringify(fn.arguments ?? {}),
        });
      }

      if (chunk.done) {
        if (typeof chunk.prompt_eval_count === 'number' || typeof chunk.eval_count === 'number') {
          const prompt = chunk.prompt_eval_count ?? 0;
          const completion = chunk.eval_count ?? 0;
          const usage: NormalisedUsage = {
            promptTokens: prompt,
            completionTokens: completion,
            totalTokens: prompt + completion,
          };
          events.push({ type: 'usage', usage });
        }
        // ollama reports `done_reason: 'stop'` even when it emitted tool calls;
        // the tool loop keys on the tool-call pills, not the finish reason.
        const reason = calls.length > 0 ? 'tool_calls' : normaliseDone(chunk.done_reason);
        events.push({ type: 'finish', reason });
      }

      return { events, state };
    },
  };
}

function normaliseDone(
  reason: string | undefined,
): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown' {
  if (reason === 'stop') return 'stop';
  if (reason === 'length') return 'length';
  return reason ? 'unknown' : 'stop';
}
