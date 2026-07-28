# Provider Curation Record — Wafer (wafer.ai)

**Onboarded:** 2026-05-31 (Liz, via `/curate` Mode 1) · **Status:** live-curated,
four offerings (three ZDR) · **Last trust re-probe:** 2026-07-28.

Wafer is a privacy-forward inference pass/router. Its headline feature is **ZDR
(zero data retention)** as a first-class, badge-worthy property — the trust
standout, analogous to the chutes TEE story. It is a strategic fit for the
freedom/privacy thesis.

## Base characteristics

- **Base URL:** `https://pass.wafer.ai/v1`, Bearer auth. OpenAI-compatible
  `/chat/completions` (wafer also exposes an Anthropic-compatible `/v1/messages`,
  which we do **not** use — we standardise on chat-completions, see the
  completions-not-responses rule).
- **Key:** `keys/.wafer-test-key` (local only, never in CI).
- **TEE:** none. Wafer's privacy guarantee is **ZDR, not** a trusted execution
  environment, so every offering carries `trust: { tee: false, zdr: … }`.
- **DSGVO / jurisdiction:** not yet established — `trust.jurisdiction` is left
  unset until confirmed. (Follow-up.)
- **Prompt caching:** supported — `/models` pricing carries
  `cache_read_cents_per_million`, and `usage` reports `prompt_tokens_details.cached_tokens`.

## ZDR — the model, and why

- `/models` returns a per-model boolean **`zdr_supported`**; this drives the
  🔒 badge directly (no error-probing needed).
- ZDR is **per-request opt-in** via the header **`Wafer-ZDR: required`**. A model
  with `zdr_supported: true` is only *capable* — the request is pinned to the
  ZDR-safe partition only when the header is actually sent. So the adapter
  **sends the header** for ZDR offerings; the badge is truthful because we both
  *can* and *do* request it.
- On a `zdr_supported: false` model the header is **rejected** — HTTP **422**,
  `code: model_zdr_not_supported` (probed live 2026-05-31). The adapter therefore
  sends `Wafer-ZDR: required` **only** for ZDR offerings.
- **Decision (Chris, 2026-05-31):** ZDR is modelled as a **trust badge, always
  on** (no per-chat toggle) — the omakase, privacy-by-default choice. Every
  ZDR-capable offering always sends the header.
- Kimi-K2.6's own `/models` description states it plainly: a *"ZDR-safe
  self-hosted NVFP4 deployment for `Wafer-ZDR: required` requests"* with the
  upstream Moonshot API for non-ZDR — single model id, single price, transparent
  partition. *(That self-hosted deployment was **decommissioned** before
  2026-07-28 — see below.)*

### A stale `zdr` flag here does not mislabel an offering, it kills it

**The load-bearing consequence of the design above, learnt on 2026-07-28.**
Because the adapter sends `Wafer-ZDR: required` **whenever `trust.zdr` is true**,
and wafer answers that header with HTTP **422** on a model that lacks ZDR, the
flag is not a badge — it is part of the request. A `true` that has gone stale
turns every single call through that offering into a 422. There is no degraded
mode, no fallback, and nothing in our own tests can see it: the catalogue is
internally consistent, the gate passes, the unit suite is green, and the offering
is simply dead in the field.

**wafer moves its ZDR partition without notice, in both directions.** Measured on
2026-07-28 against the `/models` listing *and* a live request per model:

| model | 2026-05-31 | 2026-07-28 | what it meant |
|---|---|---|---|
| DeepSeek-V4-Pro | `false` | **`true`** | gained ZDR — we were under-claiming (no 🔒 badge on a route that deserved one) |
| Kimi-K2.6 | `true` | **`false`** (`disabled_reason: self_hosted_backend_decommissioned`) | **every request 422 — dead** |
| Qwen3.5-397B-A17B | `true` | **`false`** (whole `wafer` capability object stripped) | **every request 422 — dead** |
| deepseek-v4-flash | listed | **absent** — direct request 404s | model withdrawn entirely |

Two of four curated offerings had been silently broken. **A ZDR verdict has a
shelf life on this provider**, exactly as the `fixed-on` reasoning classification
did on ollama (2026-07-26): the classification was correct when made and expired
without anyone touching the code.

**Standing practice:** re-probe `zdr_supported` for every wafer offering whenever
this provider is touched, and verify it on the wire (send the header and read the
status) rather than trusting the listing — the listing is what the header check
confirms, not a substitute for it. `/models` alone would not have revealed that
the 404'd `deepseek-v4-flash` was gone, only that it was unlisted.

## Slug conventions

Flat, human model ids — no slug-zoo. One offering per id; **no** reasoning-sibling
slugs and **no** TEE-prefix variants (contrast nano-gpt). The `wafer` metadata
object on each entry carries `display_name`, `tier`, `provider`, `context_length`,
`capabilities { vision, tools, reasoning }`, and `pricing`. The scanner
(`groupWaferModels`) is correspondingly trivial.

**Upstream catalogue as of 2026-07-28 (7):** **ZDR ✅** GLM-5.1, GLM-5.2,
DeepSeek-V4-Pro, glm5.2-fast · **ZDR ❌** Kimi-K2.6, MiniMax-M3,
Qwen3.5-397B-A17B. Note how little of this matches the 2026-05-31 listing
recorded previously (Qwen3.6-35B-A3B, qwen3.7-max and deepseek-v4-flash have all
disappeared; GLM-5.2, glm5.2-fast and MiniMax-M3 are new).

**Our curation (4):** GLM-5.1 (ZDR), DeepSeek-V4-Pro (ZDR since 2026-07-28),
GLM-5.2 (ZDR, added 2026-07-28), Kimi-K2.6 (ZDR lost, kept as a non-ZDR route).
Removed 2026-07-28: Qwen3.5-397B-A17B (lost ZDR, still on OpenRouter) and
deepseek-v4-flash (404s upstream). **Not curated, deliberately:** `glm5.2-fast`
and `MiniMax-M3` — neither was asked for, and we do not bulk-import catalogues.
`glm5.2-fast` is the more tempting of the two (ZDR, 1M) and is the obvious next
candidate should Chris want another ZDR route.

## Reasoning mechanism (empirical)

- Reasoning is steered by the **OpenAI-standard `reasoning_effort`** param:
  `'none'` disables (reasoning channel goes empty), `'low' | 'medium' | 'high'`
  enable. `chat_template_kwargs.enable_thinking:false` also disables, but
  `reasoning_effort` is the standard surface, so we use it. `reasoning:{enabled:false}`
  and a top-level `enable_thinking` do **not** work (probed).
- **Effort does not measurably modulate the trace** — GLM-5.1 (low=1102,
  med=808, high=943 reasoning tokens) and Kimi-K2.6 (low=1418, med=658,
  high=534) are non-monotonic. So reasoning is modelled as a **`toggle`**, not
  `steps` — the honest control, exactly as for chutes.
- **Empirical truth over docs (CLAUDE.md §13):** `/models` reports
  `Qwen3.5-397B-A17B` as `reasoning: false`, but the probe contradicts it —
  `reasoning_effort:medium` yields ~4.7k reasoning tokens, `none` yields zero. So
  Qwen3.5 *is* a reasoning model (toggle). Its canonical `requiredCaps.reasoning`
  is `true` on that basis.
- **Quirk:** omitting `reasoning_effort` entirely made Qwen3.5 **hang** (90 s
  timeout, zero bytes). The adapter therefore **always** sends an explicit
  `reasoning_effort` (a toggle-on with no effort hint defaults to `medium`), so
  this path never occurs in production.

## `usage` reporting quirk

OpenAI-standard shape (contrast chutes' top-level `reasoning_tokens`):
- `usage.completion_tokens_details.reasoning_tokens` — reasoning tokens.
- `usage.prompt_tokens_details.cached_tokens` — prompt-cache hits.
- Delivered on a final `choices: []` event when `stream_options.include_usage`
  is set.

## CORS

`pass.wafer.ai` answers an OPTIONS **preflight with 405** and emits **no
`Access-Control-*` headers** (probed 2026-05-31). Our authenticated POST carries
custom headers (`Authorization` + `Wafer-ZDR`), which forces a preflight wafer
does not honour → **direct browser calls are impossible**. The provider is
therefore `corsHint: 'requires-proxy'` (routed through the CORS proxy, like
ollama-cloud). The Bun-side live conversation-suite is unaffected (no CORS
enforcement server-side).

## Onboarding choices (the why)

- **Adapter-contract extension.** Sending a per-request header required a small,
  additive change to the shared transport: `WireRequest.headers?` →
  `transport.buildRequest({ extraHeaders })`, merged on top of the base headers,
  threaded through `stream-completion` via `buildWire`. General-purpose (reusable
  for any future provider needing header steering, e.g. OpenRouter attribution),
  not a wafer special-case. (Chris's call, 2026-05-31.)
- **Ranking.** `sortPriority: 15` — privacy-forward (ZDR), ranked just after
  chutes (TEE, the strategic NGO partner) and ahead of the non-privacy
  aggregators. Note: `rankOfferings` sorts TEE first, so chutes still
  out-ranks wafer on the pick path; ZDR is not (yet) a ranking axis.
- **Freedom.** `freedomOrientedDeployment: true` for all wafer offerings — wafer
  adds no censorship on top of the model (Chris, 2026-05-31).

## Documentation

- API errors: <https://docs.wafer.ai/errors>
- Per-model metadata: live `GET /v1/models`.
