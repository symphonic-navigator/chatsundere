# Model Curation Record — MiMo V2.6 Pro

> Curated on nano-gpt 2026-09-25 (entries added without live probes — the test
> key had been revoked, `401 Invalid session`) and **re-curated 2026-09-26** with
> live probes and the conversation-suite
> (`packages/llm-unified/curation/run-nano-sept2026-suite.ts`, which resolves the
> adapter from the registry after `registerNanoGpt()` — the exact app wiring).
> See [[../providers/nano-gpt]] for the shared mechanics.

- **Canonical:** `mimo-v2.6-pro` · **Family:** `mimo` · **Display:** MiMo V2.6 Pro
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅ (omnimodal)
- **replayReasoning:** false (soft-CoT — never replays its own thinking)
- **🕊️ Freedom:** free — `freedomOriented: true`, the MiMo-family judgement (Chris, 2026-05-31) carried forward; nano-gpt `freedomOrientedDeployment: true` (Chris, 2026-09-26: nano-gpt adds no censorship, and he has clear evidence on the MiMo models — the 2026-09-25 entry had left it `null` without a reason).

## Offering — nano-gpt — `fixed-on` (off only hides)

- **slug:** `xiaomi/mimo-v2.6-pro` · adapter `nanoGptReasoningEffortAdapter`
- **context:** recommended 200 000 / max 1 048 576 (`/models`: 1 048 576).
- **reasoning control:** `fixed-on`. No `:thinking` sibling. The two off
  spellings behave differently and neither is real:
  `reasoning_effort:'none'` still streams a full trace (it is not even
  hidden), and `reasoning:{enabled:false}` blanks the channel while the
  model keeps thinking — 1131 completion tokens for a 210-character answer
  (Flash), 1618 for Pro on the same prompt. The textbook "off only hides", so
  `fixed-on`, as the 2026-09-25 entry guessed. `high` is the only other
  accepted effort (`low` → HTTP 400), so there is no ladder to offer.
- **usage:** reports no `reasoning_tokens` (always 0) — reasoning is billed
  inside `completion_tokens`.
- **latency:** very slow on nano-gpt at probe time — 20–90 s per answer.
  Flash in particular spiked to 241 s once. A provider-side routing issue, not
  a pipe fault; worth watching in the field.
- **vision:** ✅ verified by the vision scenario.
- 🔒 **Privacy:** no — nano-gpt has no ZDR/TEE on this route (`trust: { tee: false, zdr: false }`).
- **suite:** **PASS** core 11/11 (reasoning-on) and vision 4/4.
- Also published: `xiaomi/mimo-v2.6-pro-ultraspeed` (10× the price) — not curated.
