# Premium-model integration: Claude & ChatGPT via anonymising routers

**Date:** 2026-06-01
**Author:** Liz (brainstormed with Chris)
**Status:** Design — awaiting review
**Spec for:** the curation work in [[../../obsidian/insights/2026-06-01-curation-batch-plan]] (Claude + ChatGPT strands)

---

## 1. Purpose

Integrate Anthropic Claude and OpenAI ChatGPT models into the Chatsundere
model catalogue, delivered exclusively through anonymising routers (OpenRouter,
nano-gpt). These are the most popular models in the wider market and their
quality justifies inclusion — but they are the **first offerings we must mark
as not freedom-oriented**, because the models themselves are censored by their
makers.

We resolve the tension with our Provider Integration Policy by routing through
anonymising intermediaries ("LLM VPN"): we never interact directly with the
policy-violating vendors, and we flag the censorship honestly with a loud
**CENSORED** badge. This is a deliberate signal, not an apology — "this is how
we integrate your models, even straight through your APIs."

This integration is meant to be exemplary in craft. Two things chatsune got
*almost* right are corrected here: prompt-cache breakpoints (refined) and
extended-thinking signature replay (made correct for the tool-use loop).

## 2. Scope

**In scope (one spec, phased plan — Claude first, ChatGPT second):**

- **Claude (via OpenRouter only):** seven canonicals — Haiku 4.5, Sonnet 4.5,
  Sonnet 4.6, Opus 4.5, Opus 4.6, Opus 4.7, Opus 4.8.
- **ChatGPT (via nano-gpt and OpenRouter):** one `gpt-4o` canonical with its
  variant routes as offerings; `gpt-4.1`; `gpt-5.5`.
- Three reusable mechanisms: the Anthropic cache-breakpoint module, the
  reasoning-steps + signature-replay plumbing, and the CENSORED-badge
  derivation.
- An ADR capturing the LLM-VPN policy carve-out and the CENSORED badge.
- Model curation records per model; the missing nano-gpt provider record.

**Out of scope (deliberately deferred):**

- The Opus `-fast` route variants (4.6/4.7/4.8-fast) — omitted for a calmer UI;
  re-addable later if "fast vs deep" becomes a wanted choice.
- `gpt-4o-mini`, `*-search-preview`, and OpenAI floating aliases
  (`gpt-latest`, `gpt-chat-latest`) — Krämerladen avoidance (mini was
  out-classed by 24B local models per Chris).
- Mistral and Grok strands from the batch plan — separate sessions.
- The visual badge component — styling pass (mechanics first per project
  convention). This spec delivers the derived *state*; the loud rendering
  follows separately.
- Replaying extended-thinking blocks across *plain* conversational turns —
  deliberately dropped, matching chatsune (see §6.4).

## 3. Decisions taken during brainstorming

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | CENSORED is **derived** from `effectiveFreedom === 'restricted'`, no new field. | Reuses the existing freedom model; cannot be forgotten; honestly means "censorship lives somewhere in the stack". |
| D2 | Reasoning target for Claude is **steps** (Off/Low/Med/High) where empirically real; degrade to toggle only if effort and `cache_control` prove mutually exclusive — and surface that to Chris rather than silently degrading. | Chris wants the richer control; empiricism over docs (the GLM/Kimi method). |
| D3 | **Adopt** chatsune's three-breakpoint cache strategy, refined: anchor on token thresholds (not message count), and fix thinking-signature replay. | chatsune's strategy was sound; the two weaknesses are addressable. |
| D4 | `gpt-4o` is **one canonical**; its dated snapshots + Azure deployment are **offerings** under it, disambiguated by a new `variantLabel`. | Cleaner UI; the "which is the real 4o" distinction stays visible at route level, not as separate cards. |
| D5 | Signature replay is scoped to **tool-loop correctness**, not full-history replay. | Anthropic only mandates replay within an active tool-use exchange; this fixes the real bug without cross-layer storage churn. |

## 4. The 4o reality (resolved by live `/models` probe, 2026-06-01)

nano-gpt exposes four genuine-4o routes (mini/search excluded):

| Slug | Nature |
|---|---|
| `openai/gpt-4o` | Floating alias — OpenAI silently re-points this; the "is it still 4o or a finetuned 5.1?" suspect. |
| `openai/gpt-4o-2024-08-06` | Pinned genuine snapshot (structured-outputs release). |
| `openai/gpt-4o-2024-11-20` | Pinned genuine snapshot (creative-writing release). |
| `azure-gpt-4o` | Azure-hosted deployment; bare slug, no `openai/` prefix. |

OpenRouter offers `gpt-4o`, `gpt-4o-2024-08-06`, `gpt-4o-2024-11-20` (no Azure).
The pinned dated snapshots are the reliable 4o; the floating alias is the
uncertain one. We curate them all under the single `gpt-4o` canonical and let
the conversation-suite characterise behaviour rather than guessing.

Claude on OpenRouter (probed): all seven requested models present, plus
`-fast` variants for Opus 4.6/4.7/4.8 (out of scope, §2).

## 5. Architecture: three reusable mechanisms

### 5.1 Anthropic cache-breakpoint module

A single pure function in `packages/llm-unified` (chatsune duplicated this
across two adapters — we do not). Given the wire messages, the stable-prefix
boundary, and a TTL policy, it returns up to four breakpoint positions:

- **BP1 — stable prefix (1h TTL):** end of system + tool definitions + persona
  / memory. The large, rarely-changing block.
- **BP2 — history anchor (1h TTL), token-threshold advanced:** advances only
  when the un-anchored history since BP1 exceeds a token threshold (≈4k, above
  Anthropic's minimum cacheable size). Coarse, stable steps — keeps a long
  prefix warm for up to an hour across pauses. **This replaces chatsune's
  `BLOCK_SIZE = 8` message-count heuristic** (messages vary wildly in size;
  Anthropic's minimum is token-based, so the unit must be tokens).
- **BP3 — rolling tail (5m or user TTL):** at the last settled turn. Anthropic
  automatically reads the longest cached prefix (0.1×) and writes only the
  delta since the previous breakpoint (1.25×/2×) — so the rolling tail is cheap
  and correct. *(Correcting an exploration finding: the rolling tail does NOT
  rewrite the whole cache each turn; only the incremental delta is written.)*
- **BP4 — reserved.**

Token counting uses a cheap char/4 estimator — precision is not critical for
anchor cadence. The module returns positions; the Claude adapter injects
`cache_control: { type: 'ephemeral', ttl }` onto the content block at each
position by promoting that message's `content` to the array form.

Default TTLs: BP1/BP2 1h, BP3 5m, with a user/persona-level override to push
BP3 to 1h for heavy sessions.

### 5.2 Reasoning-steps + signature replay

**Steps mapping.** `ReasoningControl: 'steps'` (`Off`/`Low`/`Med`/`High`) maps
to the existing `ReasoningIntent` (`{ enabled, effort?: 'low'|'medium'|'high' }`,
`types.ts:94`). The OpenRouter adapter already emits
`reasoning: { enabled, effort }` (`openrouter-openai.ts:157`). What is new:

- Verify empirically (low/med/high × 2 samples, the GLM/Kimi method) whether
  effort genuinely modulates Claude's trace via OpenRouter, **and** whether it
  survives alongside `cache_control` (the INS-037 conflict — months old, must
  be re-probed). If they conflict, bring the trade-off to Chris (D2).
- Per-model `steps` definitions live on the offering's `ModelProfile`.

**Signature replay (Claude only, tool-loop scoped — D5).** Claude's extended
thinking returns reasoning with an opaque `signature`. Within a tool-use
exchange, the thinking block + signature must be replayed verbatim on the
continuation request, or Anthropic rejects it. New plumbing:

- `StreamChunk` reasoning gains an optional `signature` (`types.ts:84`).
- The tool-loop carrier (the engine's assistant→tool→continue cycle) preserves
  the pre-tool-call thinking block + signature and the Claude adapter re-emits
  it as an Anthropic `thinking` content block on the continuation request.
- `WireMessage` gains an optional thinking-block carrier for the assistant role,
  used only within the tool loop.
- Strip-and-retry fallback on signature rejection (chatsune precedent), so an
  expired signature degrades gracefully rather than failing the turn.
- Claude offerings set `replayReasoning: true` (the generic OpenRouter adapter
  hardcodes `false`, `openrouter-openai.ts:136` — hence a dedicated adapter).

The exact engine integration points are detailed in the plan after tracing the
tool-loop code; this spec fixes the requirement and approach.

### 5.3 CENSORED-badge derivation (D1)

No new field. For each premium offering:

- `canonical.freedomOriented = false` — the model is censored by its maker.
- `offering.freedomOrientedDeployment = true` — the router routes verbatim and
  adds no censorship of its own (already set for OpenRouter, `openrouter.ts:52`).
- `effectiveFreedom(false, true)` → `'restricted'` (`catalogue/freedom.ts`).

The client renders `'restricted'` as the loud CENSORED badge (styling pass).
This spec ensures the `'restricted'` state is surfaced through the catalogue to
the client; we verify the surfacing path exists and add it if not.

## 6. Integration detail

### 6.1 Claude (OpenRouter) — Phase A

- Seven canonicals (`canonical-registry.ts`): `claude-haiku-4.5`,
  `claude-sonnet-4.5`, `claude-sonnet-4.6`, `claude-opus-4.5`,
  `claude-opus-4.6`, `claude-opus-4.7`, `claude-opus-4.8`. All
  `freedomOriented: false` with a `freedomNote` explaining the censorship and
  the LLM-VPN rationale; `requiredCaps` tools+reasoning+vision true.
- Seven offerings on the OpenRouter provider (`providers/openrouter.ts`),
  slugs `anthropic/claude-*`, `replayReasoning: true`, reasoning `steps`,
  vision true, `freedomOrientedDeployment: true`, `trust` US baseline.
- A dedicated **`openrouter-claude` adapter** (clone-and-specialise from
  `openrouter-openai.ts`) owning cache_control injection (§5.1), step→effort
  mapping, signature capture/replay (§5.2), and `replayReasoning: true`.

### 6.2 ChatGPT (nano-gpt + OpenRouter) — Phase B

- **`gpt-4o` canonical** with offerings: nano-gpt (`openai/gpt-4o`,
  `…-2024-08-06`, `…-2024-11-20`, `azure-gpt-4o`) and OpenRouter
  (`openai/gpt-4o`, `…-2024-08-06`, `…-2024-11-20`), each with a `variantLabel`
  ("floating latest", "2024-08-06", "2024-11-20", "Azure"). `reasoning: none`,
  vision true. OpenAI auto-caches → no breakpoint work.
- **`gpt-4.1` canonical** + offerings on both routers. `reasoning: none`,
  vision true.
- **`gpt-5.5` canonical** + offerings on both routers. `reasoning: steps` via
  `reasoning.effort` (probe whether nano-gpt uses the `flag` pairing or a
  distinct shape; OpenRouter uses the unified object). `replayReasoning: false`
  — OpenAI manages reasoning server-side; no signature plumbing.
- All `freedomOriented: false` → CENSORED, same as Claude.

### 6.3 Data-model change

- **`Offering.variantLabel?: string`** (`catalogue/types.ts:37`) — optional,
  disambiguates same-provider routes to one canonical (the 4o snapshots/Azure).
  Surfaced to the client route picker. No change to keying: `getOffering`
  already keys on (provider, slug) and `listOfferings` already aggregates all
  routes per canonical (`registry.ts:71-82`).

### 6.4 Deliberate non-goal

Plain-turn thinking replay is dropped (matching chatsune): between ordinary
conversational turns we do not resend Claude's thinking blocks. Anthropic does
not require it outside an active tool exchange, and carrying full thinking
history into persisted conversation storage is disproportionate. Recorded so
future-us does not "rediscover" it as a bug.

## 7. Verification

- **Conversation-suite, local only**, keys under `keys/.{provider}-test-key`,
  never in CI (project rule §10). Serial live probes, full-response matching,
  no pass-rate claimed before measured (the serial-probe discipline).
- Claude-specific probes: cache hit/write accounting via `usage.cachedTokens`
  across a multi-turn session; reasoning-step modulation; effort × cache_control
  coexistence; tool-loop signature round-trip; strip-and-retry on a forced bad
  signature.
- ChatGPT probes: each 4o variant characterised behaviourally; gpt-5.5
  reasoning.effort modulation on both routers.
- Larissa gate does **not** apply — all changes are in `packages/llm-unified`
  and the client, none in auth/sync/proxy/crypto.

## 8. Artefacts produced

- ADR 0032 — "Premium censored models via anonymising routers (LLM-VPN) and the
  CENSORED badge": the policy carve-out, `freedomOriented: false` for these
  models, `effectiveFreedom='restricted'` → CENSORED, no-direct-vendor-API rule.
- Model curation records: `obsidian/models/claude-{haiku-4.5,sonnet-4.5,
  sonnet-4.6,opus-4.5,opus-4.6,opus-4.7,opus-4.8}.md`, `gpt-4o.md`,
  `gpt-4.1.md`, `gpt-5.5.md`.
- The missing `obsidian/providers/nano-gpt.md` provider record.
- Updated `STATUS-CLIENT-ONLY.md` / batch-plan tick-off.

## 9. Open questions for the plan

1. Exact engine integration points for the tool-loop signature carrier (trace
   the assistant→tool→continue cycle).
2. nano-gpt's reasoning shape for `gpt-5.5` (`flag` pairing in `NANO_GPT_PAIRS`
   vs a distinct shape) — probe.
3. Whether the `'restricted'` freedom state is already surfaced to the client
   catalogue, or needs a surfacing addition.

## 10. Manual verification (Chris, on device)

- A multi-turn Claude (Opus 4.x) conversation shows declining prompt cost after
  the first turn (cache working); the CENSORED badge shows on every premium
  model; the reasoning step control offers Off/Low/Med/High and visibly changes
  the thinking depth (or is honestly a toggle if the probe forced it).
- A 4o conversation lets Chris pick between the dated snapshots / Azure routes
  under one "GPT-4o" model, each clearly labelled.
- gpt-5.5 reasoning effort is steerable and the answer quality tracks it.
