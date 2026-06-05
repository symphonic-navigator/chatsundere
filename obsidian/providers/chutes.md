# Provider Curation Record — Chutes

> Curation record (not an ADR). The honesty surface for chutes — what it is, how
> we talk to it, and *why* we trust it. See `.claude/skills/curate/references/conventions.md`.

- **id:** `chutes` · **displayName:** Chutes
- **Base URL:** `https://llm.chutes.ai/v1` (OpenAI-compatible Chat Completions)
- **Auth:** Bearer token, prefix `cpk_` · key file `keys/.chutes-test-key`
- **Docs:** <https://chutes.ai/llms.txt> (LLM-friendly, intentional) · fuller: `llms-full.txt`
- **Probe:** `GET /models` · **CORS:** `direct` (browser-accessible; confirmed against chatsune's integration)
- **sortPriority:** 10 — chutes ranks first (privacy-first partner), ahead of novita (20), ollama-cloud (30), nano-gpt (40).

## Base characteristics

- 🔒 **Privacy: yes.** Chutes serves **every** model inside a Trusted Execution
  Environment (TEE / confidential compute). The authoritative signal is the
  `confidential_compute: true` boolean on each `/models` entry — **trust the
  boolean, not the `-TEE` slug suffix** (the docs are explicit on this). Each
  streamed chunk also carries a `chutes_verification` attestation hash (the TEE
  proof); we ignore it for parsing but it is the cryptographic basis of the
  Privacy badge.
- **ZDR / jurisdiction:** to confirm with Chris's contact at chutes — TEE is the
  hard, verifiable property; ZDR and the legal jurisdiction are not yet
  documented here and should not be asserted until confirmed.

## Slug convention

`org/Model-TEE` (e.g. `deepseek-ai/DeepSeek-V3.2-TEE`, `zai-org/GLM-5.1-TEE`).
Reasoning is **not** a slug variant — it is a body parameter (below), so there is
no `:thinking`/`-thinking` sibling to group. The `ProviderScanner`
(`groupChutesModels`) therefore emits one offering per model, `teeVariant` from
`confidential_compute`.

## Reasoning control

Reasoning is a **symmetric `chat_template_kwargs` toggle** — the same key both ways:

- **On:** `chat_template_kwargs: { enable_thinking: true }`.
- **Off:** `chat_template_kwargs: { enable_thinking: false }`.

This is the correct switch for **every** chutes model (GLM, DeepSeek, Kimi, Gemma),
re-probed live 2026-05-31. It is **NOT** `reasoning_effort`:

- `reasoning_effort: 'none'` 400s **Kimi-K2.6-TEE** (especially with an image), so
  it is never used to disable.
- `reasoning_effort: low/high` is **not the on-switch** and does **not** modulate
  the trace (low/medium/high are flat). GLM and Kimi happen to reason by default
  and surface `reasoning_content` regardless, which masked the bug; but
  **DeepSeek V3.2 and Gemma-4-31B-turbo emit zero `reasoning_content` AND zero
  `reasoning_tokens` under `reasoning_effort` alone** — they reason in bare
  `content` prose. Setting `enable_thinking: true` makes all four stream the
  channel. Because effort does not modulate, reasoning is modelled as a `toggle`,
  not `steps`; the adapter still forwards an `effort` hint when one is supplied,
  for any future model that honours it.

Reasoning text surfaces on **`reasoning_content`** (not `reasoning`) for every
curated chutes model once `enable_thinking: true` is set. The earlier per-model
"DeepSeek/Gemma have no visible channel" finding (2026-05-30) was an artefact of
the wrong on-switch and is **superseded** — see
[[../insights/2026-05-31-chutes-reasoning-on-switch]].

## `usage` quirk

Request `stream_options: { include_usage: true }`. Usage is then delivered on a
**final event with `choices: []`**, shaped
`{ prompt_tokens, completion_tokens, total_tokens, reasoning_tokens, prompt_tokens_details }`.
**`reasoning_tokens` is top-level inside `usage`** — *not* nested under
`completion_tokens_details` as OpenAI does. The `chutes-openai` adapter
normalises accordingly (`reasoningTokens` ← top-level, `cachedTokens` ←
`prompt_tokens_details.cached_tokens`).

## Drift safety (from chatsune)

Chutes exposes `supported_sampling_parameters` per model. chatsune filters the
request body against that whitelist before sending so engine/quant drift drops
fields silently rather than returning HTTP 400. Our adapter sends a minimal body
(model, messages, stream, stream_options, reasoning_effort, tools, temperature —
temperature is whitelisted on all curated models), so no filter is needed
today; adopt the whitelist technique if a future model rejects a field.

## Why chutes (the relationship)

Chutes is an NGO-relationship partner: chatsune already carries chutes with the
🔒 Privacy badge, and there is direct contact with their lead. Goals: chatsundere
recommended by chutes, and member conditions for the association later. Chutes is
community-driven (they pick models on community feedback), which fits the
freedom-oriented stance.

## Curated offerings

The five curated TEE models — see the model records:
[[../models/deepseek-v3.2]], [[../models/kimi-k2.6]], [[../models/glm-5]],
[[../models/glm-5.1]], [[../models/gemma-4-31b-turbo]].

Spec: [[../../superpowers/specs/2026-05-30-chutes-curation-and-live-suite-design]].
