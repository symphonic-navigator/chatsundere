# Model Curation Record — Claude Sonnet 5

> Curation record for `claude-sonnet-5`, the first Claude offering **not** on
> nano-gpt. It is curated on **OpenRouter** at Chris's call (2026-06-30): Sonnet 5
> went live on OpenRouter and the user owns the upstream route there, so we
> surface it with the loud **🚫 CENSORED** badge and add nothing else. See
> [[../providers/openrouter]] for the shared OpenRouter mechanics and
> [[../decisions/0032-premium-censored-models-via-routers]] for the policy that
> excludes Anthropic from nano-gpt-only delivery.

- **Family:** `claude` · **Provider:** OpenRouter only.
- **Canonical slug:** `anthropic/claude-sonnet-5` (dated `…-20260630`).
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅ (modality `text+image+file`).
- **replayReasoning:** false — extended-thinking signature replay is deferred
  build-when-needed (no live tool-loop consumer yet). `false` is the honest value
  while replay is unimplemented, consistent with every other OpenRouter offering.
- **🚫 CENSORED:** `canonical.freedomOriented: false` (Anthropic aligns/censors
  at source; `top_provider.is_moderated: true`) × OpenRouter
  `freedomOrientedDeployment: true` (the router adds no filter of its own) →
  `effectiveFreedom = 'restricted'` → loud CENSORED badge in the picker.
- **🔒 Privacy:** none. OpenRouter is a US router/aggregator — no TEE, no
  project-wide ZDR. Trust `{ tee: false, zdr: false, jurisdiction: 'US' }`. Unlike
  the Grok-on-OpenRouter offerings, **no `provider:{zdr:true}` is sent**: the
  honest posture is that the user owns the route and any key-level guardrails.

## Mechanics (probed live 2026-06-30, key routed to Google Vertex)

- **adapter:** `claudeOpenRouterAdapter` — wraps the generic `openRouterAdapter`
  (unified `reasoning` object, fragmented tool-call buffering, `usage`
  normalisation) and adds two Claude-specific steps: Anthropic `cache_control`
  injection and system-message hoisting (below). adapterId
  `openrouter:anthropic/claude-sonnet-5`.
- **reasoning control:** **steps** `['off', 'low', 'medium', 'high']`, default
  `medium`. Unlike every other OpenRouter offering (plain toggle), effort
  **genuinely modulates** Sonnet 5's trace — probed live: `low` ≈ 17 reasoning
  tokens, `high` ≈ 270 (a ~16× span). We mirror the Fable-family steps shape
  rather than exposing OpenRouter's full effort surface (`xhigh`/`max`) — keeping
  the cockpit calm and the Claude family consistent (Chris, 2026-06-30). `off` is
  a genuine off (`{ enabled: false }` → 0 reasoning tokens). Thinking streams on
  the `delta.reasoning` channel; reasoning runs concurrently with tool calls.
- **tool calls:** fire reliably and stream **fragmented** (id + name on the first
  SSE event, `arguments` across ~20 later events), reassembled by the inherited
  `openRouterAdapter` buffering. `concurrentWithReasoning: true`.
- **context:** recommended **200 000** (the Claude sweet-spot, matching the
  nano-gpt Claude offerings); max **1 000 000** (OpenRouter's reported ceiling).
  `recommended ≠ max` deliberately — recorded where the model stays smart, not
  the hard ceiling.

## Prompt caching — engages, read-back is route-dependent

The adapter injects Anthropic `cache_control` breakpoints (stable prefix +
token-anchored history anchor + rolling tail; see `_anthropic-cache.ts`). Probed
live 2026-06-30:

- `cache_control` is **accepted** (no HTTP 400) and **engages a cache write** —
  `cache_write_tokens` > 0 on the Vertex route.
- A cache **read-back was not observed** on an immediate identical repeat
  (`cached_tokens` stayed 0, a second write fired instead). The cause is the
  aggregator: OpenRouter load-balances across regional endpoints with no shared
  cache, so the saving lands only where routing is **sticky** — e.g. a user whose
  key routes to Anthropic-direct. The injection is harmless where unsupported, so
  it is always emitted; the benefit is opportunistic. This is the honest posture
  and the reason ADR 0032 kept the *guaranteed*-caching Claude family on nano-gpt.

## System-message hoisting — the OpenRouter strictness finding

OpenRouter **rejects** a `system` message that sits after an assistant turn for
Anthropic models: probed live 2026-06-30, a mid-conversation system message
returns **HTTP 400** — `messages.5: role 'system' must precede an 'assistant'
message or end the array`. This is Anthropic's role-ordering rule surfaced by
OpenRouter's input validation; nano-gpt hoists implicitly, and the other
OpenRouter targets (DeepSeek/GLM) tolerate the mid-conversation system, so Sonnet 5
is the first offering to hit it.

The production runtime never sends this shape (memory and instructions live in the
**leading** system message — verified: system-first echoes the injected fact
cleanly), but the conversation-suite's `memory-echo` turn injects one
deliberately. Rather than leave a red turn, `claudeOpenRouterAdapter` **merges
every `system` message into a single leading one** before caching — matching
nano-gpt's effective behaviour, honouring Anthropic's contract, and staying
defensive against any future caller (compact-and-continue, a context-injecting
tool) that produces a mid-conversation system message. It is a no-op for the
common shape (zero or one already-leading system message), so working turns stay
byte-identical.

## Validation (live conversation-suite, 2026-06-30)

Run serially via `curation/run-openrouter-suite.ts sonnet-5` (`makeLiveBinding`,
`keys/.or-test-key`, direct routing; the harness resolves the **registered**
caching-aware adapter via `getAdapter`, so it exercises the production path):

| Scenario | Result | Notes |
|---|---|---|
| `core` | **PASS** 55/55 | reasoning off + low/medium/high, tool call + valid JSON args, multi-turn memory carried (after the system hoist), usage normalised |
| `vision` | **PASS** 4/4 | image carried through; reply names the clothing colour |

Every permutation: no HTTP/stream error, tool fires with valid JSON args, usage
normalised (`totalTokens > 0`), reasoning present on `low/medium/high` and absent
on `off`, memory carried through.
