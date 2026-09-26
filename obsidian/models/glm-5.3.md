# Model Curation Record — GLM 5.3

> Curated on nano-gpt 2026-09-25 (entries added without live probes — the test
> key had been revoked, `401 Invalid session`) and **re-curated 2026-09-26** with
> live probes and the conversation-suite
> (`packages/llm-unified/curation/run-nano-sept2026-suite.ts`, which resolves the
> adapter from the registry after `registerNanoGpt()` — the exact app wiring).
> See [[../providers/nano-gpt]] for the shared mechanics.

- **Canonical:** `glm-5.3` · **Family:** `glm` · **Display:** GLM 5.3
- **T/R/V:** tools ✅ · reasoning ✅ · vision ❌ (text-only)
- **replayReasoning:** false (soft-CoT — never replays its own thinking)
- **🕊️ Freedom:** free — `freedomOriented: true`, the GLM-family judgement (Chris, 2026-05-30) carried forward; nano-gpt `freedomOrientedDeployment: true`.

## Offering — nano-gpt — `steps` without an off

- **slug:** `z-ai/glm-5.3` · **adapterId:** `nano-gpt:z-ai/glm-5.3` · adapter
  `nanoGptReasoningEffortAdapter` (base slug + `reasoning_effort`)
- **context:** recommended 200 000 / max 1 048 576 (nano-gpt `/models`:
  1 048 576). Recommended is the family's "stays smart" window; long-context
  degradation was not probed.
- **reasoning control:** `steps` `['low','high','max']`, **`offStep: null`**,
  default `high`.
- **Why no off — the correction.** The 2026-09-25 entry assumed the usual GLM
  slug swap (`z-ai/glm-5.3:thinking` *is* published) and offered an off step.
  The probes disprove it: the bare slug still reasons briefly (25–36 reasoning
  tokens on the suite's bookshop word problem, three runs; 0 only on a trivial
  multiplication), and every explicit off spelling —
  `reasoning_effort:'none'`, `reasoning:{enabled:false}`,
  `thinking:{type:'disabled'}` — is rejected with HTTP 400
  `reasoning_required` ("GLM 5.3 always thinks"). An off chip would have lied.
  The base slug accepts the published ladder; `:thinking` is left unused.
- **effort:** `max` separates clearly (~3× the reasoning of low/medium/high on
  a hard prompt); low and high overlap in single samples. Shipped as the
  published `low/high/max` ladder, identical to [[glm-5.3-flash]].
- **tool calls:** single block; concurrent with reasoning; valid JSON.
- **usage:** `reasoning_tokens` reported (top-level and under
  `completion_tokens_details`).
- 🔒 **Privacy:** no — nano-gpt has no ZDR/TEE on this route (`trust: { tee: false, zdr: false }`).
- **suite:** first run red on `reasoning-absent` (the off step leaking — the
  finding above); after the correction **PASS 33/33** across low/high/max.

## Follow-up — the ollama-cloud offering

The ollama-cloud offering (added 2026-09-25) is a `toggle` whose off is
`think:false`, which yielded an empty thinking channel. Given nano-gpt's
explicit `reasoning_required`, that off very likely *hides* rather than
disables. Not re-probed here (outside this re-curation's scope) — tracked in
[[../insights/follow-ups-index]].
