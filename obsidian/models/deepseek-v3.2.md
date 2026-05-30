# Model Curation Record — DeepSeek V3.2 (TEE)

> Curation record. See [[../providers/chutes]] for the shared provider mechanics.

- **Identity:** DeepSeek V3.2 · family `deepseek`
- **T/R/V:** tools ✅ · reasoning ✅ (toggle) · vision ❌ (text-only)
- **replayReasoning:** false (soft-CoT — never replays its own thinking)

## Offering — chutes

- **slug:** `deepseek-ai/DeepSeek-V3.2-TEE` · **adapterId:** `chutes:deepseek-ai/DeepSeek-V3.2-TEE`
- **context:** recommended/max 131 072 (single value from `/models`)
- **reasoning control:** symmetric `chat_template_kwargs` toggle — on =
  `{ enable_thinking: true }`, off = `{ enable_thinking: false }` (see
  [[../providers/chutes]]). `reasoning_effort` is **not** the on-switch for this
  model and does not modulate the trace, so reasoning is a `toggle`, not steps.
- ✅ **Visible reasoning channel.** Streams `reasoning_content` (with
  `reasoning_tokens`) whenever `enable_thinking: true` is set — re-probed live
  2026-05-31. The earlier "hidden reasoning / no `reasoning_content`" record
  (2026-05-30) was an artefact of the **wrong on-switch** (`reasoning_effort`
  alone): under it this model emits zero `reasoning_content` *and* zero
  `reasoning_tokens` and reasons in bare `content` prose. See
  [[../insights/2026-05-31-chutes-reasoning-on-switch]].
- 🔒 **Privacy:** yes (chutes TEE / confidential compute, attested per chunk)
- 🕊️ **Freedom:** free — `freedomOriented: true` (Chris, 2026-05-30: DeepSeek open-weight); the chutes TEE deployment is `freedomOrientedDeployment: true`.

## Live validation (2026-05-31, conversation-suite)

Full core scenario green across the toggle permutations (reasoning on + off):
`no-http-error`, `usage-present`, `generate_image` fired with valid JSON, memory
carried, `reasoning-present` (on) and `reasoning-absent` (off) all pass. Fixing
the on-switch (`enable_thinking: true`) is what turned `reasoning-present` green.

## Why

DeepSeek V3.2 is a strong, popular general model; chutes offers it in TEE. They do
not yet have V4 (likely model-size reasons). A solid privacy-first default.
