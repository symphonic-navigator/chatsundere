# Model Curation Record — DeepSeek V3.2 (TEE)

> Curation record. See [[../providers/chutes]] for the shared provider mechanics.

- **Identity:** DeepSeek V3.2 · family `deepseek`
- **T/R/V:** tools ✅ · reasoning ✅ (optional, effort buckets) · vision ❌ (text-only)
- **replayReasoning:** false (soft-CoT — never replays its own thinking)

## Offering — chutes

- **slug:** `deepseek-ai/DeepSeek-V3.2-TEE` · **adapterId:** `chutes:deepseek-ai/DeepSeek-V3.2-TEE`
- **context:** recommended/max 131 072 (single value from `/models`)
- **reasoning control:** `reasoning_effort` (low/medium/high) to enable; off =
  `chat_template_kwargs: { enable_thinking: false }` (uniform chutes off switch —
  see [[../providers/chutes]]; "off = omit" was wrong, omit reasons by default).
- ⚠️ **Hidden reasoning:** emits `reasoning_tokens` (counted) but **no
  `reasoning_content` text**, even on a hard prompt at `effort: high` (probed
  2026-05-30) — the suite's `reasoning-present` fails for this offering. Reasoning
  happens (token-counted) but is not surfaced. Follow-up: decide whether the
  `reasoning` capability should be modelled as visible.
- 🔒 **Privacy:** yes (chutes TEE / confidential compute, attested per chunk)
- 🕊️ **Freedom:** free — `freedomOriented: true` (Chris, 2026-05-30: DeepSeek open-weight); the chutes TEE deployment is `freedomOrientedDeployment: true`.

## Probe findings (2026-05-30)

`reasoning_effort: "high"` accepted (HTTP 200). On a trivial arithmetic prompt the
model answered directly with `reasoning_content: null` and `reasoning_tokens: 0` —
i.e. no visible thinking for trivial work.

## Live validation (2026-05-30, conversation-suite)

The protocol pipe is proven end-to-end against live chutes: `no-http-error`,
`usage-present`, `generate_image` fired with valid JSON, memory carried, and
reasoning-off clean. The **only** reds are `reasoning-present` on the effort
permutations — see the hidden-reasoning note above: chutes DeepSeek V3.2 counts
`reasoning_tokens` but never streams `reasoning_content` text (confirmed on a hard
prompt at `effort: high`), so a channel-text assertion cannot pass. This is a
model/deployment visibility characteristic, not an adapter fault.

(Earlier this offering was recorded as "20/20 PASS" before the suite gained the
`reasoning-present` assertion and before the off switch moved to
`chat_template_kwargs`; the line above is the corrected, re-measured picture.)

## Why

DeepSeek V3.2 is a strong, popular general model; chutes offers it in TEE. They do
not yet have V4 (likely model-size reasons). A solid privacy-first default.
