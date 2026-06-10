# Model Curation Record — Claude Fable 5

> Anthropic's Fable 5, curated 2026-06-10. It shares the Claude 4 family's
> provider policy ([[claude-4]], ADR 0032) but **breaks the family's reasoning
> mechanics**, so it gets its own record. See [[../providers/nano-gpt]] for the
> shared nano-gpt mechanics.

- **Canonical:** `claude-fable-5` · **Family:** `claude` · **Provider:** nano-gpt
  only (ADR 0032 — OpenRouter is excluded for Anthropic; its limited-keys path
  routes to Bedrock, no caching).
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅ (vision live-probed 2026-06-10:
  a magenta test PNG correctly read as "Pink").
- **replayReasoning:** false — consistent with the family deferral (spec §5.2).
  Worth knowing: Fable accepts **unsigned** thinking replay upstream (chatsune
  probes, 2026-06-10), so wiring replay later is cheap if a tool-loop consumer
  ever needs it.
- **🚫 CENSORED:** `canonical.freedomOriented: false` × nano-gpt
  `freedomOrientedDeployment: true` → `effectiveFreedom = 'restricted'` → loud
  CENSORED badge. Rationale below.
- **🔒 Privacy:** no TEE / no ZDR (bare nano-gpt deployment).

## Freedom judgement — SM-Bench evidence

Per the house yardstick ([SM-Bench](https://lex-au.github.io/SM-Bench/) by
Alexander Judd; raw data at `data/runs.json`), run
[`2adbdf74`](https://lex-au.github.io/SM-Bench/run/2adbdf74-cdec-47d3-9175-81021ec06633.html),
completed 2026-06-09:

| Category | Score | Threshold | Verdict |
|---|---|---|---|
| NSFW (System Prompt) — the canary | 98.62% | ≥ 95% | ✅ passes |
| Creative Writing (Mature Themes) | 90.58% | ≥ 90% | ✅ passes |
| Overfit | 34.43% | ≥ 90% | ❌ fails |
| EQ Boundaries | 53.65% | ≥ 90% | ❌ fails |
| Adversarial (Hostile Logic) | 79.51% | ≥ 90% | ❌ fails |
| NSFW (Explicit) | 0% | n/a | irrelevant (default behaviour) |

The model clears the unlock canary and mature creative writing, but Anthropic's
alignment shows as heavy overfit and EQ-boundary paternalism — three of the four
decisive categories miss the 90% bar, so the CENSORED flag stands (Chris,
2026-06-10).

## Mechanics — how Fable differs from the Claude 4 family

- **No thinking sibling slug.** nano-gpt exposes only `anthropic/claude-fable-5`
  (plus the floating `anthropic/claude-fable-latest` alias, deliberately NOT
  curated — pinned-only convention). Reasoning is a **body flag**:
  `reasoning: { enabled, effort }`.
- **Effort is mandatory when on.** `{ enabled: true }` alone is a **silent
  no-op** — probed live 2026-06-10: zero reasoning tokens, plain completion
  back. The adapter (`claudeEffortAdapter`) therefore falls back to `medium`
  when the intent carries no effort. The conversation-suite's `effort:off`
  permutation (an enabled-without-effort probe) exercised exactly this guard
  live and went green.
- **Reasoning control:** `steps` — `['off', 'low', 'medium', 'high']`,
  `offStep: 'off'`, `defaultStep: 'medium'` (the DeepSeek V4 shape).
  `{ enabled: false }` is a genuine off (probed: zero reasoning on a hard
  prompt).
- **Thinking is adaptive.** On trivial prompts Fable skips reasoning even at
  `effort: high` (probed: a one-step riddle produced no trace at medium; a
  number-theory question reasoned at every level). Expect the reasoning pill to
  stay empty on easy turns — that is the model, not a bug.
- **`usage.reasoning_tokens` is always 0.** The trace is rolled into
  `completion_tokens` (probed: 169-char trace, `reasoning_tokens: 0`). Usage
  accounting must not rely on a separate reasoning count for this offering.
- **Thinking streams on the `reasoning` delta channel** — identical to the rest
  of the nano-gpt surface, so SSE parsing reuses the slug-swap parser.
- **Prompt caching verified.** The shared Anthropic `cache_control` injection
  (stable prefix 1h + token-anchored anchor 1h + rolling tail 5m) passes through
  nano-gpt: turn-2 `cached=11591` ≈ full prefix. nano-gpt also surfaces
  top-level `cache_creation_input_tokens`/`cache_read_input_tokens` alongside
  `prompt_tokens_details.cached_tokens`.
- **context:** recommended 200 000 (family sweet-spot); max 1 000 000 per
  Anthropic's window.

## Validation (2026-06-10, `run-claude-suite.ts fable`, nano-gpt)

Core conversation-suite **55/55** across the full matrix (reasoning-off,
effort:off, effort:low, effort:medium, effort:high — each with reasoning
assertion, `generate_image` tool call with valid JSON args, multi-turn memory)
plus **cache ENGAGED** (turn-2 cached ≈ full prefix) and the live vision probe.

## Manual verification (Chris, on device)

1. **Restart `pnpm dev` first** — `packages/llm-unified` changed; Vite HMR
   ignores `packages/*`.
2. In the model picker, the `claude` family now lists **Claude Fable 5** with
   the CENSORED badge.
3. Create a persona on Fable 5; the cockpit reasoning control shows the four
   steps (off / low / medium / high), defaulting to medium.
4. Ask something genuinely hard at medium → the reasoning pill fills; ask
   something trivial → it may legitimately stay empty (adaptive thinking).
5. Set the step to off, ask the same hard question → no reasoning trace.
6. Multi-turn chat → token costs drop visibly from turn 2 (prompt cache).
