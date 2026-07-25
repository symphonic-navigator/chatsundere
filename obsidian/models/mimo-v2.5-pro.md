# Model Curation Record — MiMo V2.5 Pro

> Curation record. Shares novita mechanics with [[mimo-v2.5-omni]]; the key
> difference is that **Pro is text-only**. Two routes since 2026-07-25: novita,
> and nano-gpt via the **CROF** upstream (deliberately not Xiaomi's own).

- **Identity:** MiMo V2.5 Pro · family `mimo` · canonical id `mimo-v2.5-pro`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ❌ (text-only)
- **replayReasoning:** false (soft-CoT)
- **🕊️ Freedom:** free — `freedomOriented: true` (Chris, 2026-05-31); both
  curated deployments carry `freedomOrientedDeployment: true`. The Xiaomi-served
  nano-gpt slug would **not**, which is why it is not curated — see the CROF
  section below.

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

## Offering — nano-gpt, via the CROF upstream (added 2026-07-25)

Second route, and the interesting part is **which** slug we took. nano-gpt
carries four MiMo Pro slugs: `xiaomi/mimo-v2.5-pro` (+ `:thinking`) served from
Xiaomi's own backend, and `xiaomi/mimo-v2.5-pro-crof` (+ `:thinking`) served from
**CROF**, a Western neocloud nano-gpt keeps upstream. **We curate only the CROF
pair**, on Chris's call (2026-07-25).

- **slug:** `xiaomi/mimo-v2.5-pro-crof` · **thinking sibling:**
  `xiaomi/mimo-v2.5-pro-crof:thinking` · **adapterId:**
  `nano-gpt:xiaomi/mimo-v2.5-pro-crof`
- **adapter:** `nanoGptSlugSwapAdapter` — no new adapter; the default
  `${base}:thinking` convention holds.
- **reasoning control:** `steps` (off/low/medium/high). Slug swap, probed live
  2026-07-25: the bare slug answers with an empty reasoning channel, the
  `:thinking` sibling streams its trace on `reasoning`.
- **context:** recommended **200 000** · max **1 048 576**, matching novita.
- **vision:** text-only, as on novita.
- 🔒 **Privacy:** no TEE / no ZDR (bare nano-gpt deployment).
- 🕊️ **Freedom: free.** The weights were already judged freedom-oriented
  (`freedomOriented: true`, Chris 2026-05-31), and this **deployment** earns
  `freedomOrientedDeployment: true` on its own merit — which the Xiaomi-served
  route would not. The distinction is the whole point of taking CROF: the model
  is uncensored either way, but Xiaomi's backend answers the mildest prompt with
  HTTP 400, so on that route the *deployment* does the censoring. nano-gpt's
  Milan advertises the CROF slugs as filter-free. `effectiveFreedom(true, true)
  = 'free'` → 🕊️ badge.

## Why the routes are what they are

novita was originally the only workable Western home for the MiMo family (see
[[mimo-v2.5-omni]] — the compute-scarcity argument). The CROF slugs appearing on
nano-gpt in July 2026 changed that: a second Western route, reached through the
anonymising router rather than a direct provider account.

## Validation

**novita (2026-05-31, `run-novita-mimo-suite.ts`)**

- **Core scenario:** PASS on both reasoning permutations (on + off), 22/22 —
  tools (`generate_image` fired, args valid JSON), memory echo, usage all green;
  reasoning-present on, reasoning-absent off.
- **Vision scenario:** not applicable (text-only).

**nano-gpt / CROF (2026-07-25, `run-mimo-crof-suite.ts`)**

- **Core scenario:** **44/44** across all four permutations (off, low, medium,
  high) — no HTTP or stream errors, `generate_image` fires with valid JSON args
  on every permutation, memory echoed, usage normalised, reasoning present on
  each effort step and absent on off.
- **Vision scenario:** not applicable (text-only).
- The runner resolves its adapter through `registerNanoGpt` rather than building
  one, so the run exercises the production registration path.

Both runners are local-only, never CI.
