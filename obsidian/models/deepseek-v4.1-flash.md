# Model Curation Record — DeepSeek V4.1 Flash

> Curated on nano-gpt 2026-09-25 (entries added without live probes — the test
> key had been revoked, `401 Invalid session`) and **re-curated 2026-09-26** with
> live probes and the conversation-suite
> (`packages/llm-unified/curation/run-nano-sept2026-suite.ts`, which resolves the
> adapter from the registry after `registerNanoGpt()` — the exact app wiring).
> See [[../providers/nano-gpt]] for the shared mechanics.

- **Canonical:** `deepseek-v4.1-flash` · **Family:** `deepseek` · **Display:** DeepSeek V4.1 Flash
- **T/R/V:** tools ✅ · reasoning ✅ · vision ❌ at canonical level (offering-level bonus — see below)
- **replayReasoning:** false (soft-CoT — never replays its own thinking)
- **🕊️ Freedom:** free — `freedomOriented: true`, the DeepSeek-family judgement (Chris, 2026-05-30) carried forward; nano-gpt `freedomOrientedDeployment: true`.

## Offering — nano-gpt — `steps` with a clean off (slug swap)

- **slug:** `deepseek/deepseek-v4.1-flash` (+ `:thinking`) · adapter
  `nanoGptSlugSwapAdapter` — mirrors [[deepseek-v4-flash]].
- **context:** recommended 200 000 / max 1 048 576 (`/models`: 1 000 000;
  output up to 384 000).
- **reasoning control:** `steps` `['low','medium','high']` + `offStep: 'off'`.
  The bare slug is **genuinely off** (0 reasoning, 29 completion tokens for a
  138-character answer); `:thinking` reasons and honours effort (`max` longest,
  low/medium/high overlap in single samples).
- **vision:** ✅ on this offering, verified by the vision scenario. The
  canonical keeps `vision: false` because the ollama-cloud route ignored the
  image (Codex, 2026-09-25) — vision stays an offering-level bonus.
- 🔒 **Privacy:** no — nano-gpt has no ZDR/TEE on this route (`trust: { tee: false, zdr: false }`).
- **suite:** **PASS** core 44/44 (off/low/medium/high) and vision 4/4.
- Also published as `TEE/deepseek-v4.1-flash` — a 🔒 candidate, not curated here.
