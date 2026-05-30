# Client Catalogue Migration (Catalogue→Runtime, Slice 2) — Design

- **Date:** 2026-05-30
- **Status:** Draft
- **Author:** Liz (Claude Code), brief-led with Chris
- **Part of:** Catalogue→Runtime wiring, decomposed into three slices. **This is Slice 2.**
  - Slice 1 (done, `ba26ab4`): runtime adapter dispatch — `streamCompletion` routes
    through a per-model `ModelAdapter` via the adapter registry.
  - Slice 2 (this): the client moves from `KnownModel`/`ProviderDefinition.knownModels`
    to `CanonicalModel`/`Offering`. Model selection becomes **canonical-first**: the
    user picks a model, then an offering (provider deployment) with a ranked
    suggestion. Cockpit, context gauge, and reasoning-resolver move from
    `ReasoningCapability` (`kind`/`effort`) to `ReasoningControl` (`mode` union).
  - Slice 3 (later spec): catalogue loading/bundling — YAML entries → bundled runtime
    catalogue; the adapter registry populated from `Offering.adapter` rather than
    hand-registered in `registerChutes()`.
- **Depends on:** the catalogue types (`packages/llm-unified/src/catalogue/`) landed
  2026-05-29, and the Slice 1 adapter registry.

---

## 1. Context & Motivation

The catalogue two-level data model — `CanonicalModel` (curated, provider-independent
identity) and `Offering` (one provider × slug endpoint, carrying its own measured
`ModelProfile`) — exists but is **not yet consumed by the client**. The client still
resolves a model through `getProvider(templateId).knownModels.find(m => m.id === modelId)`
and renders the cockpit from the old `ReasoningCapability` shape.

This matters because the same model is offered by several providers. Today's
inventory:

| Canonical model | Offerings |
|---|---|
| **GLM 5.1** | chutes (TEE) + nano-gpt + novita + ollama-cloud → 4 |
| **Kimi K2.6** | chutes (TEE) + nano-gpt + novita + ollama-cloud → 4 |
| **Gemma 4 31B** | chutes (turbo TEE) + nano-gpt + novita + ollama-cloud → 4 |
| **DeepSeek V4 Flash** | nano-gpt + novita + ollama-cloud → 3 |
| **DeepSeek V4 Pro** | nano-gpt + novita + ollama-cloud → 3 |
| **GLM 5** | nano-gpt + novita + ollama-cloud → 3 |
| **DeepSeek V3.2** | chutes (TEE) → 1 |

With the old `knownModels` shape, the same model appears as several unrelated picker
entries, one per provider. Slice 2 collapses these onto a single canonical identity
the user chooses first, then surfaces the available deployments so the user can pick
the highest-trust one (e.g. the chutes TEE deployment of GLM 5.1).

## 2. Decisions (settled with Chris)

1. **Canonical-first selection.** The user picks a `CanonicalModel`; the offering
   (provider deployment) is a second, explicit choice. The model is the foreground;
   the offering is the deployment detail.
2. **Suggested, not automatic.** The offering list is always shown. The
   highest-ranked **configured** offering is pre-selected, but the user chooses — no
   silent auto-resolution. This honours *omakase over options* (a strong default)
   without removing the user's agency, and *disabled over hidden* (every deployment
   is visible).
3. **In-code catalogue data (Approach A).** Each provider replaces `knownModels`
   with hand-authored `offerings`; a `canonical-registry.ts` holds the canonicals.
   No throwaway transform layer. Slice 3 later swaps only the *source* (hand-authored
   TS → bundled YAML), leaving every consumer untouched.
4. **Clean break for existing personas.** No migration mapper. A persona without a
   `canonicalId` is treated as "model not set" and the user re-picks. Acceptable
   pre-v0.1.0 / private.
6. **The custom-model input is removed.** Today `ModelList` lets a user type an
   arbitrary slug bound to the selected provider — an uncatalogued escape hatch.
   Canonical-first has no place for it without a fallback-offering design, so it is
   removed outright in Slice 2 (only curated canonicals are selectable). It can
   return later as a properly-designed uncatalogued offering. Consequence: clean
   break stays simple — a persona without a `canonicalId` always means "model not
   set, re-pick".
5. **`fixed-on` reasoning is shown, lit, and non-interactive.** Rather than hiding
   the reasoning control for always-on models (today's behaviour), render a single
   lit-but-disabled "On" indicator. Rationale (Chris): this is transparency *and* UI
   uniformity. A visible lit indicator affirms "this model reasons before it answers";
   its absence would force the user to actively resolve "does it *not* reason?". That
   interpretive load is exactly what *don't make me think* and *least astonishment*
   exist to remove, and it matters disproportionately for the neurodivergent users we
   centre.

## 3. Architecture

### 3.1 Catalogue data (in-code)

- **New `packages/llm-unified/src/catalogue/canonical-registry.ts`** — exports
  `CANONICALS: CanonicalModel[]` (the seven models in §1) plus `listCanonicals()`
  and `getCanonical(id)`. Provider-independent identity only (`id`, `displayName`,
  `family`, `requiredCaps`, `freedomOriented`).
- **Each provider file** (`chutes.ts`, `nano-gpt.ts`, `novita.ts`,
  `ollama-cloud.ts`) replaces `knownModels: KnownModel[]` with
  `offerings: Offering[]`. Each `Offering` carries `canonicalRef` (→ a
  `CanonicalModel.id`), `upstreamSlug`, `adapter`, `profile` (with
  `ReasoningControl`), `context`, `trust`, `freedomOrientedDeployment`, `source`,
  `confidence`.
  - **chutes** offerings keep their live-curated values: `trust.tee = true`,
    `confidence: 'verified'`, adapters `{ kind: 'catalogue', adapterId: 'chutes:<slug>' }`.
  - **nano-gpt / novita / ollama-cloud** offerings are derived mechanically from
    today's `knownModels`: `trust.tee = false`, `confidence: 'heuristic'`,
    `adapter: { kind: 'generic' }`, `profile.reasoning` via the §4 mapping. Their
    `context` is the old `contextWindow` for both `recommended` and `max` until
    curated.
- **`types.ts`** — `ProviderDefinition.knownModels` becomes
  `ProviderDefinition.offerings: Offering[]` (hard replacement, no parallel field).
  `KnownModel`, `ReasoningCapability`, and `ReasoningEffortSpec` are removed, along
  with their re-exports in `index.ts` and their tests.

### 3.2 Catalogue index + ranking

`registry.ts` gains an aggregate view over all registered providers' offerings:

- `listOfferings(canonicalId): Offering[]` — across providers, sorted by
  `rankOfferings`.
- `getOffering(providerTemplateId, upstreamSlug): Offering | undefined` — exact
  lookup for the send path.
- `rankOfferings(offerings): Offering[]` — deterministic order:
  **`trust.tee` desc → `freedomOrientedDeployment` desc → provider `sortPriority`
  asc → `confidence` (verified > partial > heuristic)**. Pure, pick-time only; never
  invoked on the send path.

### 3.3 Persona schema

A persona today binds to a configured provider row (`providerId`, carrying the API
key, whose `templateId` maps to a `ProviderDefinition`) plus `modelId`. Slice 2 adds
**one field**:

- `+ canonicalId: string` — the foreground identity.
- `providerId` (configured row) + `modelId` (= the offering's `upstreamSlug`) are
  retained and together identify the chosen offering.

Clean break: a persona without `canonicalId` renders as "model not set" and is
re-picked. No mapper, no automatic backfill.

### 3.4 Data flow

- **Pick time** (`persona-editor`): user picks a canonical →
  `listOfferings(canonicalId)` intersected with the user's configured provider
  templates; the top-ranked *configured* offering is pre-selected; the user
  confirms or changes; the persona is saved as `{ canonicalId, providerId, modelId }`.
- **Send time** (`send-message.ts`, `stream-engine.ts`): `persona.{providerId,
  modelId}` → configured provider row → `templateId` → `getOffering(templateId,
  modelId)` → `offering.profile` (reasoning/vision/tools/replay), `offering.adapter`
  (dispatch), `offering.context` (gauge). No ranking in the hot path.
- **Runtime (`llm-unified`):** `StreamCompletionArgs`/`OneShotCompletionArgs` take
  the resolved `Offering` instead of `KnownModel`. Adapter dispatch reads
  `offering.adapter` (catalogue → `adapterId`; generic → the byte-identical generic
  path from Slice 1).

## 4. Reasoning migration

### 4.1 `ReasoningCapability` → `ReasoningControl` mapping

Used to author the non-chutes offerings:

| Old `ReasoningCapability` | New `ReasoningControl` |
|---|---|
| `kind: 'no_reasoning'` | `{ mode: 'none' }` |
| `kind: 'always_on'`, no `effort` | `{ mode: 'fixed-on' }` |
| `kind: 'optional'`, no `effort` | `{ mode: 'toggle', defaultOn }` |
| has `effort` (buckets) | `{ mode: 'steps', steps: buckets, offStep: kind === 'optional' ? 'off' : null, defaultStep }` |

### 4.2 `reasoning-resolver.ts` rewrite

- **`ReasoningState`** simplifies to `{ kind: 'off' } | { kind: 'on' } | { kind: 'step'; step: string }`.
- **`initialReasoningState(control: ReasoningControl): ReasoningState`** — derived
  from `defaultOn` (`toggle`) / `defaultStep` (`steps`); `none`/`fixed-on` yield a
  fixed state that emits nothing.
- **`resolveReasoningBodyExtras(control, state): Record<string, unknown>`** — emits
  the **same `ReasoningIntent` wire shape** as today:
  - `none` / `fixed-on` → `{}` (nothing to steer).
  - `toggle` → `{ reasoning: { enabled } }`.
  - `steps` → `{ reasoning: { enabled: true, effort: step } }` for a real step
    (`low`/`medium`/`high`), `{ reasoning: { enabled: false } }` for `offStep`.
- The per-provider translation (Novita flag, nano-gpt slug-swap, ollama `think`)
  stays unchanged in `applyReasoningToBody`. No wire-shape regression for shipped
  models (every reasoning model we ship is `optional` + effort → `steps` with
  `offStep`, which emits exactly as before).

## 5. Cockpit & picker UI

### 5.1 Cockpit

- `CockpitMenu` takes `control: ReasoningControl` (from `offering.profile.reasoning`)
  instead of a `KnownModel`. Render per mode:
  - `none` → menu empty (as today's `no_reasoning`).
  - `fixed-on` → a single **lit, disabled "On"** indicator (per Decision §2.5).
  - `toggle` → On/Off chips.
  - `steps` → one chip per `step` + an "Off" chip when `offStep` is non-null.
- `Cockpit` / `InteractionMode` read the context gauge from
  `offering.context.recommended` (was `model.contextWindow`).

### 5.2 Picker (two-level, in `persona-editor`)

- **Stage 1 — model:** `listCanonicals()`, each row showing availability badges
  (offering count, "TEE available").
- **Stage 2 — offering:** `listOfferings(canonicalId)`, rank-sorted; the top-ranked
  configured offering pre-selected. Configured providers are selectable;
  **unconfigured providers are shown disabled with a constructive CTA** ("Add chutes
  to use the TEE deployment"). Badges: TEE, jurisdiction, context, freedom.
- On confirm, the editor patches `{ canonicalId, providerId, modelId }`.
- The custom-model input (`ModelList`, today's lines 526–545) is removed (Decision §2.6).

## 6. Testing

- **`llm-unified` (Bun):** `rankOfferings` ordering (TEE > freedom > priority >
  confidence); `listOfferings`/`getOffering`; the §4.1 reasoning mapping; a schema
  round-trip for the new offerings. Old `KnownModel`/`ReasoningCapability` tests are
  replaced by offering-shaped equivalents.
- **`user-client` (Vitest):** `reasoning-resolver` across all four modes;
  `CockpitMenu` per mode (incl. the lit-disabled `fixed-on` chip); the picker
  (pre-selection, disabled-CTA for unconfigured providers, save shape).

## 7. Manual verification (Chris, on device)

1. Create a persona, pick **GLM 5.1** → chutes-TEE offering is pre-suggested; the
   other three providers are listed (configured ones selectable, unconfigured greyed
   with a CTA).
2. Pick a non-TEE provider → persona saves and sends through it.
3. Reasoning steps (low/medium/high) and Off behave live in the cockpit.
4. A `fixed-on` model shows the lit, non-clickable "On" indicator.
5. The context gauge reflects `offering.context.recommended`.
6. An existing (pre-Slice-2) persona shows "model not set" and prompts a re-pick.

## 8. Out of scope / future

- **Provider-only re-pick** when a chosen offering's model disappears upstream: keep
  the `canonicalId`, re-choose just the offering. The data model already supports
  this (canonical is decoupled from the offering); the flow is deferred.
- **Slice 3:** YAML bundling; adapter registry populated from `Offering.adapter`.
- **Curating the non-chutes offerings** to `verified` confidence and real TEE/ZDR
  trust data (today they are `heuristic`, derived from `knownModels`).

## 9. Files touched (summary)

**`packages/llm-unified`**
- `src/catalogue/canonical-registry.ts` (new)
- `src/types.ts` (remove `KnownModel`/`ReasoningCapability`/`ReasoningEffortSpec`;
  `ProviderDefinition.offerings`)
- `src/index.ts` (export changes)
- `src/registry.ts` (`listOfferings`/`getOffering`/`rankOfferings`)
- `src/providers/{chutes,nano-gpt,novita,ollama-cloud}.ts` (offerings)
- `src/stream-completion.ts`, `src/one-shot-completion.ts` (take `Offering`)
- `src/providers/curation/*`, `probe.ts` (follow the type change)
- tests across the above

**`apps/user-client`**
- `src/lib/reasoning-resolver.ts` (+ test)
- `src/components/chat/{Cockpit,CockpitMenu,InteractionMode}.tsx` (+ tests)
- `src/routes/app/persona-editor.tsx` + the provider/model selector child (two-level
  picker)
- `src/data/send-message.ts`, `src/lib/stream-engine.ts` (offering resolution)
- persona schema/store (add `canonicalId`; clean-break handling)
</content>
</invoke>
