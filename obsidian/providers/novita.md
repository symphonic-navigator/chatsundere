# Provider Curation Record — Novita AI

> Provider record. Per-model offerings cross-link back here for the shared
> novita mechanics. Written 2026-07-18, after novita had already served nine
> offerings undocumented — this record closes that gap.

- **Provider id:** `novita` · **displayName:** Novita AI
- **Base URL:** `https://api.novita.ai/v3/openai`
- **Shape:** `openai-chat-completions`
- **Key file:** `keys/.novita-test-key` (gitignored, never in CI)
- **CORS:** `direct` (novita permits direct browser calls)
- **sortPriority:** 20 (ahead of the router tier — a first-party open-weight host)

## What novita is

A serverless open-weight model host exposing a uniform OpenAI-compatible surface
over the GLM, DeepSeek, Kimi, Gemma, MiMo, Hunyuan and MiniMax families. Trust
baseline: **no TEE, no ZDR** (`trust: { tee: false, zdr: false }`).
**Censorship:** novita routes the open weights verbatim and adds no filter of its
own, so `freedomOrientedDeployment: true` (Chris, 2026-05-30) — the freedom
verdict is the *model's*, not the deployment's. Chris's shorthand: "a
well-behaved provider".

## Reasoning — TWO mechanisms (probed live)

novita does **not** steer reasoning uniformly. There are two distinct switches,
split by model generation, and picking the wrong one silently fails to disable
thinking:

1. **`enable_thinking` boolean** (the older families — GLM, DeepSeek, Kimi K2.6,
   Gemma, MiMo). A top-level `enable_thinking: false` is the **only** switch that
   disables thinking; `reasoning`, `chat_template_kwargs.enable_thinking` and
   `reasoning_effort: 'none'` were all found NOT to (probed across glm-5/5.1,
   deepseek-v4-*). No effort buckets → a plain **toggle**. Adapter:
   [`novita-thinking.ts`](../../packages/llm-unified/src/adapters/novita-thinking.ts).

2. **`reasoning_effort` bucket** (the newer families — Hy3, Kimi K3, MiniMax M3;
   probed 2026-07-18). On these slugs `enable_thinking: false` is **ignored** —
   thinking continues regardless. Instead `reasoning_effort` steers, with the
   literal `none` bucket as the off switch. Adapter:
   [`novita-reasoning-effort.ts`](../../packages/llm-unified/src/adapters/novita-reasoning-effort.ts).
   Per-model behaviour differs:
   - **Hy3, Kimi K3** — `reasoning_effort: 'none'` is a clean off (0 reasoning
     tokens); low/medium/high all reason → a **steps** ladder with a real off.
   - **MiniMax M3** — `reasoning_effort` (incl. `none`) has **no effect**: it
     reasons unconditionally → **fixed-on**. See [[../models/minimax-m3]] for the
     channel-separation caveat this creates.

Thinking streams on the **`reasoning_content`** delta channel (NOT `reasoning`).

## Usage

`stream_options.include_usage` yields a final `choices: []` event carrying
`usage`. `reasoning_tokens` is nested under `completion_tokens_details` (novita
does **not** report it top-level, unlike chutes). MiniMax M3 omits
`reasoning_tokens` entirely — the adapter's null-guard tolerates this.

## Tool calls

Arrive as a single block (not fragmented), concurrent with reasoning. The
fragment buffer in both adapters is retained for safety. `tool_choice` is left
at the provider default (the app never sends it).

## Offerings (12)

Nine `enable_thinking` toggles (deepseek-v4-flash/pro, glm-5/5.1/5.2, kimi-k2.6,
gemma-4-31b, mimo-v2.5-omni/pro) plus three `reasoning_effort` additions
(2026-07-18): [[../models/kimi-k3]] (steps), [[../models/hy3]] (steps),
[[../models/minimax-m3]] (fixed-on). All `freedomOrientedDeployment: true`.
