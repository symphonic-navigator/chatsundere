# ADR 0032: Premium censored models via anonymising routers, with a CENSORED badge

## Status

Accepted (2026-06-01, brainstorm + live verification with Chris).

## Context

Claude (Anthropic) and ChatGPT (OpenAI) are the most-requested and highest-
quality models in the wider market. They are also the first models we integrate
that are **censored at source** — their makers align and refuse content as a
matter of policy. This sits in tension with our [Provider Integration Policy],
which governs the providers we interact with and our freedom-oriented identity
(every model so far is `freedomOriented: true`).

Two facts resolve the tension:

1. We never interact with Anthropic or OpenAI **directly**. We route through an
   anonymising intermediary — an "LLM VPN". The provider we integrate with is the
   router, not the censoring vendor.
2. The censorship is real and we refuse to hide it. A loud signal is more honest
   than silent omission.

We also learned, empirically (2026-06-01), that the *choice of router matters*:

- **OpenRouter is the wrong route for Anthropic/OpenAI.** The community uses
  OpenRouter with privacy-"limited keys", whose data policy excludes the
  Anthropic-direct endpoint; requests then route to Amazon Bedrock, which does
  **not** honour Anthropic `cache_control`. Live-probed: Opus 4.8 on OpenRouter
  routed to Bedrock, cached nothing, and 400'd a multi-turn tool exchange.
- **nano-gpt is the right route.** All seven Claude models pass the full
  conversation-suite (22/22 each) and the prompt cache engages — the stable
  prefix is read back on the next turn (`cached ≈ full prefix`, e.g. Opus 4.8
  turn-2 `cached=11591`). Reasoning is a slug swap (`:thinking`/`-thinking`),
  empirically a clean on/off **toggle** (effort does not modulate the trace —
  consistent with the GLM/Kimi finding).

## Decision

1. **Integrate Claude and ChatGPT via anonymising routers only — never the
   vendor's direct API.** Claude is delivered via **nano-gpt** (not OpenRouter,
   for the limited-keys/Bedrock reason above). ChatGPT (Phase B) likewise via
   nano-gpt.
2. **Mark these models `canonical.freedomOriented = false`.** The router
   deployment stays `freedomOrientedDeployment = true` (nano-gpt routes verbatim,
   adds no censorship). `effectiveFreedom(false, true) = 'restricted'`.
3. **Surface `'restricted'` as a loud CENSORED badge** in the model picker. No
   new data field — the badge is derived from the existing freedom model, so it
   can never be forgotten and reads honestly as "censorship lives somewhere in
   the stack".
4. **Prompt caching is opt-in for Claude** and is our responsibility: a dedicated
   adapter injects Anthropic `cache_control` breakpoints (stable prefix +
   token-anchored history anchor + rolling tail; see the cache-breakpoint module
   and the design spec). nano-gpt passes `cache_control` through to Anthropic.
5. **Reasoning is a toggle** for Claude (slug swap), per the live measurement.

## Consequences

- The Provider Integration Policy is not violated: we interact with nano-gpt
  (a curated, freedom-oriented router), not with Anthropic/OpenAI directly.
- Users get the quality with an honest signal. The zero-knowledge backend
  guarantee is untouched — the server still never sees plaintext.
- We accept a routing dependency: caching reliability depends on the router
  reaching a cache-capable Anthropic endpoint. nano-gpt does; OpenRouter under
  limited keys does not, which is why OpenRouter is excluded for these vendors.
- Extended-thinking **signature replay** for the tool-use loop is **deferred**
  (build-when-needed): there is no live tool-loop consumer yet, and plain
  multi-turn chat does not require it. Tracked in [[../insights/follow-ups-index]];
  rationale in the design spec §5.2.
- The same machinery (cache module, CENSORED derivation, reasoning toggle) is
  reused for ChatGPT in Phase B.

[Provider Integration Policy]: ../insights/2026-06-01-curation-batch-plan.md
