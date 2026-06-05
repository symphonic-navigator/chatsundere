# Catalogue data model — a curator's view

The data model lives in `packages/llm-unified/src/catalogue/` and is unchanged by
this skill. You author entries against it and validate with `parseCatalogueEntry`.
The types below are the real exports in `src/catalogue/types.ts` and
`src/catalogue/index.ts` — match them exactly.

## Two levels: CanonicalModel groups Offerings

A catalogue entry (`CatalogueEntry` in `src/catalogue/schema.ts`) is one
`CanonicalModel` plus an array of `Offering`s.

**`CanonicalModel`** — the curated, provider-independent identity, the thing the
user picks (`src/catalogue/types.ts`):

- `id`, `displayName`
- `family` — loose grouping string (e.g. `glm`, `deepseek`). This is the **only**
  grouping axis. There is deliberately **no lineage axis** (GLM-5 / GLM-5.1 as
  one logical model) — YAGNI per the design's D6. The model must not *preclude* a
  later axis, but do **not** add one without an ADR in `obsidian/decisions/`.
- `requiredCaps: { tools, reasoning, vision }` — the T/R/V identity every
  offering must satisfy.
- `freedomOriented: boolean | null` — model-intrinsic freedom; `null` = not yet
  assessed. Optional `freedomNote`.

**`Offering`** — one upstream endpoint (provider × slug × variant). Each carries
its own measured behaviour and per-deployment judgement:

- `providerId`, `upstreamSlug`, `canonicalRef`
- `adapter: AdapterRef` — `{ kind: 'catalogue'; adapterId }` for a hand-written
  sibling adapter, or `{ kind: 'generic' }`.
- `profile: ModelProfile` — the measured behaviour (below).
- `context: { recommended, max }` — `recommended` is where the model stays smart
  (drives the Context-Gauge); `max` is the hard ceiling. They legitimately
  differ; record the WHY when they do.
- `trust: { tee, zdr, jurisdiction? }` — per-deployment trust posture.
- `freedomOrientedDeployment: boolean | null` — does this provider add censorship
  on top of the model? `null` = not assessed.
- `source: 'curated' | 'discovered'`, `confidence: 'verified' | 'partial' | 'heuristic'`.

## ModelProfile and the ReasoningControl union

`ModelProfile` (`src/catalogue/types.ts`) is the per-offering measured shape:

- `reasoning: ReasoningControl` — the user-facing steering union; drives the
  cockpit UI directly:
  - `{ mode: 'none' }` — always-off, shown disabled.
  - `{ mode: 'fixed-on' }` — always-on; **also** the "off only hides" case
    (reasoning cannot truly be disabled).
  - `{ mode: 'toggle'; defaultOn }` — on/off switch.
  - `{ mode: 'steps'; steps; offStep; defaultStep }` — discrete effort buckets;
    `offStep` is the step that means off (or `null` if there is none).
- `toolCalls: { supported, streaming, concurrentWithReasoning }`.
- `vision: boolean`.
- `replayReasoning: boolean` — hard-CoT models (Anthropic, xAI, OpenAI o-series)
  replay thinking blocks back into history; soft-CoT (DeepSeek, GLM, Kimi) never
  see their own thinking again — `false` for those.

## The capability gate

`parseCatalogueEntry(input)` (Valibot, `src/catalogue/schema.ts`) is the gate it
must pass before an entry is real. It first validates structure, then enforces
that **every offering delivers the canonical's `requiredCaps`**:

- `requiredCaps.tools` → each offering's `profile.toolCalls.supported` is true.
- `requiredCaps.vision` → each offering's `profile.vision` is true.
- `requiredCaps.reasoning` → no offering has `profile.reasoning.mode === 'none'`.

It returns `{ ok: true, entry }` or `{ ok: false, errors }`. Never write a
catalogue entry the gate rejects.

## Effective freedom

`effectiveFreedom(modelFreedom, deploymentFreedom)` (`src/catalogue/freedom.ts`)
is a three-state AND of `CanonicalModel.freedomOriented` and the offering's
`freedomOrientedDeployment`. If either side is `null` the result is `'unknown'`
(absence of evidence is not evidence of restriction); otherwise `'free'` only
when both are true, else `'restricted'`. This drives the 🕊️ Freedom badge.

## Where the artefacts live

- Model YAML: `packages/llm-unified/models/<id>.yaml` (one per model; that
  directory's `README.md` documents the convention).
- Adapter `.ts`: a sibling per offering, `models/<id>.<provider>.adapter.ts`,
  reviewable and editable in Rider.
