# Custom Models & Declarative Reasoning — Adapter Analysis

**Date:** 2026-08-04
**Author:** Liz (Claude Code)
**Status:** Idea-gathering draft — circulated to 1–2 readers to collect feedback before any spec.

## Question this analysis answers

We want to support **custom models / custom endpoints** (a user pointing at their
own OpenAI-compatible or Ollama-native server) and ideally let a user curate
reasoning steering **from a configuration file**, without us hand-writing a new
adapter for every wire format.

The open hypothesis: there are not infinitely many wire formats for reasoning
control — there are a small number of recurring patterns, and we can derive the
behaviour from a declarative spec.

**The hypothesis holds.** This document shows the patterns and proposes a
direction. Feedback is explicitly invited — see the open questions at the end.

---

## 1. The current architecture, in one screen

Three cleanly separated layers live in `packages/llm-unified`:

| Layer | Files | Role |
|---|---|---|
| **`providers/`** | `novita.ts`, `openrouter.ts`, `xai.ts`, `ollama-cloud.ts`, … | A `ProviderDefinition`: `id`, `baseUrl`, `configFields`, `corsHint`, `offerings[]`, `sortPriority`. **This is already a configuration file — it just happens to be written in TypeScript.** |
| **`catalogue/`** | `types.ts` | The type model: `Offering`, `ModelProfile`, `ReasoningControl`, `AdapterRef`. |
| **`adapters/`** | 11 files | The `ModelAdapter` contract: `buildRequest() → WireRequest`, `parseChunk()`, optional `mapSampling()`. Hand-written per provider family. |

Crucially, **the UI-facing control model is already data, not code:**

```ts
type ReasoningControl =
  | { mode: 'none' }                                                  // always-off
  | { mode: 'fixed-on' }                                              // always-on
  | { mode: 'toggle'; defaultOn: boolean }                            // on/off switch
  | { mode: 'steps'; steps: string[]; offStep: string | null; defaultStep: string }; // ladder
```

The cockpit renders chips directly from this. The hand-written part is *only*
the translation from this control into the wire body. That translation is the
sole thing a declarative spec needs to capture.

---

## 2. The taxonomy — there are exactly five request mechanisms

After reading every adapter, reasoning steering on the wire uses one of five
mechanisms (plus a sixth "nothing" for non-reasoning models):

| # | Mechanism | Wire form | Used by |
|---|---|---|---|
| 1 | **Unified object** | `{ reasoning: { enabled, effort? } }` | OpenRouter (all models), nano-gpt flag-mode, Claude Fable-effort |
| 2 | **`reasoning_effort` string** | top-level `'low'\|'medium'\|'high'\|'none'` | xAI Grok 4.3/4.5, novita (newer slugs), OpenAI GPT-5 family |
| 3 | **`enable_thinking` boolean** | top-level boolean | novita (older: GLM, DeepSeek, Kimi K2.6, Gemma, MiMo) |
| 4 | **`think` bool \| level** | `false \| true \| 'low'\|'medium'\|'high'\|'max'` | ollama native (`/api/chat`) |
| 5 | **Slug swap** | no body field — the model slug *is* the switch (`base` ↔ `:thinking`) | nano-gpt slug-mode, xAI Grok 4.20, Claude 4 family |
| 6 | **None** | no reasoning param | non-reasoning models |

On the **response** side, where the reasoning *trace* streams, there are only
three channels:

- `delta.reasoning` — OpenRouter's unified field
- `delta.reasoning_content` — xAI, novita, native OpenAI-compatible
- `message.thinking` — ollama native NDJSON

And two response framings: `sse` (everyone) and `ndjson` (ollama native).

**The whole combinatorial space is five request mechanisms × three trace
channels × two framings** — roughly eight combinations that actually occur in
the wild. That is a table, not an adapter file per provider.

---

## 3. Three findings that matter for the design

### 3.1 The off-guard is already a derived property, not adapter logic

The same line appears verbatim in `openrouter-openai.ts`, `xai-openai.ts`, and
`anthropic-claude.ts`:

```ts
const canDisableReasoning =
  control.mode === 'toggle' || (control.mode === 'steps' && control.offStep !== null);
```

This is the entire Grok-4.5 / GLM-5.2 / Opus-5 lesson condensed into one formula:
some models reject an off intent with HTTP 400, others *pretend* to honour it
while still billing reasoning tokens. An adapter must never emit an off for a
`fixed-on` model or a `steps` control with no off step.

It is a **pure function of `ReasoningControl`**. In a declarative spec it should
not be a field you can set — it is *computed*. Making it non-overridable is what
bakes the safest property of the system into the spec rather than leaving it to
per-adapter discipline.

### 3.2 The tool-call buffer and usage normalisation are 6× copied boilerplate

`getPending`, the `index`-keyed reassembly of fragmented tool calls,
`normaliseFinish`, and the
`completion_tokens_details.reasoning_tokens` extraction are byte-identical
across `openrouter`, `xai`, `novita-thinking`, `novita-reasoning-effort`,
`chutes`, and `mistral`.

This is the strongest argument for a shared declarative base: **the reasoning
mechanisms are not the expensive part — the surrounding plumbing is, and it is
always the same.**

### 3.3 There are exactly two genuinely algorithmic pieces

Two things are real logic, not data:

- **Anthropic `cache_control`** (`_anthropic-cache.ts`): a token-anchored grid
  plus a rolling tail breakpoint. This is actual algorithm.
- **Live probing**: "send `reasoning_effort: 'none'`, check whether
  `reasoning_tokens === 0`" — verification, not translation.

Both are **decorations / orthogonal**, not base behaviour. `claudeAdapter`
already proves the pattern: it wraps `nanoGptSlugSwapAdapter` and only injects
`applyCacheControl`. The shape is
`decorateWithCacheControl(declarativeAdapter(spec), cacheOpts)` — declarative
base, algorithmic wrapper.

---

## 4. What "custom models / endpoints" actually means

Two distinct things, which must not be conflated:

**A. A user points at their own endpoint.** Self-hosted Ollama, vLLM, a
LiteLLM proxy, llama.cpp, a corporate OpenAI-compatible gateway. This is the
product feature. The user supplies: a provider row (baseUrl + key), a model
slug, a reasoning mechanism (dropdown or auto-probe). From that we generate an
`Offering` at runtime with
`adapter: { kind: 'catalogue', adapterId: <generated> }` and register it via
`registerAdapter`. **The runtime path already exists** — `registerAdapter` has
just never been called with a non-builtin id.

**B. We curate a new provider without writing a new adapter file.** Developer
convenience. A declarative spec replaces the hand-written adapter.

Both benefit from a declarative factory, but A is the larger product feature
and B is the enabler. **Without B, A means either a new adapter file per user
endpoint (impossible) or a parallel declarative path alongside the hand-written
ones** — exactly the "two wire paths" trap that bit us on 2026-07-17, where the
curation suite reimplemented the wire it verified and could not fail the way
production failed. With B first, A becomes "render a spec from the user's form,
feed it to the same factory."

---

## 5. Proposed shape of a declarative spec

Sketch only — the exact fields are what the brainstorm should pin down:

```ts
interface DeclarativeAdapterSpec {
  framing: 'sse' | 'ndjson';
  path?: string;                          // default '/chat/completions'
  reasoning: {
    mechanism:
      | { kind: 'unified-object' }        // {reasoning:{enabled,effort?}}
      | { kind: 'reasoning-effort' }      // top-level string, 'none' = off
      | { kind: 'enable-thinking' }      // top-level boolean
      | { kind: 'think' }                // ollama think: false|true|level
      | { kind: 'slug-swap'; thinkingSlug: string }
      | { kind: 'none' };
    control: ReasoningControl;            // the UI ladder — single source of truth
    defaultEffort?: string;              // when intent carries no effort
  };
  trace: 'reasoning' | 'reasoning-content' | 'thinking' | 'reasoning-or-content';
  sampling?: { nestUnder?: string };     // ollama → 'options'
  headers?: Record<string, string>;       // wafer ZDR, xAI conv-id, etc.
  // off-guard is NOT here — it is derived from control.mode/offStep
}
```

A `declarativeAdapter(spec): ModelAdapter` factory covers the 90% case. The
special bits become **named options or composable decorations**, not separate
files:

- `decorateWithCacheControl(adapter, cacheOpts)` — Anthropic breakpoints
- `includeReasoning: true` — the OpenAI GPT-5 "trace gated behind a flag" quirk,
  a spec-level boolean
- ZDR header / conv-id header — spec-level `headers`

---

## 6. Honest risks — things a reviewer should push on

1. **Probing is empirical, not declarative.** You can declare
   `mechanism: 'reasoning-effort'`, but only a live probe confirms `none`
   actually disables reasoning (vs. hiding the trace while still billing tokens
   — the Opus-5 failure). A spec describes *intent*; the suite verifies
   *behaviour*. For user-added endpoints we likely default to a conservative
   `toggle` and offer an optional "probe & self-classify" action.

2. **The suite must consume the same factory.** A verification harness that
   rebuilds its subject cannot fail the way its subject fails (learned
   2026-07-17). Both production *and* the curation suite must use
   `declarativeAdapter(spec)`, or we reintroduce that bug class.

3. **User-supplied specs are untrusted input.** Per our security rules this is
   a system boundary: Valibot-validated at the entrance, no `any`. A
   user-controlled slug or header is an injection vector if not bounded.

4. **The off-guard is money- and trust-critical.** A spec bug that emits
   `{enabled:false}` for a `fixed-on` model is exactly the Opus-5 defect
   (trace hidden, tokens billed). The derived `canDisableReasoning` must be
   non-overridable in the spec.

5. **Non-OpenAI message shapes.** ollama native wants `arguments` as a parsed
   object (not a JSON string) and images as raw base64 (not data URLs). A
   declarative spec needs to declare the message dialect, or this becomes the
   one place the factory falls back to hand-written code.

---

## 7. Recommendation — two workstreams, sequenced

**WS-A — Developer side: collapse the adapter boilerplate.**
`declarativeAdapter(spec)` + a small set of named decorations. Re-express the
existing 11 adapters as specs. A *reducing* refactor — it removes code, makes
the wire-format patterns explicit and enumerable, and is itself the proof that
the patterns are finite. Low risk: behaviour-preserving, every wire form is
pinned by the curation suite.

**WS-B — Product side: user-configured custom endpoints.**
A user can add a provider row pointing at an arbitrary OpenAI-compatible or
ollama-native baseUrl, pick a reasoning mechanism (or auto-probe), and get a
generated offering. Uses the WS-A factory. Needs: provider-row UI, a Valibot
schema for the spec, conservative defaults, an optional probe.

**Sequence: A first.** It is the enabler and the safety net. B without A is
the parallel-wire-path trap.

---

## 8. Open questions for readers

These are where outside perspective is most valuable:

1. **Scope of the spec.** Is the `mechanism` discriminated union above the
   right cut, or should effort-handling (the `max`-only-on-ollama quirk, the
   "effort mandatory when on" Fable quirk) be its own dimension? Are there
   mechanisms we have not yet seen that would break the five-bucket model?

2. **Auto-probe vs. manual declare for user endpoints.** How far should we go
   in probing an unknown endpoint at add-time? A trivial prompt with reasoning
   off + a `reasoning_tokens === 0` check would classify most OpenAI-compat
   endpoints. Is that worth the latency and cost, or do we ship a conservative
   `toggle` default and let the user override?

3. **Where is the boundary between "spec covers it" and "needs a decoration"?**
   The cache-control decoration is clear. The OpenAI `include_reasoning` flag
   is borderline — spec boolean or named decoration? What principle decides?

4. **Custom non-OpenAI dialects.** Should the declarative spec try to cover
   ollama-native's message shape, or do we keep one hand-written "native ollama"
   adapter and let the declarative path be OpenAI-compatible only? The latter
   is simpler; the former is more complete.

5. **Should WS-A be behaviour-preserving on the nose, or do we allow small
   cleanups** (e.g. finally sharing the tool-call buffer across all adapters)
   as part of the refactor? The suite pins every wire form either way.

6. **Is there a third party this affects?** The AGPLv3 self-hosting audience:
   a declarative spec is also the document a self-hoster reads to wire their
   own backend. Does making it declarative change the operator story in a way
   that matters?

---

## Pointers

- Adapter contract: `packages/llm-unified/src/adapter-contract.ts`
- Reasoning control + model profile: `packages/llm-unified/src/catalogue/types.ts`
- The off-guard formula: `packages/llm-unified/src/adapters/openrouter-openai.ts:158`
- Wire composition: `packages/llm-unified/src/stream-completion.ts` (`composeWire`)
- The "two wire paths" lesson: `obsidian/insights/` 2026-07-17 (ollama background-jobs fix)
- Related ADRs: 0031 (roadmap), 0032/0037 (premium routing), 0036 (desktop)