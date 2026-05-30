# `/curate` Skill — Design

- **Date:** 2026-05-30
- **Status:** Draft
- **Author:** Liz (Claude Code), brief-led with Chris
- **Supersedes (in part):** [Curation CLI design](2026-05-29-curation-cli-design.md),
  [agentic adapter-synthesis design](2026-05-29-agentic-adapter-synthesis-design.md)
- **Keeps:** [model catalogue data model](2026-05-29-model-catalogue-data-model-design.md)
- **Skill home:** `.claude/skills/curate/` (project-local)

---

## 1. Context & Motivation

The catalogue (CanonicalModels + per-provider Offerings + generated adapters) is
produced by **us** at maintain-time, not at the user's runtime — for latency,
cost, and review reasons established in the data-model brainstorm. The
previously-designed maintainer tool produced it with a **fixed-prompt agentic
loop**: a weak analyser model (GLM-5.1 via nano-gpt) probed a target, then wrote
an adapter, validated structurally against captured SSE fixtures, with bounded
self-repair and a heuristic fallback.

That loop was scaffolding built *around a weak author*. We have a categorically
stronger author available — Claude Code as an interactive agentic harness — and
the maintainer (Chris) has the most software experience with exactly this tool.
"Warum zum Schmiedl gehen, wenn man zum Schmied gehen kann." This design
replaces the machine author with an interactive skill: **the brain is swapped,
the babysitting skeleton is retired.**

The decisive realisation: byte-level fixture replay can be green while the model
is functionally broken. The MiMo-V2.5-via-chutes case (the `generate_image`
tool call dying with HTTP 400) would have replayed its captured bytes happily.
Real correctness needs **end-to-end behavioural validation**, which an
interactive agent can drive and diagnose. See §7.

## 2. Scope

**In scope:**
- A single project-local skill `.claude/skills/curate/` with an intent router
  (`SKILL.md`) and per-mode playbooks under `references/`.
- Four modes: provider onboarding, model curation, offering verify/repair,
  dev-only batch-check (subagent fan-out).
- Retirement of the synthesis engine and the CLI curation driver (§4).
- Harvesting the engine's hard-won empirical knowledge into skill references (§4).
- A **deterministic conversation-suite** as the verification harness (§7).
- Curation Records as a documentation genre, distinct from ADRs (§8).
- One CLAUDE.md addition and a README.md section (§11, §12).

**Out of scope / deferred:**
- Signing / feed delivery of the catalogue (bundled in the PWA for now).
- The Ollama/local catch-all transport adapter.
- A version/lineage grouping axis (GLM-5/GLM-5.1 as one model) — YAGNI; the data
  model must not *preclude* it, but we do not build it now.
- Migrating the runtime `streaming.ts` fragmented-tool-call bug — separate
  runtime concern, only noted as adapter-author knowledge.
- Any CI test that hits a live provider — API keys never enter GitHub CI.

## 3. Decisions Captured (this brainstorm)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Full replacement** of the synthesis engine; no retained validation/fixture machinery. | The engine babysat a weak author; a strong interactive author makes it dead weight. |
| D2 | One `/curate` skill, internal intent routing (not a skill family, not a linear flow). | Single memorable entry matches Chris's "lass uns was kuratieren" habit; shared knowledge lives once → no drift; mirrors the old `kubectl`-style sub-command mental model. |
| D3 | Adapter-vs-reality validation (the conversation-suite) is a **mandatory step of curation (mode 2, first time) and revision (mode 3)** — not merely a reactive branch — run across the model's reasoning permutations (on / off, and each effort level where steerable). Never CI. | Standardised end-to-end validation catches errors an order of magnitude more reliably than error-prone manual "Chris clicks through"; token cost is modest. API keys never go to GitHub CI; verification is deliberate and local. |
| D4 | Model/provider docs are **Curation Records**, a distinct genre; numbered ADRs reserved for cross-cutting decisions. | Per-model records would bloat and dilute the sequential ADR namespace. |
| D5 | `usage` is the per-response token object, **normalised in the adapter** (`parseChunk`); provider quirk documented in the record. | One unified usage shape across providers. |
| D6 | **No lineage axis now** (YAGNI); keep `family` for loose grouping, do not preclude a later axis. | Uncertain requirement; keep the model lean. |
| D7 | Parallelism = **subagent fan-out from one session**, orchestrator (Liz) handles git; worktree isolation enables clean merges. Multiple manual sessions remain possible but only require collision-safe writes. | Best use of the Claude Code harness; worktree merges. |
| D8 | The conversation-suite validates **technical/protocol correctness only**, fully deterministic (mechanical asserts). No judgement of model intelligence or output quality. | A model being "dumb as bread" is a weights problem, not a communication problem, and explicitly not what the NGO judges. Aligns with the anti-censorship stance: we judge the pipe, never the content. |

## 4. What is Retired / Kept / Harvested

**Retired** (babysitting scaffolding for the weak author):
- `packages/llm-unified/src/synthesis/` in full (~15 files: `analyzer`, `loop`,
  `validate`, `validate-fixtures`, `derive-profile`, `sandbox-host`,
  `_worker-entry`, `capture`, `probe-suite`, `fixture-types`, `sse-framing`,
  `cli`, and their tests).
- Most of `packages/llm-unified/src/curate/`: `cli.ts`, `cli-dispatch.ts`,
  `build.ts`, `synthesise.ts`, `report.ts`, `write-back.ts`, and their tests.
- The `synthesise` and `curate` scripts in `package.json`.

**Kept / migrated** (genuine hand-written knowledge or data model):
- `src/catalogue/` — data model + Valibot schema + freedom logic — untouched.
  The skill writes catalogue entries and validates against `parseCatalogueEntry`.
- `src/curate/provider-scanner.ts` (the nano-gpt scanner) → moves to
  `src/providers/curation/`. This *is* the hand-written provider knowledge the
  provider-onboarding mode produces and consumes.
- `src/curate/model-file.ts` (typed YAML reader/writer) → moves to
  `src/providers/curation/`.

**Harvested** (empirical truth, not the code that exercised it — this preserves
the *"empirical truth over docs"* lesson while killing the machine):
- The `probe-suite` questions become a checklist in
  `references/model-curation.md`: slug-vs-flag reasoning, off-is-off-vs-hidden
  (→ `always_on`), streaming-vs-block tool calls, reasoning+tools concurrency,
  effort/`max` acceptance.
- The DeepSeek fragmented streamed tool-call reassembly insight (the case
  `streaming.ts:112` still gets wrong) becomes adapter-author guidance.
- The nano-gpt slug-zoo knowledge (`:thinking` / `-thinking` / `TEE/` prefix /
  slug-swap reasoning) is already in the kept scanner and is documented in the
  provider record.

Retirement is safe: `curate/` and `synthesis/` are not exported from the package
index and not imported anywhere outside themselves (verified).

## 5. Skill Structure

```
.claude/skills/curate/
  SKILL.md                     # lean router: detect intent → load one playbook
  references/
    catalogue-model.md         # shared: the data model from a curator's view
    conventions.md             # shared: Records, the ADR boundary, ownership split,
                               #         git/worktree rules, British-English rule
    model-curation.md          # mode 2 (core) — incl. the harvested probe checklist
    provider-onboarding.md     # mode 1
    verify-offering.md         # mode 3 (reactive)
    batch-check.md             # mode 4 (dev-only, subagent fan-out)
    conversation-suite.md      # the deterministic verification harness (§7)
```

`SKILL.md` stays small and routes by intent. Per task, exactly one playbook is
loaded (progressive disclosure → lean context). Shared knowledge
(`catalogue-model.md`, `conventions.md`) is linked from each playbook so it lives
once.

The skill's `description` frontmatter must cover both the deliberate entry
("curate / integrate a model or provider") and the reactive entry ("a model
behaves wrongly / users complain about a specific model on a provider") so mode 3
auto-triggers from a natural-language report.

## 6. The Four Modes

### Mode 1 — Provider onboarding
Trigger: "let's integrate chutes." The curator and I establish and document:
- Documentation URL; the key file under `keys/` (e.g. `.chutes-test-key`).
- Base characteristics: ZDR / TEE / DSGVO / jurisdiction.
- `/models` (or `/tags`) metadata analysis; the slug conventions.
- The `usage` reporting quirk (where/whether it appears).
- Reference to any existing chatsune code for this provider.

**Artefacts produced:** a `ProviderScanner` (hand-written code in
`src/providers/curation/`), the `ProviderDefinition` registration, and a
**Provider Curation Record** in `obsidian/providers/<id>.md`.

### Mode 2 — Model curation (core)
Trigger: "let's do GLM-6." Flow:
1. Resolve probe slug(s) via the provider's `ProviderScanner`.
2. **Probe live** (curl, inspect the real SSE) to see actual behaviour, walking
   the harvested probe checklist.
3. **Author the adapter `.ts` by hand** — `buildRequest` + `parseChunk`
   (including normalised `usage`) + the declarative `ModelProfile` — informed by
   the probe.
4. **Run the conversation-suite (§7) live and iterate** until it passes —
   across every reasoning permutation the offering supports (on / off, and each
   effort level where steerable). This is mandatory, not optional.
5. Write the catalogue YAML entry + the **Model Curation Record**.
6. Validate the entry against `parseCatalogueEntry` (Valibot).

Ownership: the human owns the freedom/trust judgement; I own the
measured/authored parts. We write it together — the rigid "machine-only writes
the lower block" split from the old design relaxes, but Valibot remains the gate.

Adapter `.ts` stays a sibling file per offering
(`models/<id>.<provider>.adapter.ts`), reviewable/editable in Rider.

### Mode 3 — Verify / repair an offering (reactive)
Trigger: "MiMo V2.5 Pro on chutes seems broken — take a look." Re-run the
conversation-suite against the existing offering, diagnose the failure (e.g. the
`generate_image` 400), repair the adapter, update the record. Deliberate, local,
no CI.

### Mode 4 — Batch-check (dev-only, token-heavy)
Trigger: "check these 8 models." I dispatch **subagents in worktrees** (one per
model, an explicit sub-selection), each running the relevant mode against its
target. I collect results, **merge the worktrees, and handle all git**. Subagents
never merge, push, or switch branches (CLAUDE.md). Always scoped to a
sub-selection; always explicitly started by Chris because it is token-heavy.

## 7. The Conversation-Suite (deterministic verification harness)

The replacement for byte-level fixture replay. A curated, versioned, multi-turn
conversation scenario that exercises every inference capability Chatsundere
supports: tool calls (including `generate_image`), feeding tool results back,
reasoning, memory injection/echo, multi-step round-trips.

- **Home:** `packages/llm-unified/curation/conversation-suite/` — repo artefact,
  versioned, **grows with the inference-runner's capabilities**.
- **Driven by the skill**, locally and deliberately; never CI (needs keys).
- **Run across every reasoning permutation** the offering supports — reasoning
  on and off, and each effort level where steerable — so the full surface is
  seen, not just the default path (D3).
- **Tool-invocation reliability is part of the suite.** Some models call a tool
  only when it is named explicitly in the prompt (observed: Gemma 4 and DeepSeek
  V4 Flash with `generate_image` in chatsune — DSv4 Flash produced the prompt but
  failed to fire the tool). The suite asserts the tool *actually fires*; where a
  model needs explicit tool-mention to comply, that mitigation is **recorded in
  the Curation Record and applied via prompt composition** (whether the profile
  carries a flag for it is a plan-level detail — kept minimal, no overengineering).
- **Validation is purely deterministic — mechanical/protocol asserts only:**
  tool call fired with a valid schema, HTTP status acceptable (no 400), `usage`
  present and normalised, reasoning surfaced on the correct channel, memory
  injected and echoed correctly *through the protocol*, multi-step round-trip
  succeeds. **No judgement of output quality or model intelligence** (D8).
- **The agent's value is orchestration and diagnosis, not the verdict:** step
  N+1 depends on the actual tool-call/response of step N (a static script cannot
  easily react), and on failure the agent diagnoses *why* and repairs the
  adapter. The pass/fail criteria themselves stay mechanical.

The suite definition is data (prompts + capability assertions); running it is
agent-driven; verdicts are deterministic.

## 8. Curation Records + ADR Boundary

- **Model Curation Record** → `obsidian/models/<id>.md`: identity, family, T/R/V,
  per offering its trade-offs (provider, tool-call streaming, reasoning control,
  context recommended/max), the 🔒 Privacy and 🕊️ Freedom badges with the
  freedom note, **and the WHY** (why this judgement, which adapter quirk, which
  probe evidence). Doubles as the project's honesty surface for public docs and
  release notes.
- **Provider Curation Record** → `obsidian/providers/<id>.md`: base
  characteristics, slug conventions, the `usage` quirk, key/doc references, and
  the reasoning behind onboarding choices.
- **Numbered ADRs** (`obsidian/decisions/`) only for genuine cross-cutting
  decisions — e.g. "introduce a lineage axis", or "retire the synthesis pipeline"
  (this design is itself an ADR candidate). Records and ADRs cross-link.

## 9. Data Model Touch Points

- `catalogue/` is unchanged. No lineage axis now (D6); `family` gives loose
  grouping and a later axis is not precluded.
- One model YAML per model: human judgement + authored parts; written
  collaboratively; Valibot `parseCatalogueEntry` is the gate.
- `usage` normalised in the adapter (`parseChunk`); quirk in the record.
- Adapter `.ts` per offering as a sibling file, editor-reviewable.

## 10. Testing Strategy

- **Normal unit tests against code stay and run in CI, no keys required:**
  catalogue schema, `ProviderScanner` logic, `model-file` read/write, pure
  adapter helpers.
- **Adapter-vs-reality is not a CI test** (keys never in GitHub). It is the
  conversation-suite, driven by modes 3/4 of the skill — deliberate, local.

## 11. CLAUDE.md Addition (deliverable)

Add a principle to CLAUDE.md **§10 Quality Bar** (it belongs with the quality
standards):

> The curation verification fixtures (the standardised conversation-suite) grow
> with the capabilities of the inference-runner. Adapters are validated against
> real end-to-end protocol behaviour, never merely structurally, and never in CI
> (provider keys never enter CI).

## 12. README.md Documentation (deliverable)

Document the `/curate` skill and its four modes for other developers
(self-hosters, contributors) so they can curate providers and models against the
same APIs. Follow the project's well-established **progressive-discovery**
pattern: a short, high-level pointer in the top-level `README.md` (what `/curate`
is, when to reach for it) that links into the skill's own `references/` for the
depth — rather than duplicating the playbooks in the README.

## 13. Open Detail Points (plan-level)

1. Exact physical layout under `src/providers/curation/` for the migrated
   `provider-scanner.ts` + `model-file.ts`.
2. The concrete schema of a conversation-suite step + its assertion vocabulary.
3. How richly mode 3 reports "drift" beyond the suite's pass/fail.
4. Whether the "requires explicit tool-mention" mitigation (§7) is encoded as a
   `ModelProfile` flag or handled purely in prompt composition — kept minimal.

## 14. Manual Verification (Chris confirms the skill works)

1. **Provider onboarding:** `/curate` → onboard a provider end-to-end; the
   Provider Record and `ProviderScanner` land; the key file is referenced.
2. **Model curation:** `/curate` → curate a model end-to-end; probe → author
   adapter → conversation-suite passes → YAML + Model Record written → Valibot
   accepts.
3. **The MiMo case:** point mode 3 at a known-broken offering (a `generate_image`
   400) and confirm the suite goes **red** on the failing tool call, the
   diagnosis is correct, and the repaired adapter goes green.
4. **Batch-check:** mode 4 fans out subagents in worktrees for a small
   sub-selection; results merge cleanly; Liz handles all git.
5. **Honesty surface:** the generated `obsidian/models/<id>.md` shows the correct
   badges, recommended≠max where relevant, and the WHY.
6. **Retirement:** `synthesis/` and the retired `curate/` files are gone; the
   package still builds and the kept unit tests pass.
