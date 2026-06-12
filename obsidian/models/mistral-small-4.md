# Model Curation Record — Mistral Small 4

> Curation record. See [[../providers/mistral]] for the shared Mistral mechanics
> (the thinking-in-content quirk, the usage-on-terminal-chunk quirk, CORS).

- **Identity:** Mistral Small 4 · family `mistral`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅ (image input; output text-only)
- **replayReasoning:** false (soft-CoT — Mistral does not replay thinking into history)
- **🔒 Privacy (first-party):** no TEE / no ZDR (EU jurisdiction). nano-gpt: no TEE / no ZDR.
- **🕊️ Freedom:** **pending Chris** — `freedomOriented` left for Chris to set on
  the canonical; both deployments' `freedomOrientedDeployment` are `null`.

Curated on the first-party `mistral` API (hand-written `mistral-openai` adapter)
and on `nano-gpt` (the existing `nano-gpt-slug-swap` adapter). Both
`confidence: 'verified'`.

## Offering — mistral (first-party)

- **slug:** `mistral-small-latest` · **adapterId:** `mistral:mistral-small-latest`
- **context:** recommended **131 072** / max **262 144** (see [[../providers/mistral]] §Context windows — recommended is a conservative default, not measured)
- **reasoning control:** **`toggle`** (`defaultOn: false`). Binary `reasoning_effort`:
  `"high"` on, `"none"` off — `"none"` is a **genuine off** (content reverts to a
  plain string, no thinking items; `reasoning-absent` PASS). Thinking streams in
  the **polymorphic `delta.content` array**, NOT `reasoning_content` — the
  adapter's `foldDeltaContent` splits it. See [[../providers/mistral]].
- **tool calls:** single-block, streaming, concurrent with reasoning. `generate_image` fired reliably.
- **usage:** on the terminal `finish_reason` chunk; no reasoning-token breakdown.
- **Vision:** verified — names the clothing colour "green" on the Sylvir test image.

## Offering — nano-gpt

- **slug:** `mistralai/mistral-small-4-119b-2603` (`:thinking` sibling exists) · **adapterId:** `nano-gpt:mistralai/mistral-small-4-119b-2603`
- **context:** recommended/max **262 144**
- **reasoning control:** **`toggle`** (`defaultOn: false`) via **model-slug swap**
  (`:thinking`). Bare slug is cleanly reasoning-off; `:thinking` streams thinking
  on the standard **`reasoning`** channel — NOT the polymorphic content-array the
  first-party API uses — so the generic `nano-gpt-slug-swap` adapter handles it
  unchanged. Binary (no effort buckets), so a `toggle`, not `steps`.
- **🔒 Privacy:** no TEE / no ZDR. See [[../providers/nano-gpt]] (nano-gpt record TBD).

## Validation (2026-05-31, conversation-suite, live)

- **first-party (`mistral`):** core **16/22** — reasoning on **and** off (the
  polymorphic parser), tool call, tool-args, vision and usage **all PASS**; the
  **6 failures are the `memory-echo` turn on both permutations** (HTTP 400
  *"Unexpected role 'system' after role 'tool'"* — a Mistral message-ordering
  constraint, NOT an adapter bug). Vision scenario green. See
  [[../providers/mistral]] §Message-ordering constraint.
- **nano-gpt:** core **22/22 green** (incl. memory-echo — nano-gpt tolerates the
  mid-conversation system message) + vision green.

## Model instructions (2026-06-12)

The canonical carries the shared `MISTRAL_FORMATTING_INSTRUCTIONS` constant
(`packages/llm-unified/src/catalogue/model-instructions.ts`), injected as a
Band-1 prompt segment (chat + greeting jobs). **Why:** the Mistral family is
warm and creative but chronically over-formats — synopsis-style bullet lists
where the user asked for a story, spaced-out or all-capital words for emphasis,
heading cascades in casual chat. That exhausts the reader and is hostile to TTS
read-aloud. The steering restrains typography, never expression: lists and
tables remain available when the content is genuinely enumerable or the user
asks for them. Spec: `superpowers/specs/2026-06-12-model-instructions-design.md`.
