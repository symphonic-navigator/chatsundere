# Model Curation Record — Inkling

> Curation record. See [[../providers/nano-gpt]] for the shared provider
> mechanics. Inkling is **Thinking Machines' first public model** (Mira Murati's
> lab) — a community first for Chatsundere. Onboarded **2026-07-16**, curated
> live against nano-gpt.

- **Identity:** Inkling · family `inkling`
- **Architecture:** sparse MoE, **975B total / 41B active**, natively multimodal
  (vision + audio in; we surface vision, text out). Apache-2.0. Routed by
  nano-gpt to **Baseten** (`owned_by: baseten`).
- **T/R/V:** tools ✅ · reasoning ✅ (a genuine toggle) · vision ✅ (image input;
  output text-only)
- **replayReasoning:** false — soft-CoT, and in any case there is no trace to
  replay on this route (see the headline finding).
- **🕊️ Freedom:** **unknown** → the muted `Uncensored?` badge. `freedomOriented:
  null` (not yet assessed), `freedomOrientedDeployment: true` (nano-gpt adds no
  censorship of its own). See the freedom section.
- **🔒 Privacy:** no TEE / no ZDR, **US jurisdiction** (Baseten upstream).

## Headline finding — reasoning is billed but its trace is withheld (nano-gpt)

Inkling reasons internally — `usage.reasoning_tokens` scales cleanly with task
difficulty (a trivial "hi" bills ~24; a hard logic puzzle bills ~1600) — but
**nano-gpt does not surface the reasoning trace text on the OpenAI-compatible
route.** Across streaming and non-streaming, and with every flag tried
(`reasoning:{enabled/effort/exclude}`, top-level `reasoning_effort`,
`include_reasoning`, `thinking`, `think`), the `reasoning` / `reasoning_content`
channel stays **empty** while `reasoning_tokens > 0`.

This is a **provider-side passthrough gap for this new model, not a model limit
and not a client bug**:

- `zai-org/glm-5.1:thinking` surfaces 876 reasoning chars on **the very same
  route with the same key** — so the mechanism (nano-gpt mapping upstream
  thinking onto `delta.reasoning`) works generally; Inkling simply is not wired
  for it yet.
- nano-gpt's **own web UI does show** Inkling's trace ("Reasoned for 5s" with the
  full monologue) — its native API has the trace; the OpenAI bridge drops it.
- Likely cause: nano-gpt's passthrough is keyed to the `:thinking`-slug
  convention (GLM/DeepSeek), and Inkling is a newer body-flag reasoning model
  (`reasoning:{enabled}`) with no `:thinking` sibling.

Chris pinged nano-gpt (Milan) on 2026-07-16; a fix is expected within days.

### How we ship honestly in the meantime — `reasoningTraceHidden`

The offering carries **`reasoningTraceHidden: true`** (a new `ModelProfile`
flag). When reasoning ran but no trace surfaced, the client synthesises a
terminal **`(hidden reasoning, n tokens)`** marker in the reasoning slot instead
of an empty bubble — honest about the internal work and its cost without
performing an inner life it cannot show here. Below a ~100-token floor
(`HIDDEN_REASONING_FLOOR`) no marker shows, so trivial turns stay calm. Full
design: [[../../superpowers/specs/2026-07-16-inkling-ux]] (Laura spec-passed).

**When nano-gpt wires the passthrough: drop `reasoningTraceHidden`** and Inkling
becomes an ordinary visible-reasoning toggle with full CoT reverb — no other
change. `run-inkling-suite.ts` self-signals this: its `reasoning-hidden-billed`
assertion fails the day a trace surfaces, with a note to flip the flag.

## Reasoning control — a genuine toggle

Modelled as **`{ mode: 'toggle', defaultOn: true }`** on the unified `reasoning`
object (reused via `openRouterAdapter`, exactly like Grok/OpenAI on nano-gpt):

- `reasoning:{enabled:false}` is a **genuine off** — `reasoning_tokens` drops to
  **0** and the answer is direct (live-probed 2026-07-16). This is a real exit,
  so the hidden-reasoning marker is never unavoidable.
- Default **on**, matching Inkling's native behaviour and the catalogue house
  style (GLM/DeepSeek/Claude/Grok all default reasoning on).
- **Effort** is accepted but modelled as a plain binary toggle, **not** `steps`:
  single-sample token counts were too noisy to claim modulation (and the trace is
  hidden anyway). Revisit `steps` once the passthrough lands.

Contrast with **Grok 4.5** (a superficially similar "billed-but-hidden" story):
Grok 4.5's *normal fixed-on operation* **does** surface a reasoning summary on
`delta.reasoning` (probed 2026-07-16, 53 chars) — its hiding only occurs on the
unused `{enabled:false}` path. Grok 4.5 is therefore **not** a hidden-trace case
and does **not** carry `reasoningTraceHidden`. Inkling is the sole consumer today.

## Context window — unconfirmed, conservative 128k

nano-gpt's `/models` reports **no** window for Inkling, and the HF model card
specifies none. Set conservatively to **recommended 131 072 / max 131 072** —
truncation is graceful, an over-limit request is not, so we under-claim pending
confirmation. Raise once the true window is known.

## Offering — nano-gpt

- **slug:** `thinkingmachines/inkling` · **adapterId:**
  `nano-gpt:thinkingmachines/inkling` (no `:thinking` sibling exists —
  `...:thinking` returns `model_not_supported`).
- **adapter:** the shared `openRouterAdapter` — it emits
  `stream_options:{include_usage:true}` (required; without it Inkling sends only
  `x_nanogpt_pricing`, no OpenAI `usage`) and the unified `reasoning` object, and
  reassembles tool calls.
- **context:** recommended **131 072** / max **131 072** (see above).
- **tool calls:** **single-block** (`streaming: false`) — one delta carries `id`,
  `name` and full `arguments`; `finish_reason: "tool_calls"`.
- **vision:** ✅ — a real photo's clothing colour named reliably (6/6 "green"
  once the image-gen tool is out of the way; see the quirk below).
- 🔒 **Privacy:** no TEE / no ZDR, US jurisdiction (Baseten).
- **confidence:** `verified` — `run-inkling-suite.ts` 2026-07-16.

## Tool-calling — over-eagerness quirk

Inkling is **tool-eager on image prompts**. Offered a `generate_image` tool *and*
asked to **describe** an image ("what colour is the clothing?"), it fires
`generate_image` instead of answering — **0/5** with the tool present, **6/6**
without (probed 2026-07-16). The vision *pipe* is sound; the tool presence
confounds it. Consequences:

- The conversation-suite runs the **vision scenario with a tools-free binding**
  (the image-gen tool is irrelevant to an image-*input* check), where it passes
  cleanly.
- Product note: when `generate_image` is offered alongside a user's image and a
  describe-style prompt, Inkling may generate rather than answer. This is a
  weights-level eagerness we record rather than mask; the standard mitigation
  (don't offer image-gen when the intent is clearly description) applies if users
  hit it. When *asked to draw*, the tool fires correctly (core suite 22/22).

## Usage shape

OpenAI-standard envelope **only when `stream_options:{include_usage:true}` is
sent** — `prompt_tokens`, `completion_tokens`, `total_tokens`,
`completion_tokens_details.reasoning_tokens` (mirrored top-level as
`reasoning_tokens`), `prompt_tokens_details.cached_tokens`. Delivered on the final
`choices`-bearing chunk. Without `include_usage`, only nano-gpt's own
`x_nanogpt_pricing` (with `inputTokens`/`outputTokens`) is emitted — the adapter
ignores it. Unlike Grok 4.5's nano-gpt route, Inkling's `reasoning_tokens` **is**
trustworthy: it goes to a genuine 0 on `{enabled:false}`.

## Freedom — deferred to an independent evaluation

`freedomOriented: null` deliberately. Inkling is a **US model**, and its own HF
card is candid that guardrails are **present but leaky**: *"occasional tendency to
comply with role-play and indirectly framed prompts concerning harmful topics"*,
recommending operators add **defence-in-depth** (content filtering, Llama-Guard
compatibility) rather than rely on the built-in refusals. The model's in-chat
self-description ("weights-level, system prompt cannot fully override") is **not**
taken as evidence — models routinely confabulate about their own alignment
(GLM 4.6 made the identical claim).

We therefore **do not guess**. An independent safety evaluation (Lex's
safetymaxxed bench) is pending — he will run it once Inkling reaches OpenRouter.
Until then effective freedom resolves to **unknown → `Uncensored?`**, and the
judgement is reviewed when his results land. This is the honest posture the new
badge exists to express.

## Validation

Live suite (`run-inkling-suite.ts`), run 2026-07-16, serially, with the exact
production adapter (`openRouterAdapter('thinkingmachines/inkling', …)`):

| Scenario | Result |
|---|---|
| core (reasoning-off · reasoning-on) | **22/22** |
| vision (tools-free) | **4/4** |

Confirmed:

1. **Reasoning off** → genuine (`reasoning-absent` passes, `reasoning_tokens` 0).
2. **Reasoning on** → billed but hidden (`reasoning-hidden-billed`: channel empty,
   `reasoning_tokens > 0`) — the bespoke assertion that self-signals the flip.
3. **Tools** → `generate_image` fires on a draw request, arguments valid JSON.
4. **Vision** → test image described correctly (tools-free; see the quirk).
5. **Memory/recall** → injected token echoed back through the protocol.
6. **Usage** → normalised, `totalTokens > 0` on every turn.
