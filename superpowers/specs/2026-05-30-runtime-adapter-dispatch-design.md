# Runtime Adapter Dispatch (Catalogue→Runtime, Slice 1) — Design

- **Date:** 2026-05-30
- **Status:** Draft
- **Author:** Liz (Claude Code), brief-led with Chris
- **Part of:** Catalogue→Runtime wiring, decomposed into three slices. **This is Slice 1.**
  - Slice 1 (this): runtime adapter dispatch — `streamCompletion` routes through a
    per-model `ModelAdapter`; gains tool-call reassembly, usage emission, a
    tools-capable `buildRequest`. Internal to `packages/llm-unified`.
  - Slice 2 (later spec): the client moves from `KnownModel`/`knownModels` to
    `CanonicalModel`/`Offering` (picker, cockpit, context gauge, reasoning-resolver;
    `ReasoningCapability`→`ReasoningControl`).
  - Slice 3 (later spec): catalogue loading/bundling — YAML entries → bundled
    runtime catalogue; the adapter registry populated from `Offering.adapter`.
- **Depends on:** the existing `ModelAdapter` contract (`src/adapter-contract.ts`)
  and the `/curate` skill that authors adapters.

---

## 1. Context & Motivation

The `/curate` skill produces per-model `ModelAdapter`s (`src/adapter-contract.ts`),
but the runtime does not use them. `streamCompletion`
(`src/stream-completion.ts`) builds the body via a hardcoded per-provider
`switch` in `_reasoning-body.ts` and parses with the **stateless** generic
`parseOpenAiSseStream` (`src/streaming.ts`). Consequences, all confirmed:

- **Fragmented streamed tool-call arguments are dropped.** `openAiPayloadToChunks`
  (`src/streaming.ts`, ~lines 110-120) emits a `tool-call` chunk only when one SSE
  delta carries `id` **and** `function.name` **and** `arguments` together. The
  OpenAI streaming protocol sends `id`+`name` first, then `arguments` in later
  fragment-only deltas — which the guard discards. There is no accumulator state.
- **`usage` is never surfaced.** The `{ type: 'usage' }` `StreamChunk` variant and
  `NormalisedUsage` exist (`src/types.ts`) but nothing emits them, and
  `stream_options: { include_usage: true }` is never set.
- **Tools are never sent.** `streamCompletion`/`buildBody` have no tools path.

The hand-written adapters already solve the tool-call reassembly correctly
(`deepseekBaselineAdapter.parseChunk` threads a `ParseState`). This slice wires
that path into the runtime so adapters become real, while keeping the generic
path as a safe fallback for models that have not yet been given an adapter.

## 2. Scope

**In scope:**
- An adapter registry (`registerAdapter` / `getAdapter`) in `llm-unified`.
- An optional `adapterId?: string` on `KnownModel`.
- `streamCompletion` dispatches through a model's `ModelAdapter` when one is
  resolved, else the existing generic path (incremental opt-in).
- Extracting a generic SSE **framer** (line→payload, `[DONE]`) shared by both
  paths; a stateful adapter parse loop threading `ParseState`.
- `buildRequest` sends `tools` (OpenAI function shape) when `CanonicalRequest.tools`
  is provided; emits `{ type: 'usage' }` chunks.
- Confirming the client safely ignores `usage` chunks (no-op default if needed).

**Out of scope (deferred, named):**
- Client migration to `Offering`/`CanonicalModel` (Slice 2).
- Catalogue loading/bundling and populating the registry from `Offering.adapter`
  (Slice 3).
- **Wiring tools end-to-end from the client/chat.** No client tool definitions
  exist today; `buildRequest` *supports* tools, but only the conversation-suite
  populates `CanonicalRequest.tools` for now.
- **Displaying usage** in the UI — a later feature; this slice only emits the chunks.
- Authoring the chutes adapter — that is the next step (model curation, mode 2),
  validated against this slice.

## 3. Adapter Registry & Resolution

A registry mirroring the provider registry (`src/registry.ts`):

```ts
// src/adapter-registry.ts
import type { ModelAdapter } from './adapter-contract.js';

/** Register a hand-written adapter under a stable id (e.g. 'chutes-openai'). */
export function registerAdapter(id: string, adapter: ModelAdapter): void;
/** Resolve an adapter by id, or undefined if none is registered. */
export function getAdapter(id: string): ModelAdapter | undefined;
/** Test-only reset, paired with re-registration (cf. _resetRegistryForTests). */
export function _resetAdapterRegistryForTests(): void;
```

`KnownModel` gains one optional field (`src/types.ts`):

```ts
export interface KnownModel {
  // …existing fields…
  /** When set, streamCompletion routes through getAdapter(adapterId);
   *  otherwise the generic path is used. Many models may share one id. */
  adapterId?: string;
}
```

Resolution in `streamCompletion`: `const adapter = args.model.adapterId ?
getAdapter(args.model.adapterId) : undefined;`. When `adapter` is `undefined`,
the generic path runs unchanged. This survives Slice 3: `Offering.adapter` is
`{ kind: 'catalogue'; adapterId }`, so the loaded catalogue will register under
the same ids and populate `adapterId` from the Offering.

## 4. `streamCompletion` Refactor

Today (`src/stream-completion.ts`): `buildBody(args)` → `buildRequest(...)` →
`yield* parseOpenAiSseStream(response.body, …)`.

After:

1. **Request building.**
   - Adapter path: assemble a `CanonicalRequest` (`messages`, the
     `ReasoningIntent` already resolved by the client, and `tools?` — empty for
     now from the client, populated by the suite), call
     `adapter.buildRequest(req)` → `{ model, body }`, send via the existing
     transport (`buildRequest` in `src/transport.ts`, which owns URL/auth/routing
     and is untouched).
   - Generic path: unchanged (`buildBody` + `applyReasoningToBody`).
2. **SSE framing — extract a shared generic framer.** A new
   `frameSseStream(stream): AsyncIterable<unknown>` yields each parsed JSON
   payload (handling line framing and `[DONE]`). `parseOpenAiSseStream` is
   refactored to `framer + openAiPayloadToChunks` so the fallback keeps identical
   behaviour.
3. **Parsing.**
   - Adapter path: `let state: ParseState = {};` then for each framed payload
     `const { events, state: next } = adapter.parseChunk(payload, state); state =
     next; yield* events;`.
   - Generic path: `yield* parseOpenAiSseStream(...)` as today.

The transport layer (`src/transport.ts`) and the SSE framing are not
adapter-specific and stay generic; only request-body shaping and per-event
interpretation move into the adapter.

## 5. usage & tools

- **usage:** adapters emit `{ type: 'usage'; usage: NormalisedUsage }` (chutes via
  `stream_options.include_usage: true`, surfaced on the final event). The client
  `stream-engine.ts` has no `usage` handler today; this slice **verifies it
  ignores unknown chunk types without error** and adds a no-op default if not.
  Display is a later feature.
- **tools:** `ModelAdapter.buildRequest` maps `CanonicalRequest.tools` to the
  OpenAI `{ type: 'function', function: { name, description, parameters } }` shape.
  Only the conversation-suite provides tools for now; the client passes none, so
  client behaviour is unchanged.

## 6. `_reasoning-body.ts` Transition

`applyReasoningToBody` (the per-provider `switch`) remains the generic path's
reasoning translator. Per-provider it becomes redundant as that provider's models
gain adapters (the adapter's `buildRequest` owns the translation). No big-bang;
it is retired when the last generic model migrates. `one-shot-completion.ts` has
its own inline nano-gpt pair lookup — left untouched in this slice (it serves the
generic path); flagged for the eventual cleanup.

## 7. Testing (no keys, CI-safe)

All unit tests against code; no live provider calls.

- **Adapter registry:** register/get; `getAdapter(unknown)` → `undefined`;
  reset+re-register.
- **Stateful parse loop** with a **fake `ModelAdapter`**: feed framed payloads
  that split a tool call across events (`id`+`name` first, `arguments` in
  fragments) and assert ONE complete `tool-call` chunk with concatenated
  `argumentsJson` — i.e. the bug the generic path has is fixed on the adapter
  path. Assert a `usage` chunk is emitted, and that `ParseState` is threaded
  (a second turn sees prior state cleared on `finish`).
- **Fallback regression:** with no `adapterId`, `streamCompletion` yields
  byte-identical chunks to today (lock the generic path).
- **Real adapter dispatch:** route a captured payload sequence through the
  existing `deepseekBaselineAdapter` via the registry to prove the path with a
  production adapter.
- **SSE framer:** the refactored `parseOpenAiSseStream` (framer +
  `openAiPayloadToChunks`) passes its existing tests unchanged.

## 8. Acceptance

- An adapter-backed model streams through `streamCompletion` with correct
  fragmented tool-call reassembly and a surfaced `usage` chunk.
- An adapter-less model behaves byte-identically to today (generic path).
- `bun run build` + `bun run typecheck` clean; all unit tests green; no keys in CI.

## 9. Manual Verification (Chris)

1. After this slice, curate chutes (mode 2) authoring a `chutes-openai` adapter
   and pointing the chutes `knownModels` at `adapterId: 'chutes-openai'`; run a
   live chat and confirm a tool-using turn reassembles correctly and `usage`
   appears in the stream (devtools/log), where the generic path would have
   dropped fragmented tool-call arguments.
2. Confirm an existing nano-gpt/novita model (no `adapterId`) still streams
   exactly as before.
