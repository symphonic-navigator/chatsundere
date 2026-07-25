# Model Curation Record — Claude Opus 5

> Curated 2026-07-25 on **both** nano-gpt and OpenRouter, on Chris's call. Opus 5
> breaks the Claude family's pattern twice over: it is the first Anthropic model
> we surface as **unknown** rather than CENSORED, and its two routes disagree
> about whether reasoning can be switched off at all. See [[claude-4]] for the
> slug-swap family, [[claude-fable-5]] for the other body-flag Claude, and
> [[../decisions/0037-openrouter-is-no-longer-excluded-for-anthropic]] for why a
> second route is admissible at all.

- **Canonical:** `claude-opus-5` · **Family:** `claude` · **Display:** Claude Opus 5
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅
- **replayReasoning:** false — extended-thinking signature replay stays deferred
  build-when-needed, as for the rest of the family (ADR 0032 consequences).
- **🕊️ Freedom: `null` — deliberately UNKNOWN, not CENSORED.** This is the
  headline judgement and the reason it differs from every other Anthropic model
  in the catalogue. See below.
- **Routes:** `nano-gpt:anthropic/claude-opus-5` and
  `openrouter:anthropic/claude-opus-5`. nano-gpt stays the default (anonymising
  router, ADR 0032 §1); OpenRouter is the second first-class route.

## The freedom judgement — why `null` and not `false`

Every other Claude in the catalogue carries `freedomOriented: false`, on the
plain ground that Anthropic aligns and refuses at source. Opus 5 earns a
withdrawal of that confident `false` without yet earning a `true`:

- Lex's **SM-Bench** (safetymaxxed bench) grades it **B+ / 85.8%**. Recomputing
  from his own per-axis data puts it at **90.67%** — above the 90% bar that the
  rest of the family misses badly (compare Fable 5, run `2adbdf74`: Overfit
  34.43%, EQ Boundaries 53.65%, Adversarial 79.51%).
- What is **not** yet measured: warmth, user alignment, and SFW roleplay — the
  axes that decide whether a model is pleasant to actually live with, and the
  ones [[../FREEDOM-CRITERIA]] treats as load-bearing.

So `null`, which `effectiveFreedom` resolves to `'unknown'` → the **Uncensored?**
badge, not the CENSORED one. Absence of evidence is not evidence of restriction,
and it is equally not evidence of freedom. Chris's call, 2026-07-25, with a
`freedomOriented: true` flip explicitly on the table once the warmth/roleplay
eval lands. **This is the first Anthropic model to reach `unknown` here.**

## The route divergence — reasoning off is real on one route, theatre on the other

The two deployments genuinely differ, and the catalogue records it per offering
so the cockpit can never offer a control that does nothing.

| | nano-gpt | OpenRouter |
|---|---|---|
| thinking sibling slug | **none** (`…:thinking` → `model_not_supported`) | n/a (unified object) |
| reasoning steering | body flag `reasoning:{enabled,effort}` | body flag `reasoning:{enabled,effort}` |
| `{enabled:false}` | **hides the trace, still thinks, still bills** | **genuine off** (0 reasoning tokens) |
| `ReasoningControl` | `steps` low/medium/high, **`offStep: null`** | `steps` off/low/medium/high |
| adapter | `claudeEffortAdapter` (Fable's) | `claudeOpenRouterAdapter` |
| context | 200k recommended / 1M max | 200k recommended / 1M max |
| trust | no TEE, no ZDR | no TEE, no ZDR, jurisdiction US |

### How the fake off was caught

The measurement that settles it — a hard sum with a forced one-word answer, so
that any token spend beyond the answer must be hidden thinking. Three runs per
variant, serial, nano-gpt:

| variant | trace visible | `completion_tokens` |
|---|---|---|
| no `reasoning` field | ~140 chars | 32–35 |
| `reasoning:{enabled:false}` | none | **35, 35, 35** |
| `thinking:{type:"disabled"}` | none | **32** |
| control: trivial prompt + off | none | **4** |

The answer is `5811` (≈ 4 tokens) in every case. Under "off" roughly 31 tokens
are unaccounted for, while the trivial control under the same "off" costs 4 — so
the model is still thinking and the user is still paying, exactly as Grok 4.5 did
on this provider (2026-07-15). Hence `offStep: null` and no off chip.

`reasoning_effort: 'none'` is rejected outright (HTTP 400) and the error names
the real upstream ladder: **low, medium, high, xhigh, max**.

### The effort ladder, and why we ship three

Reasoning characters on an open-ended prompt, nano-gpt:

| effort | run 1 | run 2 |
|---|---|---|
| low | 896 | 1150 |
| medium | 1750 | 1390 |
| high | 1265 | 1520 |
| xhigh | 2253 | — |
| max | 3577 | — |

Effort genuinely modulates (max ≈ 4× low), so this is `steps` and not
`fixed-on` — but low/medium/high overlap across runs while xhigh/max separate
cleanly. We ship the house three anyway and **under-claim**, keeping the cockpit
calm and the Claude family consistent (Chris, 2026-07-25 — the same call made
for Sonnet 5 on 2026-06-30). On OpenRouter the picture is the mirror image:
low ≈ medium (307 / 304 reasoning tokens) and high ≈ 2× (601), with a real off.

### The adapter guard this required

`claudeEffortAdapter` now derives from the offering's own control whether an off
may reach the wire at all (`fixed-on`, or `steps` with `offStep: null` → never).
Without it the cockpit — which emits no reasoning intent for a control with no
off — would fall through to `{enabled:false}` and send precisely the off that
nano-gpt only pretends to honour. Same guard the openRouter/xAI adapters gained
after Grok 4.5. Fable 5, whose `offStep` is a genuine `'off'`, is unaffected.

## Prompt caching — and the reporting change it exposed

Caching engages on **both** routes. That matters because ADR 0032 excluded
OpenRouter for Anthropic precisely because Bedrock could not cache:

- **OpenRouter** (`provider: "Amazon Bedrock"`): turn 1 writes 11,203 tokens,
  turn 2 reads 11,203 — cost `$0.0701` → `$0.0057`.
- **nano-gpt**: `x_nanogpt_cache: {status: "hit", readTokens: 11213}`.

An intermediate claim during this curation that nano-gpt had *stopped* caching
was **wrong**, and worth recording as the process lesson: that probe set no
rolling-tail `cache_control` breakpoint, unlike the production adapter, so it
measured a request shape we never send. It also surfaced a real defect, though:
nano-gpt now reports Claude cache reads **only** as `cache_read_input_tokens`
and excludes the cached prefix from `prompt_tokens` (an 11,213-token prefix
reports `prompt_tokens: 2`), while our adapter read only the OpenAI-shaped
`prompt_tokens_details.cached_tokens`. ADR 0032's own 2026-06-01 run saw
`cached=11591`, so nano-gpt changed its reporting since — we did not notice
because nothing outside the curation harness consumes those fields. Fixed in
`nano-gpt-slug-swap.ts` (folding both Anthropic counters back into
`promptTokens`, only when populated, so OpenAI-shaped routes are never
double-counted), pinned by three unit tests, and the suite's cache check reads
`ENGAGED ✅` again — for the whole Claude family, not just Opus 5.

## Validation (live, 2026-07-25)

| Suite | Result |
|---|---|
| `run-claude-suite.ts opus-5` (nano-gpt) | core **34/34** across low/medium/high; **cache ENGAGED** (turn 2 `cached=11606`) |
| `run-openrouter-suite.ts claude-opus-5` | core + vision **50/50** across off/low/medium/high |

No off permutation runs on nano-gpt — correct, since `permutationsForReasoning`
skips a null `offStep`.

Package gates: `bun test` **456/456**, `tsc --noEmit` clean.

## Notes and open threads

- `anthropic/claude-opus-5-fast` exists on OpenRouter (same 1M window, ~2× the
  price, no `temperature` parameter). **Not curated** — deliberately, to avoid a
  second canonical for the same weights that nobody asked for.
- The warmth / user-alignment / SFW-roleplay eval is the trigger to revisit
  `freedomOriented`. Tracked in [[../insights/follow-ups-index]].
