# Provider Curation Record — nano-gpt

> Provider record. Per-model offerings cross-link back here for the shared
> nano-gpt mechanics.

- **Provider id:** `nano-gpt` · **displayName:** nano-gpt
- **Base URL:** `https://nano-gpt.com/api/v1`
- **Shape:** `openai-chat-completions`
- **Key file:** `keys/.nano-test-key` (gitignored, never in CI)
- **CORS:** `inofficial` (browser calls work but are not a documented contract)
- **sortPriority:** 40 (router tier, alongside OpenRouter)

## What nano-gpt is

A broad-catalogue reseller/router exposing a uniform OpenAI-compatible surface
over many upstreams (open-weight families and — uniquely useful to us — the
censored premium vendors). Trust baseline: **no TEE, no ZDR** on the bare
deployments. **Censorship:** nano-gpt routes verbatim and adds no filter of its
own, so `freedomOrientedDeployment: true` (Chris, 2026-05-30) — the
freedom verdict is the *model's*, not the deployment's.

## Reasoning — model-slug swap

nano-gpt steers reasoning by **swapping the model slug**, not a body flag: a
base slug (reasoning off) and a sibling slug (reasoning on). The sibling suffix
is **inconsistent** — most families use `:thinking`, but some dated Claude slugs
use `-thinking`. The `nanoGptSlugSwapAdapter` takes an explicit `thinkingSlug`
to absorb this. Thinking streams on the `reasoning` delta channel;
`reasoning_tokens` is reported both top-level and under
`completion_tokens_details` (adapter prefers top-level).

## Claude (Anthropic) — the premium path (ADR 0032)

Claude is delivered **here, not via OpenRouter** — OpenRouter's limited-keys
convention routes Anthropic to Amazon Bedrock, which does not honour Anthropic
`cache_control`. nano-gpt does. Live-probed 2026-06-01 across all seven curated
Claude models:

- **Prompt caching works.** A `cache_control`-marked stable prefix is written and
  **read back on the next turn** (`cache_read ≈ full prefix`; e.g. Opus 4.8
  turn-2 `cached=11591`). The Claude adapter (`claudeAdapter`) wraps the slug-swap
  adapter and injects breakpoints.
- **Reasoning is a clean toggle.** Base slug = off (`reasoning-absent` green),
  `:thinking`/`-thinking` sibling = on (`reasoning-present`). Effort does not
  modulate the trace, so `toggle`, not `steps` (consistent with GLM/Kimi).
- **Correctness:** core conversation-suite 22/22 on every model (tool call +
  valid JSON args, multi-turn memory carried, usage normalised, cache engaged).
- Slug families are mixed: dated bare (`claude-haiku-4-5-20251001`,
  `claude-sonnet-4-5-20250929`, `claude-opus-4-5-20251101`) and `anthropic/`-
  prefixed (`anthropic/claude-{sonnet-4.6,opus-4.6,opus-4.7,opus-4.8}`). See
  [[../models/claude-4]].
- **Claude Fable 5 is the slug-swap exception** (probed 2026-06-10): NO thinking
  sibling exists — reasoning is a **body flag** `reasoning: { enabled, effort }`
  with **mandatory effort** when on (`{ enabled: true }` alone is a silent
  no-op). Steps control (off/low/medium/high), adaptive thinking,
  `reasoning_tokens` always 0 (rolled into `completion_tokens`). Cache passes
  through identically (turn-2 cached ≈ full prefix). The floating
  `anthropic/claude-fable-latest` alias is deliberately not curated. See
  [[../models/claude-fable-5]].

## ChatGPT (OpenAI) — Phase B finding (recorded ahead)

gpt-5.5 reasoning on nano-gpt uses the **OpenAI-native top-level
`reasoning_effort`** ∈ {`none`, `minimal`, `low`, `medium`, `high`} (NOT a
`:thinking` slug). Live-probed 2026-06-01: `none` is a genuine off (32 completion
tokens, correct answer); the levels modulate monotonically (none 32 → minimal
234 → low ~274 → medium 364 → high ~535 completion tokens). Two quirks:
(a) this is a **new switching mode** for `applyReasoningToBody` (top-level
`reasoning_effort` with `none` as off — it currently knows only
`slug`/`flag`/`none`); (b) reasoning is rolled into `completion_tokens` and
`reasoning_tokens` is `0`, so usage accounting must not rely on a separate count
for this route. 4o variants resolved: pinned dated snapshots are genuine 4o, the
floating `openai/gpt-4o` alias is the uncertain one; `azure-gpt-4o` is a bare
Azure slug.

## Grok (xAI upstream) — added 2026-06-28

Grok 4.3 (`x-ai/grok-4.3`) and Grok 4.5 (`x-ai/grok-4.5`) are offered on
nano-gpt, routing to the xAI upstream (no TEE/ZDR, US jurisdiction). The
reasoning quirk: nano-gpt steers Grok by the OpenAI-style **`reasoning`
object**, **not** the slug-swap mechanism the GLM/DeepSeek families use, and
**not** `reasoning_effort` (`reasoning_effort: none` does *not* disable it). So
both offerings reuse the unified reasoning-object adapter (`openRouterAdapter`,
no ZDR), not `nanoGptSlugSwapAdapter`. Tool calls arrive single-block. For 4.3
`{enabled:false}` is a genuine off (probed live). See [[../models/grok-4.3]].

> ⚠️ **nano-gpt fakes the reasoning-off on Grok 4.5 — found 2026-07-15.** Unlike
> 4.3, Grok 4.5 cannot be silenced upstream at all: xAI-direct rejects
> `reasoning_effort: 'none'` (HTTP 400) and OpenRouter answers "Reasoning is
> mandatory for this endpoint and cannot be disabled" (HTTP 400). nano-gpt
> neither errors nor obeys — it **accepts `{enabled:false}`, hides the trace and
> reports `reasoning_tokens: 0` while the model reasons anyway and the user is
> billed for it** (a one-token answer `7` cost 198 completion tokens). The 4.5
> offering is therefore `fixed-on`, and **nano-gpt's `reasoning_tokens` counter
> is not trustworthy on this route** — the reasoning cost appears folded into
> `completion_tokens` instead. This is a provider-behaviour caveat worth carrying
> forward when curating any future nano-gpt model: verify an "off" against
> `completion_tokens` and the visible answer length, never against the provider's
> own reasoning counter. Full write-up in [[../models/grok-4.5]].

**Grok 4.20 is NOT offered on nano-gpt.** nano-gpt serves only the
non-reasoning variant — the bare slug does not reason even with
`reasoning:{enabled:true}`, and no reasoning sibling slug exists (`:thinking`
and `-reasoning` both 404). Since the canonical requires reasoning, the offering
would fail the capability gate. Well-evidenced negative; see [[../models/grok-4.20]].

## Image generation (TTI)

Three TTI offerings ride the OpenAI-compatible `/images/generations` endpoint:
`z-image-turbo`, `seedream-v4.5` and `gpt-image-2` (see
[[../models/gpt-image-2]]). Shared mechanics: `response_format: 'url'` (the R2
bucket is CORS-open; result URLs are fetched with a bare, header-free GET —
a Bearer token collides with the AWS-V4 signature), no per-item moderation
(a refused prompt fails the whole POST with a 4xx), and **model-specific
parameters pass through** to the upstream — empirically confirmed for
`quality` on `gpt-image-2`, which even bills per tier. The authoritative
catalogue is `GET /api/v1/image-models?detailed=true` (auth optional), but its
`resolutions` lists are suggestions, not contracts — probe before trusting.

## Validation

Claude: `bun run curation/run-claude-suite.ts` (keys under `keys/`, never CI) —
all seven green + cache engaged (2026-06-01).
GPT Image 2: 18 live probes + end-to-end `generateImages()` run (2026-06-10),
see [[../models/gpt-image-2]].
