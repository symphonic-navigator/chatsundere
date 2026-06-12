# Model instructions — curated per-model prompt steering

**Date:** 2026-06-12
**Status:** Approved by Chris (chat, 2026-06-12)
**Scope:** `packages/llm-unified` (catalogue + composition), three call sites in
`apps/user-client`, Mistral curation content, Curation Records.

## 1. Problem

Some models need standing behavioural steering that belongs to the **model
itself**, not to any particular provider offering and not to any persona. The
motivating case: the Mistral family (Small 4, Medium 3.5, Large 3) is warm and
creative but chronically over-formats — synopsis-style bullet lists where the
user asked for a story, spaced-out or all-capital words for emphasis, heading
cascades in casual chat. This exhausts the reader and degrades TTS read-aloud.
We have nowhere curated to put a corrective instruction that travels with the
model across providers.

## 2. Decision

Add an optional curated field to `CanonicalModel` and inject it as a new Band-1
prompt segment.

### 2.1 Data model

- `CanonicalModel` gains `modelInstructions?: string`
  (`packages/llm-unified/src/catalogue/types.ts`). JSDoc: curated
  behavioural/formatting steering that travels with the model regardless of
  provider. Deliberately **not** named `instructions` — at the call sites it
  would collide mentally with `persona.instructions`.
- `parseCatalogueEntry` (`catalogue/schema.ts`) accepts the new optional
  string; the Valibot gate remains the single source of truth.
- No family-level mechanism. Family stays a loose grouping axis (catalogue
  design D6); shared text is deduplicated with a shared constant instead.

### 2.2 Prompt composition

New segment in `packages/llm-unified/src/composition.ts`:

- `id: 'modelInstructions'`, **Band 1**, placed **after `teal`, before
  `roleplay`** — final Band-1 order: tonality → nsfw → global → teal →
  **modelInstructions** → roleplay → persona. The roleplay → persona adjacency
  is empirically load-bearing and stays untouched.
- Rationale for the position: this is curated platform steering like TEAL;
  persona instructions come later, so a user who explicitly wants lists wins
  with the more specific instruction.
- **Jobs: `chat` and `greeting`** — everywhere the model produces
  user-readable prose. Title and memory are short-format jobs and excluded.
- `BuildPromptInputs` gains `modelInstructions: string` (flat resolved string,
  like the other inputs). Empty string → segment dropped (existing builder
  behaviour).

### 2.3 Call sites

All three `buildPrompt` call sites resolve the value as
`getCanonical(offering.canonicalRef)?.modelInstructions ?? ''`:

- `apps/user-client/src/lib/stream-engine.ts` (chat + greeting turns)
- `apps/user-client/src/lib/title-generator.ts` (resolves but the `title` job
  excludes the segment — passing it keeps the input shape uniform)
- `apps/user-client/src/routes/app/chat/chat-page.tsx` (context-token gauge —
  counts the segment automatically because it uses the same builder)

Offerings without `canonicalRef` resolve to `''`.

### 2.4 Mistral content (first use)

A shared constant `MISTRAL_FORMATTING_INSTRUCTIONS` in a new
`packages/llm-unified/src/catalogue/model-instructions.ts`, referenced by all
three Mistral canonicals in `canonical-registry.ts`:

> Formatting restraint: prefer flowing prose over heavy Markdown structure.
> When the user asks for a story or any other piece of creative writing,
> deliver it as continuous narrative prose — never as a synopsis-style list of
> bullet points. Use lists, tables and headings only where the content is
> genuinely enumerable or the user explicitly asks for them. Never space out
> letters or write whole words in capitals for emphasis — acronyms and
> initialisms are of course fine. None of this restricts what you say; it only
> restrains how the page looks.

The closing sentence is deliberate: we restrain typography, never expression.

## 3. Explicitly out of scope

- No UI surface, no toggle — this is omakase curation, invisible to the user.
- No family-level or offering-level instruction mechanism.
- No structured steering (sampler params etc.) — a single freeform string.
- No Dexie change, no new egress, no audit-gate path (not Larissa: client-only
  prompt content; not Laura: no flow/state/reachability change).

## 4. Tests

- Composition: segment present for `chat` and `greeting`, absent for `title`
  and `memory`; ordering (after teal, before roleplay); empty string drops the
  segment.
- Catalogue: schema accepts/round-trips `modelInstructions`; the three Mistral
  canonicals carry the shared constant.

## 5. Documentation

- The three Mistral Model Curation Records (`obsidian/models/`) gain a short
  paragraph: the over-formatting observation and why the steering exists.

## 6. Manual verification (Chris, on device)

Restart `pnpm dev` first — `packages/llm-unified` changes are invisible to
Vite HMR otherwise.

1. Pick a Mistral model (e.g. Mistral Small 4) and ask for a short story —
   expect continuous narrative prose, no bullet-point synopsis.
2. In casual chat, provoke emphasis (an excited topic) — expect no
   spaced-out letters, no ALL-CAPS words; acronyms still allowed.
3. Ask explicitly for a comparison table — expect a table (persona/user intent
   still wins over the restraint).
4. Open a fresh chat with a greeting-enabled persona on Mistral — the opener
   should also arrive as prose.
5. Switch to a non-Mistral model (e.g. GLM 5) — behaviour unchanged, context
   gauge shows no Mistral segment cost.
6. Read a story aloud via TTS — the flowing prose should read naturally,
   without list-item staccato.
