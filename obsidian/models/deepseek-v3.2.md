# Model Curation Record — DeepSeek V3.2 (TEE)

> Curation record. See [[../providers/chutes]] for the shared provider mechanics.

- **Identity:** DeepSeek V3.2 · family `deepseek`
- **T/R/V:** tools ✅ · reasoning ✅ (optional, effort buckets) · vision ❌ (text-only)
- **replayReasoning:** false (soft-CoT — never replays its own thinking)

## Offering — chutes

- **slug:** `deepseek-ai/DeepSeek-V3.2-TEE` · **adapterId:** `chutes:deepseek-ai/DeepSeek-V3.2-TEE`
- **context:** recommended/max 131 072 (single value from `/models`)
- **reasoning control:** `reasoning_effort` (low/medium/high), off = omit
- 🔒 **Privacy:** yes (chutes TEE / confidential compute, attested per chunk)
- 🕊️ **Freedom:** free — `freedomOriented: true` (Chris, 2026-05-30: DeepSeek open-weight); the chutes TEE deployment is `freedomOrientedDeployment: true`.

## Probe findings (2026-05-30)

`reasoning_effort: "high"` accepted (HTTP 200). On a trivial arithmetic prompt the
model answered directly with `reasoning_content: null` and `reasoning_tokens: 0` —
i.e. no visible thinking for trivial work.

## Live validation (2026-05-30, conversation-suite)

**PASS — 20/20 checks**, both reasoning-off and reasoning-on. `no-http-error`,
`usage-present` (usage surfaces correctly), `generate_image` fired with valid
JSON arguments, and the memory token was carried through the protocol. The
adapter is proven end-to-end against live chutes. Note: reasoning-on token counts
were close to reasoning-off (≈353 vs ≈361 on the plain turn), i.e. little visible
thinking on these prompts — consistent with the trivial-prompt probe; not a
fault, a model-behaviour observation.

## Why

DeepSeek V3.2 is a strong, popular general model; chutes offers it in TEE. They do
not yet have V4 (likely model-size reasons). A solid privacy-first default.
