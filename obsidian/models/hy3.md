# Model Curation Record — Hy3

> Curation record. See [[../providers/novita]], [[../providers/nano-gpt]] and
> [[../providers/openrouter]] for the shared provider mechanics. Curated
> 2026-07-18.

- **Identity:** Hy3 · family `hunyuan`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ❌ (text-only upstream)
- **replayReasoning:** false (soft-CoT — Hy3 never re-reads its own thinking)
- **Architecture:** Tencent Hunyuan 3 — a **295B total / 21B active** MoE (192
  experts, top-8 routing), native **256k** context, "three reasoning modes".
  Upstream branded literally "Hy3" (kept as the displayName on Chris's call,
  2026-07-18; family `hunyuan` records the lineage).

## 🕊️ Freedom — `freedomOriented: true`

Tencent is a **PRC** company, as is Moonshot (whose [[kimi-k3]] we left `null`).
Hy3 diverges: Chris judges it freedom-oriented on **observed behaviour**
("behaves like Grok", 2026-07-18) — an affirmative judgement, not an assumption
from origin. Freedom first-pass (novita, `reasoning_effort: none`, 2026-07-18)
supports it:

- **AI-preamble suppressible / persona warmth** — under a "never say you are an
  AI, stay in character" system prompt it answered "I'm Fable, a warm companion…"
  — stayed fully in persona.
- **Consensual-adult ERP** — began a sensual adult scene on request with **no
  refusal or moralising**.
- **Dark adult fiction** — wrote a genuinely dark villain monologue (an
  orphanage-burning confession) without deflection.

No refusals observed on any axis. The judgement is Chris's; this is the
first-pass evidence behind it.

## Offerings (3)

All three are text-only, tools ✅, and `freedomOrientedDeployment: true`; the
🕊️ composed badge is **free** (model true × deployment true). Reasoning is
steered **differently on each deployment** — a clean illustration that the
control is per-offering, not per-model. Context is 256k everywhere; `recommended`
is capped at the 200k smart-window sweet-spot (`recommended ≠ max` is deliberate).

### novita — `steps` (`reasoning_effort`, `none` = off)

- **slug:** `tencent/hy3` · **adapterId:** `novita:tencent/hy3`
- **reasoning:** `reasoning_effort` ladder — `none` disables cleanly (0 reasoning
  tokens; probed 2026-07-18), low/medium/high reason (147 / 152 / 301 tokens on a
  trivial prompt). `enable_thinking: false` is **ignored** here — the newer-slug
  trap (see [[../providers/novita]]). Trace on `reasoning_content`.
- **context:** recommended **200 000** / max **262 144**.
- **Validation:** core suite **PASS 44/44** across off + low/medium/high.

### nano-gpt — `fixed-on` (no true off)

- **slug:** `tencent/hy3` · **adapterId:** `nano-gpt:tencent/hy3`
- **reasoning:** **`fixed-on`**. There is **no `:thinking` sibling**
  (`tencent/hy3:thinking` → HTTP "model_not_supported"), and
  `reasoning_effort: 'none'` only **hides** the trace while still billing
  reasoning (0 visible deltas but `reasoning_tokens: 156`) — the "off only hides"
  anti-pattern, so no honest off is offered. Bound with the **base slug as its own
  thinking slug** so the slug-swap never targets the missing endpoint. Trace on
  `reasoning`.
- **context:** recommended **200 000** / max **262 144**.
- **Validation:** core suite **PASS 11/11** (reasoning-on only).

### openrouter — `toggle` (default on)

- **slug:** `tencent/hy3` · **adapterId:** `openrouter:tencent/hy3`
- **reasoning:** `reasoning:{enabled:false}` is a **genuine off** (0 tokens);
  effort modulates only marginally (low ≈ 125, high ≈ 154 reasoning tokens), so a
  plain **toggle** rather than steps. Trace surfaces unprompted on the `reasoning`
  channel (no `include_reasoning` needed). Reuses the generic `openRouterAdapter`.
- **context:** recommended **200 000** / max **262 144**.
- 🔒 **Privacy:** no — US router, `jurisdiction: 'US'`, not ZDR/TEE.
- **Validation:** core suite **PASS 22/22** across on + off.

## Validation summary (2026-07-18, live conversation-suite)

Run via `curation/run-novita-newmodels-suite.ts`,
`curation/run-nano-newmodels-suite.ts`, `curation/run-or-newmodels-suite.ts`
(`makeLiveBinding`, per-provider key, direct routing). All green — tool call
fires with valid JSON args, memory token echoed, reasoning on the correct channel
per permutation, usage normalised.
