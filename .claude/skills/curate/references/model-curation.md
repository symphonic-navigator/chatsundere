# Mode 2 — Model curation (the core playbook)

Trigger: "let's curate GLM-6" / "integrate <model>". You are the adapter author.
First read [`catalogue-model.md`](catalogue-model.md) and
[`conventions.md`](conventions.md).

## The flow

1. **Resolve the probe slug(s)** via the provider's `ProviderScanner`. For
   nano-gpt this is `groupNanoGptSlugs` /
   `listOfferings` in
   `packages/llm-unified/src/providers/curation/provider-scanner.ts`, which tames
   the slug-zoo (`:thinking` / `-thinking` / `TEE/` prefix) into
   `DiscoveredOffering`s. Each base slug plus its reasoning sibling is one
   offering to curate.
2. **Probe live.** `curl` the provider's `/chat/completions` with `stream: true`
   and inspect the real SSE. Walk the **harvested probe checklist** below against
   what you actually see — empirical truth over docs.
3. **Author the adapter `.ts` by hand** — implement the `ModelAdapter` interface
   from `src/adapter-contract.ts`: `buildRequest(req)` (wire-body shaping),
   `parseChunk(raw, state)` (raw SSE payload → `StreamChunk[]`, including
   normalised `usage`), and a declarative `profile: ModelProfile`, all informed
   by the probe. The canonical, working reference implementation is
   `src/adapters/nano-gpt-deepseek.baseline.ts` — read it first. Skeleton below.
4. **Run the conversation-suite live and iterate until green** — across **every**
   reasoning permutation the offering supports (on / off, and each effort level
   where steerable). This is **mandatory**, not optional. See
   [`conversation-suite.md`](conversation-suite.md) for how to wire and run it.
5. **Write the catalogue YAML entry + the Model Curation Record**
   (`obsidian/models/<id>.md`).
6. **Validate** the assembled entry against `parseCatalogueEntry` (Valibot,
   `src/catalogue/schema.ts`). Nothing lands that the gate rejects.

## Harvested probe checklist (hard-won empirical knowledge)

Walk every item against the live SSE — this is the empirical knowledge salvaged
from the retired probe-suite; do not lose it.

- **Reasoning slug-vs-flag.** Is reasoning toggled by a **body flag**
  (`{reasoning:{enabled}}` / `{think: bool}`) or by a **model-slug swap**
  (`:thinking` / `-thinking`)? This decides what `buildRequest` emits and whether
  `ModelProfile.reasoning` is a `toggle`/`steps` union or driven by a slug.
- **Off-is-off vs hidden.** When you ask reasoning *off*, is it truly off, or is
  the thinking merely hidden from the channel while still happening? If reasoning
  can **never** be disabled, the profile is `{ mode: 'fixed-on' }` (the
  "off only hides" case), not `toggle`.
- **Tool calls streamed incrementally vs single block.** Does the provider stream
  the tool call as one block, or in fragments across several SSE events?
  **Fragmented streamed tool calls must be reassembled.** This is exactly the
  case the runtime parser in `src/streaming.ts` still gets wrong: its
  `openAiPayloadToChunks` only emits a `tool-call` chunk when a single delta
  carries `id`, `function.name`, **and** `arguments` together, so fragmented
  `arguments` are dropped. **Your adapter's `parseChunk` must buffer and
  concatenate the `argumentsJson` fragments and emit a single `tool-call` chunk**
  once the call is complete.
- **Effort / `max`.** Does the provider accept granular effort buckets
  (low / medium / high) and `max_tokens`? Granular buckets map to a
  `{ mode: 'steps' }` `ReasoningControl`; a single on/off to `{ mode: 'toggle' }`.
- **Reasoning + tools concurrency.** Can the model reason **and** call a tool in
  the same turn? Sets `profile.toolCalls.concurrentWithReasoning`.
- **Tool-invocation reliability.** Some models call a tool only when it is named
  explicitly in the prompt. Observed in chatsune: Gemma 4 and DeepSeek V4 Flash
  with `generate_image` — DSv4 Flash *produced the prompt text* but did not fire
  the tool. If you observe this, the conversation-suite will go red on
  `tool-call-fired:generate_image`. Record the mitigation (explicit
  tool-mention in prompt composition) in the Model Curation Record so the
  behaviour is documented, not silently worked around.

## `usage` normalisation

The provider's per-response `usage` object varies in shape. Map it into the
unified `NormalisedUsage` (`src/types.ts`) **inside `parseChunk`** and emit it as
a `{ type: 'usage'; usage }` `StreamChunk`. `NormalisedUsage` is
`{ promptTokens, completionTokens, totalTokens, reasoningTokens?, cachedTokens? }`.
Document where/whether the provider surfaces `usage` (some only send it on the
final event) in the Provider Curation Record.

## Worked adapter skeleton

The adapter lives at `src/adapters/<id>.<provider>.ts` — it must sit under
`src/` to be compiled into the package, and the catalogue `Offering`'s
`AdapterRef` points to it. It implements the `ModelAdapter` contract from
`src/adapter-contract.ts`: `buildRequest(req: CanonicalRequest): WireRequest`
and `parseChunk(raw, state: ParseState): { events; state }`, plus a `profile`.
`ParseState` is a plain JSON-serialisable object (it crosses the Worker
boundary) — **not** a `Map`. The canonical, working reference is
`src/adapters/nano-gpt-deepseek.baseline.ts`; mirror its structure.

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type {
  CanonicalRequest,
  ModelAdapter,
  ModelProfile,
  ParseState,
  WireRequest,
} from '../adapter-contract.js';
import type { NormalisedUsage, StreamChunk } from '../types.js';

// Declarative measured behaviour — feeds the catalogue Offering.profile.
const PROFILE: ModelProfile = {
  reasoning: { mode: 'toggle', defaultOn: false }, // ← from the probe
  toolCalls: { supported: true, streaming: true, concurrentWithReasoning: false },
  vision: false,
  replayReasoning: false, // soft-CoT (GLM) — never replays its own thinking
};

/** One fragmented tool call, accumulated across SSE events. */
interface PendingToolCall {
  id: string;
  name: string;
  args: string;
}

// Buffer fragmented tool calls in the plain ParseState (NOT a Map) so the
// state survives the Worker/postMessage boundary.
function getPending(state: ParseState): Record<string, PendingToolCall> {
  if (!state.toolCalls) state.toolCalls = {};
  return state.toolCalls as Record<string, PendingToolCall>;
}

function normaliseUsage(raw: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
  prompt_tokens_details?: { cached_tokens?: number };
}): NormalisedUsage {
  const usage: NormalisedUsage = {
    promptTokens: raw.prompt_tokens ?? 0,
    completionTokens: raw.completion_tokens ?? 0,
    totalTokens: raw.total_tokens ?? 0,
  };
  const reasoningTokens = raw.completion_tokens_details?.reasoning_tokens;
  if (reasoningTokens !== undefined) usage.reasoningTokens = reasoningTokens;
  const cachedTokens = raw.prompt_tokens_details?.cached_tokens;
  if (cachedTokens !== undefined) usage.cachedTokens = cachedTokens;
  return usage;
}

interface Delta {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: Parameters<typeof normaliseUsage>[0];
}

export const exampleAdapter: ModelAdapter = {
  profile: PROFILE,

  // Shape the wire body. Translate the reasoning intent to THIS provider's form
  // (here a body flag; a slug-swap provider rewrites the model id instead).
  buildRequest(req: CanonicalRequest): WireRequest {
    const model = 'provider/model-slug';
    const body: Record<string, unknown> = { model, messages: req.messages, stream: true };
    body.reasoning = req.reasoning.enabled
      ? { enabled: true, ...(req.reasoning.effort ? { effort: req.reasoning.effort } : {}) }
      : { enabled: false };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    return { model, body };
  },

  // Turn one raw SSE payload into chunks, threading `state` to reassemble
  // fragmented tool calls (the case src/streaming.ts gets wrong).
  parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
    const events: StreamChunk[] = [];
    const payload = raw as Delta;
    const choice = payload.choices?.[0];

    if (payload.usage) events.push({ type: 'usage', usage: normaliseUsage(payload.usage) });
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
      if (typeof tc.function?.arguments === 'string') acc.args += tc.function.arguments; // concatenate fragments
      pending[key] = acc;
    }

    if (choice.finish_reason) {
      // Flush every accumulated tool call as one complete chunk.
      for (const acc of Object.values(pending)) {
        if (acc.id && acc.name) {
          events.push({ type: 'tool-call', toolCallId: acc.id, name: acc.name, argumentsJson: acc.args });
        }
      }
      state.toolCalls = {};
      events.push({ type: 'finish', reason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop' });
    }
    return { events, state };
  },
};
```

Tune the field names (`reasoning` vs `reasoning_content`, the `usage` sub-objects)
to what the live probe actually shows for this provider — never to what the docs
claim.

Once the adapter is authored, proceed to step 4 and run the suite per
[`conversation-suite.md`](conversation-suite.md).
