# Provider Curation Record — Mistral AI (mistral.ai)

> Curation record (not an ADR). The honesty surface for Mistral — what it is,
> how we talk to it, and *why* we trust it. See
> `.claude/skills/curate/references/conventions.md`.

**Onboarded:** 2026-05-31 (via `/curate` Mode 1, subagent) · **Status:**
live-curated, three first-party offerings (Small 4, Medium 3.5, Large 3). The
same three canonicals are *also* offered via the nano-gpt anonymous router —
see [[../models/mistral-small-4]], [[../models/mistral-medium-3-5]],
[[../models/mistral-large-3]].

- **id:** `mistral` · **displayName:** Mistral AI
- **Base URL:** `https://api.mistral.ai/v1` (OpenAI-compatible Chat Completions)
- **Auth:** Bearer token · key file `keys/.mistral-test-key` (local only, never in CI)
- **Docs:** <https://docs.mistral.ai/api/> · model list: <https://docs.mistral.ai/getting-started/models/models_overview/>
- **Probe:** `GET /models` (returns a large, noisy list — see Slug conventions)
- **CORS:** `direct` — the OPTIONS preflight to `/v1/chat/completions` returns
  **200** with `access-control-allow-origin: *` and
  `access-control-allow-headers: Authorization,Content-Type,...`,
  `access-control-allow-methods: ...,POST,...`, `max-age: 3600` (probed live
  2026-05-31). Direct browser calls work, so **no proxy is needed**.
- **sortPriority:** 14 — placed just after Tensorix (12, EU-sovereign ZDR). Final
  ranking is Liz's/Chris's call at integration; this is a sensible default for an
  EU-jurisdiction but **non-ZDR, non-TEE** first-party API.

## Base characteristics

- 🔒 **Privacy: NEITHER ZDR NOR TEE.** Mistral AI is a French (EU) company and
  GDPR-compliant, but its first-party API offers **no zero-data-retention
  guarantee and no trusted-execution-environment attestation**. The trust basis
  is EU justiciability plus Mistral's published privacy terms — *not* ZDR and
  *not* cryptographic attestation. Every first-party offering therefore carries
  `trust: { tee: false, zdr: false, jurisdiction: 'EU' }`.
- **Jurisdiction:** `'EU'` — French company, GDPR-compliant, data processed in
  the EU. Generic `'EU'` rather than `'FR'` to stay robust against in-EU shifts
  (mirrors the Tensorix convention).
- **freedomOrientedDeployment:** **null — pending Chris.** The freedom/trust
  judgement is the human's to make (conventions.md §Ownership split). Not
  invented here; both the first-party and nano-gpt deployments are left `null`
  until Chris assesses Mistral's AUP and censorship posture.

## Slug conventions

The first-party `GET /models` returns a **large, noisy list** (~28 entries) with
duplicate ids (e.g. `mistral-large-latest` and `mistral-medium-3-5` each appear
twice), dated snapshots (`mistral-large-2512`, `mistral-medium-2604`), internal
build slugs (`mistral-medium-c21211-r0-75`), and unrelated families (`voxtral-*`,
`devstral-*`, `magistral-*`, `mistral-saba`). We curate **three fixed slugs** and
never auto-discover, so **no `ProviderScanner` was written** — a scanner taming
this list would be vacuous for a three-model fixed curation (it would never feed
discovery). If Mistral curation later grows to many models, revisit.

The three curated upstream slugs:

| Canonical | Upstream slug | Note |
|---|---|---|
| `mistral-small-4` | `mistral-small-latest` | `-latest` alias |
| `mistral-medium-3-5` | `mistral-medium-3-5` | **literal slug, NOT `-latest`** |
| `mistral-large-3` | `mistral-large-latest` | `-latest` alias |

The **medium slug caveat** is load-bearing: there is no `mistral-medium-latest`
that resolves to 3.5, so the literal dated-family slug `mistral-medium-3-5` is
used. (`mistral-medium-3.5` with a dot also appears in `/models` and is the
nano-gpt form; the first-party API takes the hyphen form `mistral-medium-3-5`.)

## Reasoning mechanism (empirical, probed live 2026-05-31)

- **Binary toggle via `reasoning_effort`.** Only `"high"` (on) and `"none"`
  (off) are honoured, and **only by Small 4 and Medium 3.5**. Effort buckets
  (low/medium) are not meaningful — the adapter collapses any reasoning-on intent
  to `"high"`. The control is `{ mode: 'toggle', defaultOn: false }`.
- **`"none"` is a GENUINE off.** With `reasoning_effort: "none"`, content reverts
  to a plain string and **no thinking items appear at all** — verified silent on
  the conversation-suite reasoning-off permutation (`reasoning-absent` PASS for
  both Small 4 and Medium 3.5). This is a true toggle, **not** the "off only
  hides" / `fixed-on` case.
- **Large 3 has no reasoning** — it takes no `reasoning_effort` param and its
  content is always a plain string. Control `{ mode: 'none' }`.

### THE thinking-in-content quirk (the adapter's reason to exist)

Mistral does **not** use OpenAI's `reasoning_content` field. When reasoning is
active, `delta.content` becomes a **polymorphic typed-item array** instead of a
plain string:

```jsonc
// reasoning active:
"content": [{ "type": "thinking", "thinking": [{ "type": "text", "text": "Okay, the user" }], "closed": true }]
// the thinking→visible transition chunk carries BOTH:
"content": [{ "type": "thinking", "thinking": [] }, { "type": "text", "text": "3" }]
// reasoning off / Large 3 / final visible token:
"content": "91"
```

The `mistral-openai` adapter's `foldDeltaContent` splits visible-text vs
thinking-text from this shape (mirroring chatsune's `_translate_delta_content`):
a `thinking` item's nested `{type:'text', text}` array becomes a `reasoning`
chunk; a top-level `text` item (or a plain string) becomes a `token` chunk.
`reasoning_content` is read **only as a fallback** (in case a future Mistral
revision converges to OpenAI's schema), and never double-emits when the content
array already carried thinking. Tool calls arrive on `delta.tool_calls`, **never**
inline in content. There is a stray `"p"` field on most chunks (Mistral telemetry
padding) — ignored.

## `usage` reporting quirk

- `usage` arrives on the **SAME terminal chunk that carries `finish_reason`** —
  NOT a separate `choices: []` event (contrast Tensorix/wafer/nano-gpt, which
  send usage on a trailing empty-choices event). The adapter emits the `usage`
  chunk first, then processes the terminal choice.
- Shape: `prompt_tokens`, `completion_tokens`, `total_tokens`, and
  `prompt_tokens_details.cached_tokens`. **No reasoning-token breakdown** is
  reported (`completion_tokens_details.reasoning_tokens` is absent), so
  `NormalisedUsage.reasoningTokens` stays unset on the first-party path. Requested
  via `stream_options: { include_usage: true }`.

## Tool calls

- Delivered as a **single block** in one `delta.tool_calls` event (the whole
  `arguments` string at once), terminated by `finish_reason: "tool_calls"`
  (probed live). The adapter still buffers fragments by `index` for safety.
- Tool-call IDs are short (~9 alphanumeric chars, e.g. `cqGv3jtai`).
- Fired reliably for `generate_image` across all three models without an explicit
  tool-mention mitigation (suite `tool-call-fired` PASS everywhere).

## Message-ordering constraint (the one suite FAIL — NOT an adapter bug)

Mistral enforces **strict message-role ordering** and rejects a `system` message
that follows a `tool` message:

```
HTTP 400 — {"message":"Unexpected role 'system' after role 'tool'",
            "type":"invalid_request_message_order","code":"3230"}
```

The conversation-suite's `memory-echo` turn injects a `system` message as the
6th message (after the assistant tool-call turn and its `tool` result), which
trips this on all three **first-party** offerings — `no-http-error`,
`memory-echoed` and `usage-present` FAIL on that turn only. This is exactly the
protocol fault the suite is designed to surface (see the note in
`conversation-suite/scenarios/core.ts`): a strict provider rejecting a
mid-conversation system message. Everything else — reasoning on/off (the
polymorphic parser), reasoning-off silence, tool calls, vision, usage — **PASSES**.

**Mitigation is at the application layer, not the adapter:** Chatsundere should
inject memory/known-facts as a system message at the **front** of the history (or
merge it into the first user turn), never as a later message after tool results.
The same accumulated history works fine on Mistral when the system message is
first. Notably, the **nano-gpt** router tolerates the mid-conversation system
message, so the nano-gpt Mistral offerings pass the suite fully (22/22 and
11/11). Flagged for Chris/Liz: decide whether to harden the runtime's memory
injection or accept the first-party constraint.

## Context windows

All three curated models expose a **262 144-token** window (256k). We set
`recommended: 131 072` (half the ceiling) as the "stays smart" Context-Gauge
point, with `max: 262 144` the hard ceiling. `recommended ≠ max` here is a
**conservative default**, not a measured degradation point — no Mistral-specific
long-context quality data was gathered. Revisit if such data appears. (The
nano-gpt offerings use `recommended = max = 262 144`, matching the existing
nano-gpt slug-swap convention.)

## Curated offerings

First-party (`mistral`), each with the hand-written `mistral-openai` adapter
(`confidence: 'verified'`):
[[../models/mistral-small-4]] (toggle, vision),
[[../models/mistral-medium-3-5]] (toggle, vision),
[[../models/mistral-large-3]] (no reasoning, vision).

Also on nano-gpt (slug-swap reasoning via the existing `nano-gpt-slug-swap`
adapter) — see each model record.

## Documentation

- API docs: <https://docs.mistral.ai/api/>
- Models overview: <https://docs.mistral.ai/getting-started/models/models_overview/>
- Reasoning / `reasoning_effort`: <https://docs.mistral.ai/capabilities/reasoning/>
- Privacy: <https://mistral.ai/terms/#privacy-policy>
