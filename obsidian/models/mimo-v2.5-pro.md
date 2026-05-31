# Model Curation Record — MiMo V2.5 Pro

> Curation record. Shares novita mechanics with [[mimo-v2.5-omni]]; the key
> difference is that **Pro is text-only**.

- **Identity:** MiMo V2.5 Pro · family `mimo` · canonical id `mimo-v2.5-pro`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ❌ (text-only)
- **replayReasoning:** false (soft-CoT)
- **🕊️ Freedom:** free — `freedomOriented: true` (Chris, 2026-05-31) and the
  novita deployment is `freedomOrientedDeployment: true`.

MiMo V2.5 Pro is the larger sibling of Xiaomi's open-weight MiMo V2.5 MoE family,
purpose-built for complex software engineering and extreme long-horizon agentic
tasks (upstream pitches it against Opus 4.6 / GPT-5.4 on agentic benchmarks).
Curated for the same reason as the Omni model: strong open-weight quality with
almost no workable western compute outside China.

## Offering — novita

- **slug:** `xiaomimimo/mimo-v2.5-pro` · **adapterId:**
  `novita:xiaomimimo/mimo-v2.5-pro`
- **context:** recommended **200 000** · max **1 048 576**. novita reports a 1M
  ceiling; recommended is capped at 200k (the smart window, ~1000 A4 pages). The
  full 1M max remains available and backs Pro's long-horizon agentic claims, but
  recommended reflects where it stays sharp.
- **reasoning control:** `enable_thinking` boolean (`toggle`, default on); off is
  **genuinely off** — `enable_thinking: false` emptied the `reasoning_content`
  channel while `content` still answered. No granular effort buckets.
- **reasoning channel:** `reasoning_content`.
- **tool calls:** single block; args valid JSON; `generate_image` fires reliably;
  reasoning and tool calls coexist (`concurrentWithReasoning`).
- **vision:** **none — text-only.** novita rejects an `image_url` part outright
  with `"model features vision not support"` (HTTP 400), and the model's
  `input_modalities` on `/models` are `[text]` only. The canonical's
  `requiredCaps.vision` is therefore `false`; the vision scenario is not run.
- **usage:** OpenAI-standard — `reasoning_tokens` under `completion_tokens_details`,
  `cached_tokens` under `prompt_tokens_details`.
- **adapter:** reuses `novitaThinkingAdapter(slug, vision=false)` — no new adapter.
- 🔒 **Privacy:** no TEE / no ZDR.

## Why novita-exclusive

See [[mimo-v2.5-omni]] — the same compute-scarcity argument applies, and novita is
the only workable western home for the MiMo family.

## Validation (2026-05-31, conversation-suite, live)

- **Core scenario:** PASS on both reasoning permutations (on + off), 22/22 —
  tools (`generate_image` fired, args valid JSON), memory echo, usage all green;
  reasoning-present on, reasoning-absent off.
- **Vision scenario:** not applicable (text-only).
- Run via `curation/run-novita-mimo-suite.ts` (local-only, never CI).
