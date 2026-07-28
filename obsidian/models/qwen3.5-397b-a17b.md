# Model Curation Record — Qwen3.5 397B A17B

**Canonical id:** `qwen3.5-397b-a17b` · **Family:** `qwen` · **Curated:**
2026-05-31 (Liz, `/curate`).

A mixture-of-experts model from Alibaba — 397B total parameters, 17B active.
Added as a new canonical alongside the wafer onboarding.

## Identity — required capabilities (T/R/V)

`requiredCaps: { tools: true, reasoning: true, vision: true }`.

- **Reasoning — the empirical correction (CLAUDE.md §13, empirical truth over
  docs).** Wafer's `/models` reports `capabilities.reasoning: false` for this
  model. The live probe **contradicts** it: `reasoning_effort: 'medium'` yields
  ~4 750 reasoning tokens (≈18 k characters of `reasoning_content`), while
  `'none'` yields exactly zero — a clean on/off toggle. So reasoning is a real,
  steerable capability and is required of the canonical. We trust the probe.
- **Vision** and **tools** are both confirmed live (vision scenario green; the
  `generate_image` tool fires with valid JSON args).

Freedom: **not yet assessed** by Chris (`freedomOriented: null`, 2026-05-31) —
the 🕊️ badge resolves to *unknown* until judged.

## Offerings

### wafer — `Qwen3.5-397B-A17B` · **REMOVED 2026-07-28**

**Withdrawn, not deprecated by us.** On 2026-07-28 wafer's `/models` reported
`zdr_supported: false` for this model and had stripped its whole `wafer`
capability object (no `context_length`, no `capabilities` — the other entries
still carry theirs), which reads as an abandoned deployment rather than a
deliberate tier change. Because the adapter sends `Wafer-ZDR: required` whenever
`trust.zdr` is true, the offering had stopped working altogether: every request
answered **HTTP 422 `model_zdr_not_supported`**. It still responds without the
header, so the alternative was to keep it as a plain non-ZDR route — but wafer is
curated *for* its ZDR (sortPriority 15), and Qwen3.5 is reachable on OpenRouter
regardless, so Chris removed it (2026-07-28). The canonical survives on the
OpenRouter offering below.

The measured behaviour below is retained as the historical record of the wafer
deployment while it existed.

- **Trust (while it existed):** 🔒 **ZDR**. `trust: { tee: false, zdr: true }`.
  The adapter sent `Wafer-ZDR: required`, so the badge was truthful. ZDR was the
  always-on, omakase default (Chris, 2026-05-31).
- **Reasoning control:** `toggle` (default on). `reasoning_effort: 'none'`
  suppresses cleanly (suite `reasoning-absent` green), `'medium'` enables (suite
  `reasoning-present` green). Effort does not measurably modulate the trace
  across the wafer line, so a toggle — not steps — is the honest control.
- **Adapter quirk:** the adapter **always** sends an explicit `reasoning_effort`
  — *omitting* it made this model **hang** (90 s timeout, zero bytes). A
  toggle-on with no effort hint defaults to `medium`, so the omit path never
  occurs.
- **Tool calls:** streaming, fire correctly (suite green). **Vision:** green.
- **Context:** `recommended` = `max` = 262 144. Wafer reports a single
  `max_model_len`; no separate "stays-smart" ceiling is published, so the two
  are equal until evidence says otherwise.
- **Freedom (deployment):** `freedomOrientedDeployment: true` — wafer adds no
  censorship (Chris, 2026-05-31). Effective freedom is **unknown** while the
  model-intrinsic judgement is pending.
- **Verification:** conversation-suite live, 2026-05-31 — `core` 22/22 + `vision`
  4/4, both PASS.

### openrouter — `qwen/qwen3.5-397b-a17b` · `confidence: verified`

- **Trust:** 🔒 **no** — US router/aggregator, `trust: { tee: false, zdr: false,
  jurisdiction: 'US' }`. Not ZDR/TEE; trust is per-route. See
  [[../providers/openrouter]].
- **Reasoning control:** `toggle` (default on). OpenRouter's unified
  `reasoning: { enabled }` — off genuine (0 reasoning tokens), on ~214 reasoning
  tokens on the **`reasoning`** channel. Confirms the wafer/probe finding that
  this model reasons despite some `/models` metadata claiming otherwise. Unlike
  wafer, OpenRouter does **not** hang when reasoning is omitted; the adapter
  still always sends the unified param for reasoning-on.
- **Tool calls:** streaming (fragmented args, reassembled), fire correctly.
  **Vision:** green (image carried through, clothing colour named).
- **Context:** `recommended` = `max` = 262 144 (OpenRouter reported context).
- **Freedom (deployment):** `freedomOrientedDeployment: null` (pending Chris);
  effective freedom **unknown** while both judgements are open.
- **Verification:** conversation-suite live, 2026-05-31 — `core` 22/22 + `vision`
  4/4, both PASS.

## Notes

- The `/models` `reasoning:false` mislabel is recorded in the [[../providers/wafer]]
  Provider Record as the canonical example of preferring the probe over the
  metadata.
- Other Qwen models on wafer (Qwen3.6-35B-A3B, qwen3.7-max) are **not** curated:
  they are non-ZDR, and this batch curated the three ZDR flagships only.
