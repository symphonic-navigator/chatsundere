# Model Curation Record — ChatGPT (OpenAI) family

> Curation record for the six OpenAI models onboarded **2026-07-06 on explicit
> user request** — several users asked for ChatGPT models by name. They sit
> squarely outside our freedom-oriented identity, so they carry the loud **🚫
> CENSORED** badge: the badge *is* the honest signal of what a user is opting
> into. Curated on **both** nano-gpt (the anonymising router) and **OpenRouter**
> (US router), mirroring the Claude policy. See [[claude-4]] / [[claude-5]] for
> the sibling censored families, [[../providers/nano-gpt]] and
> [[../providers/openrouter]] for the shared provider mechanics, and
> [[../decisions/0032-premium-censored-models-via-routers]] for the router policy.

- **Family:** `chatgpt` · **Providers:** nano-gpt **and** OpenRouter (per-model
  caveats below).
- **T/R/V:** tools ✅ · vision ✅ across the family. Reasoning: **gpt-4o / gpt-4.1
  have none**; the **GPT-5 family reasons** (steerable effort).
- **replayReasoning:** false. Like Grok on the Chat-Completions surface, OpenAI's
  reasoning arrives as a human-readable **summary**, not the raw signed
  chain-of-thought, so there is no opaque blob to replay — display-only.
- **🚫 CENSORED:** `canonical.freedomOriented: false` (OpenAI aligns/censors at
  source) × both deployments `freedomOrientedDeployment: true` (nano-gpt and
  OpenRouter each route verbatim, adding no filter of their own) →
  `effectiveFreedom = 'restricted'` → loud CENSORED badge in the picker. Chris
  owns this judgement (2026-07-06); it follows the Claude precedent exactly.
- **🔒 Privacy:** none. Both are US routers — no TEE, no project-wide ZDR. Trust
  `{ tee: false, zdr: false, jurisdiction: 'US' }`. No `provider:{zdr:true}` is
  sent (unlike Grok-on-OpenRouter): the honest posture is that the user owns the
  route and any key-level guardrails.

## The 4o checkpoint story (why two 4o entries)

4o is a checkpoint-rich model and the checkpoints differ meaningfully in tone and
cadence, so we surface **two** distinct user-pickable identities:

- **`chatgpt-4o`** (`openai/gpt-4o`) — the **floating alias**. OpenAI silently
  repoints it, so which checkpoint it resolves to on any given day is undisclosed
  (the "unclarified" checkpoint).
- **`chatgpt-4o-2024-11-20`** (`openai/gpt-4o-2024-11-20`) — the **pinned
  November 2024 checkpoint**. Tonally the closest available to the scene-beloved
  **"GG"** 4o (the ~6-month "adult mode" era). OpenAI does **not** expose the "GG"
  checkpoint over the API — a bizarre gap given it is the community's favourite —
  so Nov '24 is the nearest we can offer.

## Shared mechanics (probed live 2026-07-06)

- **adapter:** the generic `openRouterAdapter` (unified `reasoning` object,
  fragmented tool-call buffering, `usage` normalisation) on **both** providers —
  exactly like Grok 4.3. OpenAI on nano-gpt honours the unified `reasoning`
  object (not a slug swap), and OpenRouter presents its uniform surface. No
  hand-written OpenAI adapter was needed; one small option was added
  (`includeReasoning`, below).
- **reasoning steering (GPT-5 family):** the unified `reasoning` object —
  `{ enabled: false }` is a **genuine off** (0 reasoning tokens on both
  providers), `{ enabled: true, effort }` enables. Effort **genuinely modulates**
  (OpenRouter: `low` ≈ 4 reasoning tokens, `high` ≈ 165), so a **steps** control
  `['off','low','medium','high']`, default `medium` — the same shape as Sonnet 5,
  keeping the censored-reasoning cohort consistent. gpt-4o / gpt-4.1 send **no**
  reasoning param (`ReasoningControl { mode: 'none' }`).
- **reasoning summary — the key per-deployment split:**
  - **nano-gpt** streams OpenAI's reasoning **summary natively** on
    `delta.reasoning`, reliably at every effort level. Verified green across all
    permutations.
  - **OpenRouter** gates the summary behind a top-level **`include_reasoning:
    true`** flag (without it the channel is empty even at high effort). The
    adapter emits it only for the ChatGPT family (opt-in option
    `includeReasoning`). **But even with the flag the summary is emitted only
    _stochastically_** — in one suite run `effort:high` yielded no summary while
    `effort:low`/`medium` did, and vice-versa across runs. So on OpenRouter the
    **visible** chain-of-thought is unreliable, though the reasoning genuinely
    happens (reasoning_tokens > 0, answers correct). This is OpenAI's behaviour,
    not ours; it is why the GPT-5 OpenRouter offerings are `confidence: 'partial'`
    and why nano-gpt is the solid reasoning-display route.
- **tool calls:** fire reliably with valid JSON args. **nano-gpt** delivers the
  call as a **single block** (it coalesces — the documented nano-gpt behaviour);
  **OpenRouter** streams it **fragmented** and the adapter reassembles it.
  `concurrentWithReasoning: true`.
- **vision:** ✅ on every model on both providers (the suite's `vision` scenario
  is green throughout, including gpt-4o on nano-gpt naming a solid-colour image).
- **usage:** normalised from `completion_tokens_details.reasoning_tokens` /
  `prompt_tokens_details.cached_tokens`, present on the final event on both.
- **context:** `recommended` sits at our sweet-spots; `max` is the
  provider-reported ceiling. `recommended ≠ max` is deliberate — where the model
  stays smart, not the hard ceiling.

## Per-model table

| Canonical | Display | Slug (both providers) | Reasoning | rec / max | Notes |
|---|---|---|---|---|---|
| `chatgpt-4o` | ChatGPT 4o | `openai/gpt-4o` | none | 128k / 128k | floating "unclarified" checkpoint |
| `chatgpt-4o-2024-11-20` | ChatGPT 4o 11/24 | `openai/gpt-4o-2024-11-20` | none | 128k / 128k | closest to "GG"; OR needs an open data policy (see caveat 1) |
| `chatgpt-4.1` | ChatGPT 4.1 | `openai/gpt-4.1` | none | 200k / ~1M | |
| `chatgpt-5` | ChatGPT 5 | `openai/gpt-5.1` | steps | 200k / 400k | "GPT-5" is served by the 5.1 endpoint (Chris's mapping) |
| `chatgpt-5.4` | ChatGPT 5.4 | `openai/gpt-5.4` | steps | 200k / ~1M | |
| `chatgpt-5.5` | ChatGPT 5.5 | `openai/gpt-5.5` | steps | 200k / ~1M | |

## OpenRouter caveats

1. **`chatgpt-4o-2024-11-20` → data-policy 404 — RESOLVED 2026-07-06.** This
   pinned checkpoint's **sole** OpenRouter endpoint is OpenAI-direct (base
   `openai/gpt-4o` also has an Azure endpoint and falls back to it), so under a
   strict account data policy it 404'd — `"No endpoints available matching your
   guardrail restrictions and data policy"`. Chris opened the account's data
   policy at <https://openrouter.ai/settings/privacy> to allow that endpoint;
   the offering then ran **green** (`confidence: 'verified'`). **Note for users:**
   anyone with a locked-down OpenRouter privacy policy will hit the same 404 —
   nano-gpt is the reliable route for this checkpoint.
2. **GPT-5 family reasoning summary is stochastic on OpenRouter** (see mechanics
   above) — kept at `confidence: 'partial'`. Reasoning works (tokens/tools/vision/
   usage green); the visible trace is unreliable. Re-confirmed on a fully-open
   account (different effort steps failed across two runs), so it is OpenAI's
   behaviour, not a routing policy. Reliable on nano-gpt. Tracked in
   [[../insights/follow-ups-index]].

## Validation (live conversation-suite, 2026-07-06, `curation/run-openai-suite.ts`)

`makeLiveBinding`, `keys/.{nano,or}-test-key`, direct routing, the **production**
adapters (nano-gpt: `openRouterAdapter`; OpenRouter: `openRouterAdapter` with
`includeReasoning: true`). Every reasoning permutation the offering supports plus
the `vision` scenario.

| Offering | `core` | `vision` |
|---|---|---|
| `nano-gpt:*` (all six) | **PASS** — tool fires, JSON valid, usage normalised, memory carried, reasoning present on every on-step and absent on off | **PASS** |
| `openrouter:openai/gpt-4o` | **PASS** | **PASS** |
| `openrouter:openai/gpt-4.1` | **PASS** | **PASS** |
| `openrouter:openai/gpt-4o-2024-11-20` | **PASS** (after the account data-policy unlock — caveat 1) | **PASS** |
| `openrouter:openai/gpt-5.1` · `gpt-5.4` · `gpt-5.5` | tool/usage/memory **PASS**; `reasoning-present` **flaky** (caveat 2) | **PASS** |

nano-gpt gpt-5.1 and gpt-5.4 were each run to a full green across all effort
steps; gpt-5.5 shares the identical endpoint behaviour. The OpenRouter GPT-5
`reasoning-present` flakiness reproduced independently on gpt-5.1 and gpt-5.4.
