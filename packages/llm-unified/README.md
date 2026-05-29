# @chatsundere/llm-unified

The unified LLM layer for Chatsundere — and the **model adapter factory** behind
it. It does three things:

1. **Speaks to upstream LLMs** through a small set of hand-written provider
   connections and a canonical streaming interface.
2. **Synthesises per-model adapters automatically** — an analyzer model
   empirically probes a target model, then writes the adapter that mediates
   between Chatsundere's canonical API and that model's real wire behaviour.
   The adapter is accepted only after it reproduces the captured evidence.
3. **Models a curated catalogue** the user picks from — model-first, with each
   model's providers, trade-offs, and trust/freedom signals.

The novel idea: rather than hand-maintaining a brittle table of every model's
quirks (which drifts and never covers the long tail), Chatsundere lets a trusted
model **discover and encode another model's behaviour from real probes**, and
trusts the result because it is *validated against that evidence*, not because
the analyzer asserts it.

---

## Why

Every upstream provider exposes many models with idiosyncratic, undocumented
behaviour that metadata never captures: who streams tool calls vs returns them
in one block; what "reasoning off" really means (genuinely off, or merely
hidden — we treat hidden as always-on and refuse the charade); the four-plus
distinct `reasoning_effort` semantics; whether reasoning and tool calls can
coexist in one request; slug zoos like nano-gpt's `:thinking` / `-thinking` /
`TEE/`. Encoding all of that by hand was the old approach, and it was a
treadmill. This package replaces it with **empirical synthesis + a declarative
catalogue**.

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
(`effectiveFreedom`) is the three-state (`free` / `restricted` / `unknown`) AND
of model-intrinsic and deployment freedom.

`ModelProfile.reasoning` is a `ReasoningControl` union that drives the cockpit UI
directly: `none` (always-off) / `fixed-on` / `toggle` / `steps`.

**Freedom** is Chatsundere's anti-censorship signal. A model is *freedom-oriented*
when it does not patronise/hedge/fear the user, does not suppress legal (ordinary
EU-law) expressions of adult life, and handles fictional contexts — the yardstick
being anything legally purchasable in the adult section of an EU bookshop.
Political refusals are a tolerated exception. The full definition lives in the
Provider Integration Policy.

### 2. Synthesis engine (`src/synthesis/`)

The agentic loop, reusable wherever an adapter must be generated:

`probe → capture → generate → validate → self-repair → accept | fallback`

- **Probe** the target with deterministic synthetic prompts; **capture** the raw
  SSE responses as golden fixtures (empirical truth).
- **Generate**: the analyzer model receives the contract + the captured evidence
  and writes the adapter (pure `buildRequest` + `parseChunk` + profile).
- **Validate** *baseline-free* (`validateAgainstFixtures`): replay the candidate
  through the fixtures and require it to *reflect what the evidence contains*
  (reasoning → reasoning events; content → tokens; tool calls → a `tool-call`
  event with **valid-JSON** arguments — the reassembly-correctness check), plus a
  profile-gate (declared profile must match observed facts). This generalises to
  any target; a hand-ported DeepSeek baseline remains as a regression oracle for
  that model.
- **Self-repair** ≤ 3 rounds, then a conservative heuristic fallback.

Adapters are **pure transformations** (no I/O, no storage, no keys) so they can
later run in a sandboxed iframe with no exfiltration channel. Today they execute
in a Bun Worker (a functional isolation stand-in for tooling — **not** the
production security boundary; that iframe boundary and a security audit are
deferred before any generated code runs in the PWA).

### 3. Curation CLI — the factory (`src/curate/`)

A maintainer-only CLI (**not** shipped to clients) that turns the engine into a
declarative model-support factory. One YAML per model: human-curated identity +
offerings above, machine-generated `built:` block below. See
[`src/curate/README.md`](src/curate/README.md) for the full workflow. In short:

```
bun run curate model template nano-gpt:zai-org/glm-6 > models/glm-6.yaml
# fill in the judgement fields (freedom, trust, context)
bun run curate model build models/glm-6.yaml
# → per offering: probe target, GLM-5.1 writes the adapter, validate + self-repair;
#   writes the adapter .ts, the built: block (comments preserved), and
#   obsidian/models/glm-6.md (a deterministic, no-LLM report)
```

## Public API (highlights)

```ts
import {
  // catalogue
  type CanonicalModel, type Offering, type ModelProfile, type ReasoningControl,
  parseCatalogueEntry, effectiveFreedom,
  // providers + transport
  getProvider, listProviders, buildRequest,
  // streaming + completions
  streamCompletion, runOneShotCompletion, parseOpenAiSseStream,
  composeSystemPrompt, probeProvider,
} from '@chatsundere/llm-unified';
```

The `synthesis/` and `curate/` subtrees are internal (not exported from the
index) — the factory runs from the package scripts, not from client code.

## Scripts

```bash
bun test                                   # Bun test runner (rooted at ./src via bunfig.toml)
pnpm --filter @chatsundere/llm-unified typecheck
pnpm --filter @chatsundere/llm-unified build
bun run synthesise <provider> <model>      # the original synthesis spike CLI
bun run curate <command>                   # the model-support factory (see src/curate/README.md)
```

`synthesise` and `curate` need `NANO_GPT_API_KEY` (see `.env.example`).

## Status

Built and on `master`: the catalogue data model, the synthesis engine
(live-verified), and the curation CLI. Deferred (tracked in the client-only
STATUS and `src/curate/README.md`): the production iframe sandbox + security
audit, the client-side catalogue surfaces (model-first Catalogue + provider-first
"Your Endpoints"), catalogue signing/feed delivery, per-provider API keys, an
Ollama catch-all adapter, and `model verify` drift detection.

Design specs and plans live in `superpowers/specs/` and `superpowers/plans/`
(the `2026-05-29-*` set).

## Licence

LGPL-3.0-only — see `LICENSE` and the repository root `LICENSE-LGPLv3`.
