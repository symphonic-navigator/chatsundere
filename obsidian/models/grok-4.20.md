# Model Curation Record — Grok 4.20

> Curation record. See [[../providers/xai]] for the shared xAI mechanics, and
> [[grok-4.3]] for the sibling model.

- **Identity:** Grok 4.20 · family `grok`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅ (input image; output text-only)
- **replayReasoning:** false — like 4.3, reasoning streams as a **summarised**
  human-readable form on `delta.reasoning_content`; no opaque encrypted blob on
  the Chat Completions surface. Display-only → `replayReasoning: false`.
- **🕊️ Freedom:** free — `freedomOriented: true` (Chris, 2026-06-28: xAI/Grok
  refuses near-nothing).

## The "excluded" reversal (2026-06-28)

Grok 4.20 was originally recorded as *deliberately excluded* (2026-06-02), on the
belief that it was a multi-agent-only model needing orchestration machinery
Chatsundere does not have. **That was a misread.** The plain Grok 4.20 is an
ordinary reasoning chat model; the multi-agent capability lives behind a
**separate** slug (`*-grok-4.20-multi-agent`), which we still do not curate.
Community demand (and OpenRouter's new xAI ZDR support) prompted the correction —
curated on **two deployments**: OpenRouter (🔒 ZDR) and xAI-direct. **Not** on
nano-gpt (see below).

## Offering — OpenRouter (🔒 ZDR)

- **slug:** `x-ai/grok-4.20` · **adapterId:** `openrouter:x-ai/grok-4.20`
- **context:** recommended **200 000** / max **2 000 000** (OpenRouter reports a
  2M ceiling; recommended stays at our 200k sweet-spot — price climbs above 200k).
- **reasoning control:** unified `reasoning` object — `{enabled:false}` a genuine
  off (0 reasoning tokens, probed 2026-06-28). `toggle` (defaultOn), the portable
  OpenRouter surface.
- **tool calls:** streamed **fragmented** (reassembled), concurrent with reasoning.
- **vision:** ✅.
- 🔒 **Privacy: ZDR.** `trust: { tee: false, zdr: true, jurisdiction: 'US' }`. The
  adapter sends `provider: { zdr: true }`; OpenRouter routes **only** to xAI's
  Zero-Data-Retention endpoint (probed 2026-06-28: HTTP 200, `provider: "xAI"`).
  The privacy route for Grok 4.20. See [[../providers/openrouter]].
- **Freedom:** `freedomOrientedDeployment: true`.
- **confidence:** `verified` — `run-grok-suite.ts` 2026-06-28: core 22/22 +
  vision 4/4, 0 fail.

## Offering — xAI (direct)

- **slug (base):** `grok-4.20-0309-non-reasoning` · **adapterId:**
  `xai:grok-4.20-0309-non-reasoning`
- **context:** recommended **200 000** / max **2 000 000**.
- **reasoning control:** **SLUG SWAP**, the headline divergence from 4.3. Grok
  4.20 does **not** accept `reasoning_effort` on either slug — both reject it with
  **HTTP 400** (probed 2026-06-28). Instead xAI exposes two pinned dated
  snapshots: `grok-4.20-0309-non-reasoning` (off) and `grok-4.20-0309-reasoning`
  (on). A **binary toggle, no effort buckets**. We pin the dated slugs rather than
  the floating `grok-4.20` alias (which resolves to the reasoning snapshot) to
  avoid silent drift. Bound to the new `xaiSlugSwapAdapter`.
- **tool calls:** streaming, concurrent with reasoning.
- **vision:** ✅.
- 🔒 **Privacy:** no TEE / no ZDR on the direct route (US jurisdiction). The ZDR
  path for Grok is OpenRouter, not xAI-direct. See [[../providers/xai]] for the
  future NGO-negotiated-ZDR note.
- **Freedom:** `freedomOrientedDeployment: true`.
- **confidence:** `verified` — `run-grok-suite.ts` 2026-06-28: core 22/22 +
  vision 4/4, 0 fail.

## NOT offered — nano-gpt (well-evidenced negative)

nano-gpt serves only the **non-reasoning** variant of Grok 4.20. The bare
`x-ai/grok-4.20` slug does not reason even with `reasoning:{enabled:true}` (probed
2026-06-28), and no reasoning sibling slug exists (`x-ai/grok-4.20:thinking` and
`x-ai/grok-4.20-reasoning` both **404**). Since the canonical requires reasoning
(`requiredCaps.reasoning: true`), a non-reasoning-only offering would fail the
`parseCatalogueEntry` capability gate — so it is **deliberately not curated** on
nano-gpt. Grok 4.3 *is* offered on nano-gpt (its reasoning toggle works there);
only 4.20's reasoning path is missing.

## Usage shape (probed 2026-06-28)

OpenAI-standard envelope, identical to 4.3: `completion_tokens` excludes
reasoning, `total_tokens` includes it, `reasoning_tokens` under
`completion_tokens_details`, `cached_tokens` under `prompt_tokens_details`. The
shared `xaiParseChunk` normalises it.

## Validation

`run-grok-suite.ts` (live, never CI), 2026-06-28 — both offerings green:
1. Reasoning **off** → `reasoning-absent` (off slug / `enabled:false` genuinely silent).
2. Reasoning **on** → `reasoning-present` (trace + answer).
3. **Vision** → test image's colour described correctly.
4. **Tools** → `generate_image` fires with valid JSON args.
5. **Memory/recall** → prior turn recalled.
