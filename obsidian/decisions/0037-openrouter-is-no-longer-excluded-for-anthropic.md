# ADR 0037: OpenRouter is no longer excluded for Anthropic; nano-gpt stays the default

## Status

Accepted (2026-07-25, live re-probe during the Claude Opus 5 curation).

Amends [ADR 0032](0032-premium-censored-models-via-routers.md). ADR 0032 remains
in force in every other respect — the CENSORED badge derivation, the
anonymising-router principle, and the opt-in `cache_control` machinery are
unchanged.

## Context

ADR 0032 excluded OpenRouter as a route for Anthropic models on one empirical
ground, measured 2026-06-01:

> requests then route to Amazon Bedrock, which does **not** honour Anthropic
> `cache_control`. Live-probed: Opus 4.8 on OpenRouter routed to Bedrock, cached
> nothing, and 400'd a multi-turn tool exchange.

Both halves of that measurement have since stopped being true. Re-probed live on
2026-07-25 while curating Claude Opus 5 (`anthropic/claude-opus-5`):

- **Bedrock now caches.** Two turns over an identical ~11k-token stable prefix
  through OpenRouter, `provider: "Amazon Bedrock"` on both:
  turn 1 `cache_write_tokens: 11203`, turn 2 `cached_tokens: 11203` — with the
  turn's cost falling from `$0.0701` to `$0.0057`, roughly twelvefold.
- **The multi-turn tool exchange no longer 400s.** The full conversation-suite
  on `openrouter:anthropic/claude-opus-5` passes 50/50 across all four reasoning
  permutations, including the `generate_image` tool turn, the tool-result
  feed-back turn and the vision scenario.

Two further findings from the same session shape this decision:

- **nano-gpt caches too**, and did all along. An intermediate claim to the
  contrary during this curation was wrong: the probe that produced it set no
  rolling-tail breakpoint, unlike the production adapter. Measured correctly,
  nano-gpt reports `x_nanogpt_cache: {status: "hit", readTokens: 11213}`.
- **We had gone blind to it.** nano-gpt now reports Claude cache reads *only* as
  `cache_read_input_tokens`, and excludes the cached prefix from `prompt_tokens`
  (an 11,213-token cached prefix reports `prompt_tokens: 2`). Our adapter read
  only `prompt_tokens_details.cached_tokens`, which is 0 on that route. ADR 0032's
  own run saw `cached=11591`, so this is a change in nano-gpt's reporting since
  2026-06-01, not a long-standing blindness. Fixed in the same landing; the
  conversation-suite's cache check now reads `ENGAGED ✅` again.

So the *fact* the exclusion rested on is gone, while the *conclusion* it served
— route Anthropic through the anonymising router — still holds on its own,
independent merits (anonymity, ADR 0032 §1).

## Decision

1. **OpenRouter is no longer excluded as a route for Anthropic models.** The
   caching premise behind that exclusion is empirically obsolete.
2. **nano-gpt remains the default Anthropic route.** Not because of caching, but
   because it is the anonymising intermediary — the reason that survives.
   OpenRouter is a US router/aggregator with no default ZDR and no TEE; the
   user owns the upstream route there.
3. **A second OpenRouter route is admissible per model, not mandatory.** It is
   curated where it earns its place — today Claude Sonnet 5 and Claude Opus 5.
   Adding one for the rest of the family is a per-model call, not a sweep.
4. **Any future route exclusion argued on caching must be re-measured, not
   inherited.** Router-to-upstream behaviour changed twice in eight weeks.

## Consequences

- Claude Opus 5 ships on both routes, and they genuinely differ: OpenRouter has
  a real reasoning off, nano-gpt only hides the trace while still billing it
  (see [[../models/claude-opus-5]]). The catalogue records that per offering, so
  the cockpit cannot offer a switch that does nothing.
- The nano-gpt usage fix corrects `promptTokens` and `cachedTokens` for the whole
  Claude family on that route, not just for Opus 5 — eight existing offerings
  were reporting input token counts short by the cached prefix.
- ADR 0032's paragraph on OpenRouter/Bedrock is superseded by this ADR. Its
  decision points 1–5 otherwise stand.
- Standing lesson, added to the curation habit: **a router's upstream behaviour
  is a measurement with a shelf life.** Both the 2026-06-01 exclusion and the
  2026-07-25 "nano-gpt does not cache" scare came from treating one probe as a
  permanent property. The second one also came from a probe that did not mirror
  the production request shape — the same failure mode as the ollama background-
  jobs harness (2026-07-17): *a verification path that rebuilds its subject
  cannot fail the way its subject fails, and cannot succeed the way it succeeds
  either.*
