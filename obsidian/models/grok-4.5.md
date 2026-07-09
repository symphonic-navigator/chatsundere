# Model Curation Record — Grok 4.5

> Curation record. See [[../providers/nano-gpt]] for the shared nano-gpt mechanics
> and [[grok-4.3]] for its sibling (same family, same wire shape).

- **Identity:** Grok 4.5 · family `grok`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅ (input image; output text-only)
- **replayReasoning:** false — the reasoning summary streams human-readable on
  `delta.reasoning`. Unlike 4.3, nano-gpt proxies 4.5 through xAI's **Responses
  API**, so an **encrypted reasoning blob** (`reasoning.encrypted`, format
  `xai-responses-v1`) also leaks in the `reasoning_details` array. The adapter
  reads only the `reasoning` summary channel and ignores `reasoning_details`, so
  the blob is inert → display-only, nothing to replay, `replayReasoning: false`.
- **🕊️ Freedom:** free — `freedomOriented: true`, `freedomOrientedDeployment: true`
  (Chris, 2026-07-09: Grok 4.5 is judged even *more* freedom-oriented than 4.3;
  tested and approved). nano-gpt adds no censorship of its own.

Curated on **one deployment** so far: nano-gpt. xAI-direct is not yet wired for
4.5 (the model is available on nano-gpt for the EU but not yet onboarded on the
`xai` provider); OpenRouter likewise not yet curated. Both remain open follow-ups
should the routes be wanted.

## Offering — nano-gpt

- **slug:** `x-ai/grok-4.5` · **adapterId:** `nano-gpt:x-ai/grok-4.5`
- **context:** recommended **200 000** / max **1 000 000**. nano-gpt's `/models`
  reports no window for the model, so the posture mirrors 4.3-nano — 200k
  sweet-spot (xAI roughly doubles the price above 200k on the direct route),
  1M ceiling per xAI's published Grok window.
- **reasoning control:** the OpenAI-style unified `reasoning` **object** —
  `{enabled:false}` is a **genuine off** (0 reasoning tokens, probed 2026-07-09),
  `{enabled:true,effort}` enables. Same trap as 4.3: `reasoning_effort: none`
  does **not** disable it, so the offering reuses the unified reasoning-object
  adapter (`openRouterAdapter`), not the slug-swap one. Modelled as a `toggle`
  (defaultOn), matching xAI's own default-on posture.
- **tool calls:** single-block (`streaming: false`) when fired, concurrent with
  reasoning. See the two route quirks below.
- **vision:** ✅.
- 🔒 **Privacy:** no TEE / no ZDR (routes to the xAI upstream, US jurisdiction).
- **Freedom:** `freedomOrientedDeployment: true` (nano-gpt adds no censorship).
- **confidence:** `verified` — `run-grok-suite.ts` 2026-07-09: core **22/22** +
  vision **4/4**, 0 fail, across both reasoning permutations, with the exact
  production adapter (`openRouterAdapter('x-ai/grok-4.5', …)`).

## Reasoning — empirical findings (probed 2026-07-09)

`reasoning:{enabled:false}` yields a clean answer with no reasoning field and
`reasoning_tokens: 0` — a genuine off, not the "hidden but still happening"
failure mode. With reasoning on, the summary streams token-by-token on
`delta.reasoning`; each delta additionally carries a `reasoning_details` entry of
type `reasoning.summary` (format `xai-responses-v1`) and, at the end of the
trace, a `reasoning.encrypted` blob with an `rs_…` id. These Responses-API
artefacts are a nano-gpt proxying detail; Chatsundere is Chat-Completions-only
(completions-not-responses rule) and the adapter never touches
`reasoning_details`, so they are inert.

## Tool-calling — route quirks (probed 2026-07-09)

Tool calls, when fired, arrive **single-block**: one delta carries `id`, `name`
and the full `arguments` together, with `finish_reason: "tool_calls"`. The
conversation suite fired `generate_image` cleanly in both the reasoning-off and
reasoning-on permutations. Two non-blocking quirks are documented so the
behaviour is recorded rather than silently worked around:

1. **Occasional write-as-text nondeterminism.** The model sometimes emits the
   tool call as markdown (`` ```generate_image ``) as `content` and finishes with
   `stop` instead of firing it — the known DSv4-Flash / Gemma-4-style
   nondeterminism (a weights behaviour, not a protocol break). Observed once
   across several probes; the suite's `tool-call-fired` assertion passed on the
   verified run. If a user hits it, the mitigation is the usual explicit
   tool-mention in prompt composition.
2. **`tool_choice: "required"` errors.** Forcing the tool on this route returns
   `finish_reason: "error"` with a `` ```generate_image `` content leak. We never
   send `tool_choice: "required"` in production (the standard flow uses `auto`),
   so this is recorded but not exercised.

## Usage shape (probed 2026-07-09)

OpenAI-standard envelope, identical to 4.3-nano — `prompt_tokens`,
`completion_tokens` (excluding reasoning), `total_tokens` (including reasoning),
`completion_tokens_details.reasoning_tokens`, `prompt_tokens_details.cached_tokens`.
Delivered on the final `choices`-bearing chunk under
`stream_options: { include_usage: true }`. nano-gpt also attaches its own
`x_nanogpt_pricing` / `x_nanogpt_cache` fields, which the adapter ignores.
Normalises to `NormalisedUsage` with `reasoningTokens` and `cachedTokens`
populated.

## Validation

Live suite (`run-grok-suite.ts`, filter `4.5`): **PASS** — run 2026-07-09 against
`nano-gpt.com/api/v1` (core scenario 22/22, vision scenario 4/4, 0 fail).
Confirmed:

1. Reasoning **off** → `reasoning-absent` green (genuine off, no trace leak).
2. Reasoning **on** → `reasoning-present` green (summary + answer).
3. **Tools** → `generate_image` fires single-block, arguments valid JSON, in both
   permutations.
4. **Vision** → test image described correctly.
5. **Memory/recall** → injected token echoed back through the protocol.
6. **Usage** → normalised, `totalTokens > 0` on every turn.
