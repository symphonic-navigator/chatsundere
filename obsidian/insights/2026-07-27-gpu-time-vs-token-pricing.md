# GPU-time pricing vs token pricing — what it means for curation and UX

**2026-07-27.** Written after curating [[../models/kimi-k3]] on
[[../providers/ollama-cloud]], where the billing model became visible for the
first time. Not a decision (no ADR) — background for the next provider
onboarding and for the usage-display slice.

## The observation

Ollama bills Kimi K3 as *extra usage* and meters **GPU time**, not tokens.
Measured the same day: roughly 100 short probe calls moved the balance by
nothing measurable, while a handful of long-context story evals cost a few
cents. The cost driver is **context length**, not request count.

Chris's read, and it is the right one: this is the fairer unit. A 200k-token
prompt answered with *"yes, that works"* occupies the machine for a long time and
would cost almost nothing under token pricing. The provider carries that.

## Why "GPU time is deterministic" is only half true

The tempting claim is that a forward pass is exactly predictable — known FLOPs,
known bandwidth, known hardware — so a second-price can be derived from first
principles. The arithmetic is predictable; the **billed** time is not
reproducible, for four reasons that all bite in production:

1. **MoE routing is input-dependent.** K3 is a mixture-of-experts model, so which
   experts fire depends on the token. Under expert parallelism the most heavily
   loaded shard sets the step latency, so identical token counts cost different
   GPU time depending on routing. Not a rounding effect at this scale.
2. **Continuous batching.** A request never runs alone; it shares a batch with
   strangers. "GPU seconds for this request" is therefore an *attribution
   decision*, not a measurement.
3. **Prefill and decode are different regimes.** Prefill is compute-bound and
   parallel, decode is bandwidth-bound and serial — and attention cost grows with
   the KV cache as decoding proceeds, so cost per token is not even constant
   within one answer.
4. **Prefix caching breaks it empirically.** The same request, sent twice, costs
   measurably less the second time. Determinism fails on identical input, which
   is the case a customer would notice first.

## Why token pricing won — and it is not (only) legibility

The usual explanation is that buyers understand tokens and do not understand GPU
seconds. True, but secondary. The stronger reason is **risk transfer**: a token
price gives the buyer a reproducible, quotable number that can go into a budget
and still be correct next quarter. All the variance — routing, batch
neighbourhood, cache hits, hardware generation — stays with the provider.

A manager negotiating a contract is not buying comprehensibility. They are
buying **predictability**, and GPU-time pricing structurally cannot offer it.

The corollary is that the two models **select different customers**:

- **Token pricing** sells to buyers who need calculability and will pay a premium
  for the provider to absorb the variance.
- **GPU-time pricing** sells to buyers who want to pay the real cost and can
  carry the variance themselves — technically literate users, and providers who
  see themselves as infrastructure rather than as a product surface. Ollama and
  Chutes sit exactly there.

That is a reason to keep curating both kinds rather than a reason to prefer one.

## What follows for us

- **Cost communication is per-provider, not global.** On a GPU-time provider the
  honest sentence is "a long chat costs more than many short ones", which is the
  opposite of the intuition a token-priced provider trains. A user will not guess
  this.
- **The Context-Gauge and compaction are economic features here**, not merely
  hygiene. Worth saying out loud to users on such routes.
- **The usage-display slice needs a "reports nothing" state.** Kimi K3 on ollama
  surfaces no token counts at all (see [[../models/kimi-k3]]), so on precisely the
  route where context length drives cost, the user has no indirect signal either.
  A zero would be a lie; the absence must render as an absence. Tracked in
  [[follow-ups-index]].
- **Probe cost predicts nothing about usage cost.** A curation run is all short
  turns and will look free even when metering is live. Do not report "this model
  seems not to be metered" from a probe sweep — that claim was made and corrected
  within the same session.
