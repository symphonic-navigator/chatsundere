# Model Curation Record — Mistral Large 4

> Curation record. See [[../providers/mistral]] and [[../providers/nano-gpt]] for
> the shared provider mechanics (usage placement, CORS, slug conventions).

- **Identity:** Mistral Large 4 · family `mistral` · open-weight MoE (1.05T total,
  49B active per nano-gpt's listing)
- **T/R/V:** tools ✅ · reasoning ✅ (binary toggle) · vision ✅ (image input;
  output text-only)
- **replayReasoning:** false (soft-CoT, like the rest of the family)
- **🔒 Privacy:** first-party: no TEE / no ZDR (EU jurisdiction). nano-gpt: no
  TEE / no ZDR.
- **🕊️ Freedom:** **unknown** — `freedomOriented: null` on Chris's instruction
  (2026-10-07): he tests Large 4 thoroughly before judging it, so the badge shows
  "unknown" whatever the deployment says. Both deployments keep their existing
  provider-level `freedomOrientedDeployment: true` (neither Mistral nor nano-gpt
  adds censorship on top of a model).

Curated on 2026-10-07 on request: about twenty testers asked for it after seeing
it on nano-gpt. Curated on the first-party `mistral` API (existing
`mistral-openai` adapter, unchanged) and on `nano-gpt` (the
`nanoGptReasoningEffortAdapter`). Both `confidence: 'verified'`.

**Unlike Large 3, Large 4 reasons.** The canonical therefore declares
`requiredCaps.reasoning: true`, and both offerings carry a `toggle`.

## Offering — mistral (first-party)

- **slug:** `mistral-large-4` (alias `mistral-large-4-0`) · **adapterId:**
  `mistral:mistral-large-4`. **Not** `mistral-large-latest`, which still
  resolves to Large 3 (`mistral-large-2512`) as of 2026-10-07.
- **context:** recommended **262 144** / max **524 288** (512k window per
  `GET /models`); recommended at half the ceiling, the family's conservative
  "stays smart" stance.
- **reasoning control:** **`toggle`** (`defaultOn: false`, as for Small 4 and
  Medium 3.5). Probed live:
  - `reasoning_effort: 'high'` → thinking in the polymorphic content array
    (`{type:'thinking', thinking:[{type:'text', …}]}`), identical to Small 4, so
    the existing `foldDeltaContent` parser handles it unchanged.
  - `reasoning_effort: 'none'` → **genuine off** (5 completion tokens for the
    bat-and-ball answer, plain string content).
  - `'low'` / `'medium'` → HTTP 400 ("supported values: high, none") — binary,
    not `steps`.
  - No `reasoning_effort` at all → the model **reasons** (480 completion tokens).
    Irrelevant in practice: the adapter always sends `high` or `none`.
- **tool calls:** single block, streaming. `generate_image` fired reliably in
  both permutations; the tool-result continuation replied in prose.
- **usage:** on the terminal chunk; no reasoning-token breakdown (as for the
  family).
- **Vision:** verified — names "green" on the test image.

## Offering — nano-gpt

- **slug:** `mistralai/mistral-large-4` (alias `mistral/mistral-large-4`) ·
  **adapterId:** `nano-gpt:mistralai/mistral-large-4`
- **No thinking sibling.** Chris asked whether nano-gpt simply did not document
  one: `mistralai/mistral-large-4:thinking` and `…-thinking` both return
  `model_not_supported` (probed 2026-10-07). This breaks the slug-swap pattern of
  Small 4 / Medium 3.5 on nano-gpt.
- **context:** recommended **262 144** / max **524 288**.
- **reasoning control:** **`toggle`** (`defaultOn: false`), steered by a **body
  flag** on the bare slug, so it is bound to `nanoGptReasoningEffortAdapter` (the
  MiMo V2.6 Flash Uncensored shape) in `registerNanoGpt`. Probed live:
  - No flag → the bare slug **reasons** (191 reasoning tokens) on the standard
    `reasoning` delta channel.
  - `reasoning_effort: 'none'` → **genuine off** (0 reasoning tokens, 5
    completion tokens). `reasoning: {enabled: false}` behaves the same.
  - `reasoning_effort: 'high'` → **HTTP 400** ("Invalid request parameters"),
    although `GET /models?detailed=true` lists `reasoning_efforts: [none, high]`.
    Harmless: a `toggle` never carries an effort, so "on" is simply the
    provider's default. If the control ever becomes `steps`, this must be
    re-probed first.
- **tool calls:** delivered as a single block (nano-gpt coalesces tool-call
  arguments); `generate_image` fired in both permutations.
- **🔒 Privacy:** no TEE / no ZDR.

## Validation (2026-10-07, conversation-suite, live)

Harness: `packages/llm-unified/curation/run-mistral-suite.ts` (its nano-gpt branch
now resolves adapters from the registry after `registerNanoGpt()`, so it tests
the production wiring).

- **first-party (`mistral`):** core **32/32** (reasoning off + on) + vision
  **4/4**. The memory-echo turn, which 400'd on Large 3 at its 2026-05-31
  curation, passes.
- **nano-gpt:** core **32/32** (reasoning off + on) + vision **4/4**. One
  transient HTTP 503 on the first request was absorbed by the retry.

## Model instructions

The canonical carries the shared `MISTRAL_FORMATTING_INSTRUCTIONS` like the rest
of the family (see [[mistral-large-3]] for the why). Whether Large 4 still
over-formats is unverified — revisit once Chris has field-tested it.

## Tool history replay (2026-10-08, live)

Probed with `curation/run-tool-replay-suite.ts` (tool history replay spec, 2026-10-08). `tool-replay` is the gate: after a replayed `generate_image` round (9-character provider-neutral id, result, prose answer), a direct instruction must produce a real call on the tool channel. `orphan-tool-replay` is informational: the same history with **no** `tools` in the request; PASS sets `toolCalls.orphanReplay: true`.

| Offering | `tool-replay` | `orphan-tool-replay` | `orphanReplay` |
|---|---|---|---|
| `mistral:mistral-large-4` | PASS 6/6 | PASS (HTTP 200) | `true` |
| `nano-gpt:mistralai/mistral-large-4` | PASS 6/6 | PASS (HTTP 200) | `true` |

**Re-probe 2026-10-08 (after the final review):** every reasoning permutation, plus the new `tool-then-user` gate (a replayed message that ends on a tool round, directly followed by a user turn — the shape an interrupted call leaves). `mistral:mistral-large-4` and `nano-gpt:mistralai/mistral-large-4`: all three scenarios PASS on reasoning-off and reasoning-on.
