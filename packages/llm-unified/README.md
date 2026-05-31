# @chatsundere/llm-unified

The unified LLM layer for Chatsundere. It does three things:

1. **Speaks to upstream LLMs** through a small set of hand-written provider
   connections and a canonical streaming interface (`buildRequest` → transport →
   `streamCompletion` → normalised `StreamChunk`s).
2. **Models a curated catalogue** the user picks from — model-first, with each
   model's providers, trade-offs, and trust/freedom signals.
3. **Supports interactive curation** — onboarding providers and integrating
   models is now a hands-on workflow driven by the `/curate` skill, with a
   deterministic conversation-suite as the behavioural oracle.

The earlier machine-synthesis loop (a weak analyser model babysat by byte-level
fixture replay) has been **retired**: fixture replay could go green while a model
was functionally broken (the MiMo-V2.5-via-chutes `generate_image` HTTP 400
case). Real correctness needs end-to-end behavioural validation, so the adapter
author is now Claude, working interactively through the `/curate` skill and
proving each offering against the conversation-suite.

---

## Why

Every upstream provider exposes many models with idiosyncratic, undocumented
behaviour that metadata never captures: who streams tool calls vs returns them
in one block; what "reasoning off" really means (genuinely off, or merely
hidden — we treat hidden as always-on and refuse the charade); the four-plus
distinct `reasoning_effort` semantics; whether reasoning and tool calls can
coexist in one request; slug zoos like nano-gpt's `:thinking` / `-thinking` /
`TEE/`. Encoding all of that by hand is a treadmill, but machine-synthesising it
blind proved unreliable. The current approach pairs a **declarative catalogue**
with **interactive, behaviourally-validated curation**.

## The three pillars

### 1. Catalogue data model (`src/catalogue/`)

Two levels, so the user can pick a **model** and see **which providers** serve
it at what trade-offs:

- **`CanonicalModel`** — curated, provider-independent identity: `id`,
  `displayName`, `family`, the `requiredCaps` (tools / reasoning / vision) that
  *define* the identity, and `freedomOriented` (see below).
- **`Offering`** — one per upstream endpoint (`provider × slug × variant`),
  carrying its own measured `ModelProfile`, `AdapterRef`, `context`
  (`recommended` + `max`), `trust` (TEE / ZDR → 🔒 Privacy badge),
  `freedomOrientedDeployment`, `source` (`curated` | `discovered`) and
  `confidence`.

The **capability gate** (`parseCatalogueEntry`, Valibot-validated) requires every
offering to deliver the canonical's `requiredCaps` — a provider that drops vision
on a vision model yields no valid offering. **Effective freedom**
(`effectiveFreedom`, returning a `FreedomState`) is the three-state (`free` /
`restricted` / `unknown`) AND of model-intrinsic and deployment freedom.

`ModelProfile.reasoning` is a `ReasoningControl` union (`isReasoningControl`
guards it) that drives the cockpit UI directly: `none` (always-off) /
`fixed-on` / `toggle` / `steps`.

**Freedom** is Chatsundere's anti-censorship signal. A model is *freedom-oriented*
when it does not patronise/hedge/fear the user, does not suppress legal (ordinary
EU-law) expressions of adult life, and handles fictional contexts — the yardstick
being anything legally purchasable in the adult section of an EU bookshop.
Political refusals are a tolerated exception. The full definition lives in the
Provider Integration Policy.

### 2. Interactive curation via the `/curate` skill

Adapters and catalogue entries are produced by **Claude as the interactive
adapter author**, at maintain-time, never at the user's runtime. The workflow —
onboarding a provider, integrating a model, verifying & repairing a misbehaving
offering, or batch-checking a sub-selection — lives entirely in the skill at
[`.claude/skills/curate/SKILL.md`](../../.claude/skills/curate/SKILL.md). It uses
progressive discovery: the intent router there points to one playbook per task,
so the playbooks are not duplicated here.

The maintain-time helpers the curator leans on live in
`src/providers/curation/` — `provider-scanner.ts` (enumerate a provider's live
model list) and `model-file.ts` (read/write the per-model catalogue files under
`models/`).

### 3. Deterministic conversation-suite (`curation/conversation-suite/`)

The behavioural oracle that replaces byte-level fixture replay. It runs a model
through a scripted conversation — plain completion, a `generate_image` tool call
with a tool-result round-trip, and a mid-conversation memory echo — and applies
pure, deterministic assertions to each turn's outcome (`assertNoHttpError`,
`assertToolCallFired`, `assertToolArgsValidJson`, `assertUsagePresent`,
`assertReasoningPresent` / `assertReasoningAbsent`, `assertMemoryEchoed`,
`assertNoStreamError`).

The suite has two roles:

- Its own logic ships with **unit tests** — assertions, report assembly, and
  scenario shape — run via `bun run curate:suite`. These are pure and key-free.
- The same scenarios are driven **live against a provider** by the `/curate`
  skill during curation, binding `streamCompletion` + the offering's adapter +
  the provider's key.

**Live verification is local-only.** Provider keys live under `keys/` and never
enter CI; no test that hits a live provider runs in GitHub Actions.

## Public API (highlights)

```ts
import {
  // catalogue
  type CanonicalModel, type Offering, type ModelProfile, type ReasoningControl,
  type AdapterRef, type FreedomState,
  parseCatalogueEntry, effectiveFreedom, isReasoningControl,
  // providers + transport
  getProvider, listProviders, registerProvider, buildRequest,
  // streaming + completions
  streamCompletion, runOneShotCompletion, parseOpenAiSseStream,
  composeSystemPrompt, probeProvider,
  // wire types
  type StreamChunk, type NormalisedUsage, type WireMessage, type ReasoningIntent,
} from '@chatsundere/llm-unified';
```

`StreamChunk` is the normalised streaming union: `token` / `reasoning` /
`tool-call` / `usage` (carrying a `NormalisedUsage`) / `finish` / `error`.
Adapters extract `NormalisedUsage` from each provider's idiosyncratic `usage`
object inside their `parseChunk`. The `curation/` subtree and
`src/providers/curation/` helpers are maintain-time only and are not exported
from the package index.

## Retry & background jobs

Every background / non-interactive provider call goes through
`runOneShotCompletion` (or `withRetry` directly) — never a bare `fetch`. This
gives it transient-failure retry and the `onRetry` observability hook for free.
Interactive streaming uses `withStreamingRetry` (owned by `streamCompletion`).
The retry helpers are sink-agnostic: pass an `onRetry` callback and choose where
the signal lands (`console`, a metrics sink, …). The library itself never logs.

## Scripts

```bash
bun test                                   # Bun test runner (rooted at ./src via bunfig.toml)
bun run curate:suite                       # conversation-suite unit tests (pure, key-free)
pnpm --filter @chatsundere/llm-unified typecheck
pnpm --filter @chatsundere/llm-unified build
```

There is no longer a `synthesise` or `curate` package script — curation is the
`/curate` skill's job, and its live verification runs locally with keys from
`keys/`, never from a package script and never in CI.

## Status

Built: the catalogue data model, the deterministic
conversation-suite, and the `/curate` skill (with its provider-onboarding,
model-curation, verify-offering and batch-check playbooks). The machine
synthesis engine and the old curation CLI have been removed.

Design specs and plans live in `superpowers/specs/` and `superpowers/plans/`.

## Licence

LGPL-3.0-only — see `LICENSE` and the repository root `LICENSE-LGPLv3`.
