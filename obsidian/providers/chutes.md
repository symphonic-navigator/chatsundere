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

`reasoning_effort` body parameter with buckets (`low` / `medium` / `high`);
**off = omit the parameter** (no slug swap, no `enabled` flag). Reasoning text
surfaces on the response as **`reasoning_content`** (not `reasoning`).

Empirical note (DeepSeek V3.2, 2026-05-30): `reasoning_effort: "high"` is
accepted (HTTP 200), but a *trivial* prompt returned `reasoning_content: null`
and `reasoning_tokens: 0` — the model only thinks visibly on non-trivial work.
The conversation-suite (reasoning-on, a harder prompt) is the place to confirm
reasoning truly surfaces per model; record the finding in each model record.

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
temperature is whitelisted on all four curated models), so no filter is needed
today; adopt the whitelist technique if a future model rejects a field.

## Why chutes (the relationship)

Chutes is an NGO-relationship partner: chatsune already carries chutes with the
🔒 Privacy badge, and there is direct contact with their lead. Goals: chatsundere
recommended by chutes, and member conditions for the association later. Chutes is
community-driven (they pick models on community feedback), which fits the
freedom-oriented stance.

## Curated offerings

The four blockbuster TEE models — see the model records:
[[../models/deepseek-v3.2]], [[../models/kimi-k2.6]], [[../models/glm-5.1]],
[[../models/gemma-4-31b-turbo]].

Spec: [[../../superpowers/specs/2026-05-30-chutes-curation-and-live-suite-design]].
