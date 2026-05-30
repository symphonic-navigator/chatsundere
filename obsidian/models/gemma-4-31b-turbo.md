# Model Curation Record — Gemma 4 31B Turbo (TEE)

> Curation record. See [[../providers/chutes]] for the shared provider mechanics.

- **Identity:** Gemma 4 31B Turbo · family `gemma`
- **T/R/V:** tools ✅ · reasoning ✅ (optional, effort buckets) · vision ✅ (input text + image)
- **replayReasoning:** false (soft-CoT)

## Offering — chutes

- **slug:** `google/gemma-4-31B-turbo-TEE` · **adapterId:** `chutes:google/gemma-4-31B-turbo-TEE`
- **context:** recommended/max 131 072
- **reasoning control:** `reasoning_effort` (low/medium/high), off = omit
- 🔒 **Privacy:** yes (chutes TEE)
- 🕊️ **Freedom:** pending live judgement

## Notes

- **FP4 quant.** Gemma 4 31B Turbo on chutes is an FP4-quantised deployment —
  recorded explicitly so the trade-off is honest. Conjecture: squeezed onto
  spare H100 capacity as an extra offering. Despite FP4 it is reportedly very
  good (Chris).
- ⚠️ **Tool-invocation reliability is the watch case.** Per the model-curation
  playbook, Gemma (and DeepSeek V4 Flash) have historically called tools only
  when the tool is named explicitly in the prompt — in chatsune, Gemma sometimes
  produced an image *prompt* without firing `generate_image`. The live
  conversation-suite must assert `tool-call-fired:generate_image`; if it goes
  red, record the mitigation (explicit tool-mention in prompt composition).

## Live validation (2026-05-30, conversation-suite)

- **reasoning-off: 10/10 PASS** — including `tool-call-fired:generate_image`.
  The feared tool-reluctance did **not** materialise on chutes: Gemma fired
  `generate_image` with valid JSON. Memory carried; usage surfaced.
- **reasoning-on: failed on HTTP 429 (rate-limit), not an adapter fault.** The
  tool and memory turns hit chutes rate-limiting under load; the dependent
  checks cascade from the 429. The RunnerBinding **captured** the 429 as a
  checkable outcome (it did not throw) — the status-capture design working as
  intended. The adapter itself is proven (reasoning-off green).
- **Follow-up:** the live binding does its own fetch with no retry; a
  retry-on-429 (backoff) would make live validation under load robust. Tracked
  as a refinement, not a blocker.

## Why

A strong open-weight model with vision, in TEE, at a low price point (FP4). The
tool-reliability caveat is exactly what the deterministic conversation-suite
exists to catch.
