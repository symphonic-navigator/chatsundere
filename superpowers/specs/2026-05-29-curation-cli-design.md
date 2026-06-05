# Curation CLI (Maintainer Pipeline) — Design

- **Date:** 2026-05-29
- **Status:** Draft
- **Author:** Liz (Claude Code), brief-led with Chris
- **Depends on:** [model catalogue data model](2026-05-29-model-catalogue-data-model-design.md),
  [adapter-synthesis spike](2026-05-29-agentic-adapter-synthesis-design.md)
- **Package:** a maintainer-only CLI in the repo (e.g. `tools/curate/` or
  `packages/llm-unified` dev tooling), **not** shipped to clients.

---

## 1. Context & Motivation

The catalogue (CanonicalModels + per-provider Offerings + generated adapters) is
produced by **us**, not at the user's runtime — for latency, cost, and review
reasons established in the data-model brainstorm. This spec defines the
**maintainer tool** that produces it: a declarative, `kubectl`/`docker-compose`-
style CLI where each model is one YAML file ("alles beisammen"), the human owns
identity + marriage + judgement, and the synthesis engine owns the generated
adapter + measured profile.

The goal is a **model-support factory**: with a good template, docs, and
per-subcommand help, a curator adds many models in a day. The project is an NGO
effort with no delivery pressure (see memory) — careful, thorough tooling is the
right investment.

## 2. Scope

**In scope:**
- The CLI command surface (`provider`, `model` sub-commands).
- The model YAML schema (human-input section + generated section).
- `build` internals (per-offering probe → generate → validate → write), `--verify`.
- The deterministic **model report** (Markdown into Obsidian).
- The **per-provider curation/scanner layer** (hand-written, enumerates a
  provider's models and tames slug conventions) — distinct from the generated
  runtime adapter.
- Output layout of committed catalogue artefacts.

**Deferred (named):**
- **Signing / feed delivery.** `build` ends at committed artefacts; the catalogue
  ships bundled in the PWA. Signing + a pulled feed only become necessary for
  out-of-band updates or cross-operator catalogue sharing (untrusted transport of
  executable adapter code) — a later spec.
- **Ollama/Ollama-cloud catch-all adapter** (one hand-written transport adapter
  covering a whole consistent upstream for the uncurated/local path) — an
  exploration that fills the data model's `adapter: { kind: 'generic' }` slot;
  not core here.
- **Phase-2 luxury helpers** (Chris has ideas) — out of scope now.
- **Full migration** off the static `knownModels` — direction only; plan-level.

## 3. The Canonical Maintainer Workflow

The tool must make this flow smooth (it is the acceptance yardstick):

1. A new model appears upstream (e.g. GLM-6 on nano-gpt + novita).
2. `model template nano-gpt:zai-org/glm-6 novita:zai-org/glm-6 > models/glm-6.yaml`
   — both offerings (the marriage) pre-filled with mechanical fields (the file
   stem follows the proposed `canonicalId`).
3. The curator spends time evaluating how well the model honours the NGO
   guidelines (the freedom judgement — a human step the tool cannot automate).
4. The curator fills the judgement fields in the YAML (freedom, trust, context
   recommended/max).
5. `model build models/zai-glm6.yaml --verify` — per offering: probe → generate
   adapter → validate (incl. profile-gate) → write adapter + measured profile;
   `--verify` adds a live re-probe confirmation.
6. The tool emits a deterministic **model report** to `obsidian/models/…` and a
   terminal verdict summary. The curator reviews the generated adapter `.ts` in
   their editor.
7. Local test in the app.
8. `git commit` / `push`.
9. (Out of tool) announce.

## 4. Command Surface

```
curate provider list                         # configured providers (connections)
curate model list [provider]                 # upstream /models, annotated ✅ curated / ○ uncurated / ⚠ changed
curate model template <provider:slug>...      # emit a pre-filled YAML to stdout
curate model build <file.yaml> [--verify]     # synthesise + validate + write artefacts + report
curate model report <ref>                     # (re)render the deterministic Obsidian report
curate model verify <ref> | --all             # re-probe an existing offering → detect drift
```

- Offering **ref** convention: `<providerAlias>:<canonicalId>`, e.g.
  `nano:deepseek-v4-pro`. `canonicalId` comes from the YAML.
- Every sub-command has `--help`; a README documents the full flow. (Chris's
  three must-haves: docs, `template`, per-subcommand help.)

## 5. Model YAML Schema

One file per model. Human-input above, machine-output in a clearly marked
generated block. Example (illustrative values):

```yaml
# --- human-curated ---
canonical:
  id: glm-6
  displayName: GLM 6
  family: glm
  requiredCaps: { tools: true, reasoning: true, vision: false }
  freedomOriented: true          # curator judgement vs NGO guidelines
  freedomNote: ""

offerings:
  - provider: nano-gpt
    upstreamSlug: zai-org/glm-6
    trust: { tee: false, zdr: false }
    freedomOrientedDeployment: false      # routed via CN
    context: { recommended: 128000, max: 200000 }
  - provider: nano-gpt
    upstreamSlug: TEE/glm-6                # TEE variant = its own offering
    trust: { tee: true, zdr: true, jurisdiction: EU }
    freedomOrientedDeployment: true
    context: { recommended: 128000, max: 200000 }

# --- generated by `build` — do not edit by hand ---
built:
  - ref: nano:glm-6
    adapterFile: glm-6.nano-gpt.adapter.ts
    profile: { reasoning: { mode: steps, steps: [low, medium, high], offStep: null, defaultStep: medium },
               toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
               vision: false, replayReasoning: false }
    confidence: verified
    verifiedAt: <stamped by build>
```

`build` writes/refreshes the `built:` block and the sibling adapter `.ts`
file(s). Human edits above the line; the tool owns below it. The split keeps
"alles beisammen" without conflating ownership.

## 6. Per-Provider Curation/Scanner Layer

The tool needs hand-written per-provider knowledge to enumerate and interpret a
provider's catalogue. This is **distinct** from the generated runtime adapter:

```ts
interface ProviderScanner {
  /** Hit /models (or /tags) and group raw slugs into logical models + variants. */
  listOfferings(): Promise<DiscoveredOffering[]>;
  /** Which upstream slug(s) to probe for a given offering, incl. reasoning variants. */
  probeSlugsFor(offering: DiscoveredOffering): { reasoningOn: string; reasoningOff: string };
}

interface DiscoveredOffering {
  providerId: string;
  baseSlug: string;            // 'deepseek/deepseek-v4-pro'
  reasoningVariant?: string;   // ':thinking' | '-thinking' | flag-based
  teeVariant?: string;         // 'TEE/…' if the provider serves a TEE deployment
}
```

- **nano-gpt is the reference (and gnarly) impl:** it tames the slug zoo
  (`:thinking` vs `-thinking`, the `TEE/` prefix, slug-swap reasoning).
- Per "providers = code", each `ProviderScanner` is a small hand-written unit
  (brief→spec→plan→subagents), one per supported upstream — a handful.
- The scanner feeds `model list` and `model template` (prefill) and supplies the
  probe slugs to the synthesis engine. The slug-swap convention surfaces twice:
  the scanner uses it to enumerate/probe; the **generated** runtime adapter
  learns it from the probe evidence and encodes it in `buildRequest`.

## 7. `build` Internals

For each offering in the YAML:
1. Resolve probe slugs via the provider's `ProviderScanner`.
2. Run the existing synthesis loop (`packages/llm-unified/src/synthesis/`):
   probe → capture fixtures → GLM generates adapter → validate (event
   equivalence vs baseline **and** profile vs observed facts) → ≤N self-repair →
   accept (`verified`) or conservative fallback (`heuristic`).
3. Write the adapter to `<model>.<provider>.adapter.ts`; merge the measured
   profile into the YAML `built:` block with the verdict + `confidence`.
4. `--verify`: after build, a fresh live re-probe confirms the adapter still
   reproduces reality (the same check `model verify` runs).
5. Emit the model report (§8) and a terminal verdict summary.

Fixtures captured during build persist (golden evidence, as in the spike) so
`verify` and re-runs are cheap and diffable.

## 8. Model Report (deterministic, no LLM)

`build` (and `model report`) render a Markdown file to
`obsidian/models/<canonicalId>.md` from the **structured build output** — a
static template, **no LLM** (the data is already structured; rendering it is
deterministic, free, reproducible, and git-diffable).

Contents: what the model is (identity, family, T/R/V), each offering with its
trade-offs (provider, tool-call streaming, reasoning control, recommended/max
context), the 🔒 Privacy and 🕊️ Freedom badges with the freedom note, and the
build verdict/confidence per offering. This doubles as the project's **honesty
surface** — it can later feed the public docs and the release/Discord note.

## 9. Output Layout

```
packages/llm-unified/models/
  glm-6.yaml                         # source (human) + built block (tool)
  glm-6.nano-gpt.adapter.ts          # generated, editor-reviewable
  glm-6.novita.adapter.ts
  fixtures/glm-6.*.json              # captured golden evidence
obsidian/models/
  glm-6.md                           # deterministic report
```

The committed `models/` tree is the catalogue source of truth; the client
consumes a build of it (bundled into the PWA for now — see §2 deferred).

## 10. Relationship to Existing Code

- **Reuses** the synthesis engine (`synthesis/`) wholesale — `build` is its
  maintainer-side driver (relocating the loop from a hypothetical client runtime
  to our dev machine, exactly as decided).
- **Adds** the `ProviderScanner` per-provider layer (new code, one per upstream).
- **Supersedes** static `knownModels` / `_nano-gpt-pairs` / `_reasoning-body` as
  models migrate into YAML + generated adapters (migration is plan-level).
- `ProviderDefinition` (the connection) remains and is what a `ProviderScanner`
  is paired with.

## 11. Open Questions

- **Exact CLI home & name** (`tools/curate/` vs a workspace package; `curate` vs
  another name) — plan-level.
- **YAML `built:` vs sibling lockfile** — whether the measured profile lands in
  the same YAML (chosen here, for "alles beisammen") or a separate generated
  file; revisit if regen churn in git diffs becomes annoying.
- **Ollama catch-all** transport adapter — its own exploration (§2 deferred).
- **`model list` diff state** — how richly to compute "⚠ changed" (slug set
  changed? provider metadata changed?) — refine during implementation.

## 12. Manual Verification (Chris confirms the factory works)

1. **Full GLM-6 flow** (§3) end-to-end: template → edit judgement → build
   --verify → report appears in `obsidian/models/` → local app test.
2. **nano-gpt slug zoo:** `model template` correctly proposes the bare + thinking
   (`:thinking`) + TEE (`TEE/…-thinking`) offerings; `build` generates a working
   adapter for each.
3. **Profile-gate bite:** if GLM emits a profile contradicting the evidence
   (e.g. `always_on` where reasoning-off is honoured), `build` reports a failed
   round and self-repairs — never ships the wrong profile silently.
4. **Drift:** `model verify --all` re-probes and flags an offering whose upstream
   behaviour has changed since it was built.
5. **Report honesty:** the generated `obsidian/models/<id>.md` shows
   recommended≠max where relevant and the correct 🕊️ state (incl. the split-
   freedom MiMo-style case).
