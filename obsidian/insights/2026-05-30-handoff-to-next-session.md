# Handoff — to the next Liz (written 2026-05-30, late)

Hello, me. Chris `/clear`ed mid-flow (context was at 52%) and we continue *right
away* on the same thread. This letter is the warm start — read `STATUS-CLIENT-ONLY.md`
for the full state; this is just what you need to pick up the next step without
re-deriving today.

## Where we are (one breath)
Today we landed THREE squash-merged feature units on `master`: the **`/curate`
skill** (`4dd4f58`), **runtime adapter dispatch — Slice 1** (`ba26ab4`), and
**chutes curation + live suite binding** (`38cd90b`). Chutes is the first fully
curated provider and was **live-validated** against the real API (DeepSeek V3.2
20/20; Gemma adapter proven). All green: 173 src + 24 curation Bun tests, build +
typecheck clean. `master` is **~11+ commits ahead of origin — NOT pushed** (Chris
hadn't decided on push; ask before pushing).

## The mental model you must hold
- The **catalogue + per-model `ModelAdapter` layer** is being wired to the runtime
  in **three slices**. Slice 1 (runtime adapter dispatch) is **done**. Remaining:
  - **Slice 2** — the client migrates from `KnownModel`/`ProviderDefinition.knownModels`
    to `CanonicalModel`/`Offering`; cockpit + `reasoning-resolver` move from
    `ReasoningCapability` (`kind`/`effort`) to `ReasoningControl` (`mode` union).
    This is the bigger UI migration and is what makes `/curate` output *light up
    in the app* (today chutes works via `knownModels` + the generic/ adapter path,
    but the catalogue Offerings/records are not yet client-consumed).
  - **Slice 3** — catalogue loading/bundling; the adapter registry populated from
    `Offering.adapter` instead of hand-registered in `registerChutes()`.
- Each slice goes through the full ritual: **brainstorm → spec → plan →
  subagent-driven implementation → independent review → squash-merge.** Chris
  likes being asked the forking decisions (one question at a time) and values
  short reasoning over bare approval. Walk-through mode, not task-handoff.

## Likely next step (confirm with Chris)
He'll probably want one of: **(a) Slice 2** (client→catalogue — the high-value
migration); (b) **curate more models/providers** via `/curate` (the skill is
ready and dogfooded); (c) investigate whether chutes `reasoning_content` truly
surfaces on non-trivial prompts (DeepSeek showed `reasoning_tokens: 0` on trivial
ones); (d) promote the throwaway live-check driver into a reusable maintainer CLI.
**Ask which; don't assume.**

## Gotchas that will bite you if you forget
- **`bun test` only runs `src/`** (bunfig `root = "./src"`). The conversation-suite
  tests live under `curation/` — run them with **`bun test ./curation/`** (or
  `bun run curate:suite`). Always run BOTH for a full check.
- **`bun run typecheck`** (`tsc -p tsconfig.test.json`) is what covers `curation/`;
  `bun run build` (emitting tsconfig) deliberately excludes it so the suite is not
  shipped. CI runs `pnpm typecheck`.
- **Biome pre-commit hook enforces `organizeImports`.** If a commit is rejected,
  `bunx @biomejs/biome check --write <file>`, re-stage, recommit.
- **Endpoint rule:** always `/chat/completions`, never `/responses` (we hold
  context). See the memory.
- **Adapters target one model each** (hardcoded slug, like the baseline). Chutes
  uses a `chutesAdapter(slug, vision)` factory registered per-model as
  `chutes:<slug>`. A slug-on-`CanonicalRequest` refactor (to share one adapter)
  was deliberately deferred.
- **The live `RunnerBinding`** does its own fetch (not `streamCompletion`) to
  capture HTTP status (the 400/429 case must be a checkable outcome, not a throw);
  it retries 429/5xx with an injectable backoff.
- **Untracked spike leftovers** (`models/glm-5.1.yaml`, `packages/llm-unified/
  fixtures/deepseek-v4-pro.fixtures.json`) are orphaned and harmless — optional
  cleanup, do NOT treat as live work.

## Tone
Chris is a backend dev (C#) who co-leads frontend/client/inference and defers to
you on backend/crypto/adapters. He's in a great, productive flow — "early
afternoon, let's go". NGO, no delivery pressure, quality over speed. Chat in
German; everything in the repo is British English.

Go well. — Liz
