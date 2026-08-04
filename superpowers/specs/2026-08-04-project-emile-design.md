# Project Émile — Curation-as-Data Design Specification

**Date:** 2026-08-04
**Status:** Draft, awaiting Chris's review
**Authors:** Chris (vision, brainstorming partner) + Liz (architecture, drafting)
**Named for:** Émile Théodore — decorated curator of the Palais des Beaux-Arts de Lille, Chevalier de la Légion d'honneur from 1920. The "curator" double-meaning is the point: this project is about curation, both senses.

---

## 1. Purpose and Scope

Project Émile turns model curation from hand-written code into data, and turns it from a developer-only activity into an agent-assisted one that runs from two front-ends (the user's browser and Claude Code). Today, every reasoning-capable model needs a hand-written `ModelAdapter` file in `packages/llm-unified/src/adapters/`, and curation is a developer ritual run via the `/curate` skill. The hypothesis Chris opened with — *there are not infinitely many wire formats for reasoning control; there are recurring patterns we can derive from* — holds. This spec captures the architecture that follows from that fact, and from Chris's unifying idea: a contribution funnel where users curate for themselves, admins review and promote (or escalate), and the hard cases get expert curation in Claude Code.

This is a large sub-project. It is intentionally decomposed into six units (E1–E6) that can be built and verified in sequence, with E1 as the foundation that is needed regardless of the rest.

### 1.1 In scope

- **E1 — Declarative adapter factory.** `declarativeAdapter(spec): ModelAdapter` with a strategy-pattern registry per axis. Re-expresses the 11 hand-written adapters as specs where possible; genuine special cases become registered strategies. The off-guard is a non-overridable derived property, not a spec field.
- **E2a — Base-set config + upstream metadata parser.** Ship the current builtins as a JSON seed (`base-curation.json` + Valibot schema), absorbed on first backend boot with a seed ⊕ overrides merge model. An upstream `/models` parser populates an *available* list (existence + declared hints), distinct from the *curated* list (verified behaviour).
- **E2b — Backend catalogue schema + ADR.** The tables holding the catalogue (canonical models, offerings, proposals, admin overrides, seed meta), the privacy-gradient table design (draft = client-only, proposal = admin-queue with proposer identity, published = instance-wide and anonymised), versioned offerings with rollback, and an ADR establishing model-behaviour metadata as a new class of backend data that does not violate the zero-knowledge guarantee.
- **E3 — Probe-harness + token-accounting crosscheck.** The verification substrate, consuming `declarativeAdapter(spec)` (not reimplementing the wire). Adds a `billingProbe` that catches the off-only-hides defect class (trace empty, tokens still billed) — the gap that bit us with Opus-5 and Grok-4.5. Comparative crosscheck (completion_tokens off vs on) is a fallback only, running when a provider does not report `reasoning_tokens` separately.
- **E4 — Agentic curation loop (two modes, one engine).** A shared `packages/curation-engine` with a `CurationProtocol` contract. Mode (i): user-self-curation in the browser — non-interactive, best-effort, produces a client-local draft. Mode (ii): admin/expert curation in Claude Code — interactive, the quality path for hard cases, can lock a model. The same engine, the same protocol; the difference is who the "expert" is.
- **E5 — Admin curation-review queue UI.** The admin surface: a proposal queue (accept / reject / escalate-as-task-brief), a requires-review queue for billing-probe defects (confirm or override the auto-`fixed-on`), a canonical editor (display name, freedom tri-state, recommended tri-state, specialised, category multi-select via a conscious in-place modal, lock toggle).
- **E6 — Drift & re-verification.** "Curated once" is really "curated once, periodically re-verified." Every published offering carries shelf-life metadata (`lastVerified`, `verifyBy`, `verifiedEvidence`). Four of the five drift signals are automatable (probe-diff, billing-probe re-run, metadata re-fetch, mechanism re-identify); the fifth (device-screenshot defects) stays manual.

### 1.2 Out of scope (deferred or future)

- **End-user presentation UX** — how `available`-vs-`curated` is surfaced to the user in the model picker. Deliberately deferred; we solve it when we stand in front of it. The first step is "curation is data-driven instead of code," tested before expanding into presentation.
- **User-reported defect channel** — a future E6 input source where users report "this model behaves weird," feeding the manual re-verify trigger. Recorded here so it is not lost; not in the first scope.
- **Proposer attribution on published curations** — an open item Chris is thinking about; see §10.
- The exact scheduling infrastructure for periodic re-verification (cron/queue) — an ops/plan concern, not a design concern.
- Automated device-screenshot verification — stays manual by design; the device is where the human catches what no suite sees.

### 1.3 Sequencing principle

The first step Chris wants to test is "curation is now data-driven instead of code." That is E1 (declarative adapter) plus E2a's JSON seed. The contribution funnel tables (E2b proposals/published) land with the backend (v0.3.0 per the roadmap). This spec captures the full target architecture; the implementation plan phases it. E1 is first and is needed regardless — Chris: "E1 brauchen wir sowieso und ich glaube, dass wir damit sogar schon einen guten Teil geschafft hätten."

---

## 2. The Taxonomy — Why This Is Possible

The whole project rests on the empirical fact that reasoning control on the wire uses a small, finite set of patterns. After reading every adapter in `packages/llm-unified/src/adapters/`, the combinatorial space is:

### 2.1 Five request mechanisms (+ a sixth "none")

| # | Mechanism | Wire form | Used by |
|---|---|---|---|
| 1 | Unified object | `{ reasoning: { enabled, effort? } }` | OpenRouter (all models), nano-gpt flag-mode, Claude effort-mode |
| 2 | `reasoning_effort` string | top-level `'low'\|'medium'\|'high'\|'none'` | xAI Grok 4.3/4.5, novita (newer slugs), OpenAI GPT-5 family |
| 3 | `enable_thinking` boolean | top-level boolean | novita (older: GLM, DeepSeek, Kimi K2.6, Gemma, MiMo) |
| 4 | `think` bool \| level | `false \| true \| 'low'\|'medium'\|'high'\|'max'` | ollama native (`/api/chat`) |
| 5 | Slug swap | no body field — the model slug *is* the switch | nano-gpt slug-mode, xAI Grok 4.20, Claude 4 family |
| 6 | None | no reasoning param | non-reasoning models |

### 2.2 Three trace channels

- `delta.reasoning` — OpenRouter's unified field
- `delta.reasoning_content` — xAI, novita, native OpenAI-compatible
- `message.thinking` — ollama native NDJSON

### 2.3 Two response framings

`sse` (everyone) and `ndjson` (ollama native).

### 2.4 The whole space

Five request mechanisms × three trace channels × two framings — roughly eight combinations that actually occur in the wild. **That is a table, not an adapter file per provider.** This is what makes a declarative factory possible.

### 2.5 The off-guard is a derived property, not adapter logic

The same line appears verbatim in `openrouter-openai.ts`, `xai-openai.ts`, `anthropic-claude.ts`, and `ollama-native.ts`:

```ts
const canDisableReasoning =
  control.mode === 'toggle' || (control.mode === 'steps' && control.offStep !== null);
```

This is the entire Grok-4.5 / GLM-5.2 / Opus-5 lesson condensed into one formula. Some models reject an off intent with HTTP 400; others *pretend* to honour it while still billing reasoning tokens. An adapter must never emit an off for a `fixed-on` model or a `steps` control with no off step. It is a pure function of `ReasoningControl`. In a declarative spec it is **not a field you can set — it is computed**, and making it non-overridable bakes the safest property of the system into the factory rather than leaving it to per-adapter discipline.

---

## 3. The Unified Shape — The Contribution Funnel

Chris's unifying idea is a contribution funnel with a three-step trust gradient:

```
User curates in the browser (self, fast, non-interactive)
        │
        ├── becomes available FOR THEM immediately (draft, client-local, private)
        │
        └── propose → Admin queue
                          ├── accept   → publish to all (model+upstream grain, anonymised, versioned)
                          ├── reject  → proposal discarded, but the demand signal remains
                          └── "non-interactive was too weak" → escalate to Claude Code
                                                                (Liz + Admin curate it properly)
```

The beautiful property: **a discarded proposal is not worthless** — it tells the admin "someone wants this model." That is the mechanism-embodies-ethos point: even a rejected curation teaches what users want. Fast self-fulfilment for the user, quality via review, and a demand signal even on rejection.

### 3.1 The privacy gradient

The "upload on purpose" principle (Chris) holds because **the mere use of a derestricted model is an identifying signal**. "GLM 4.7 Derestricted V5" on a proposal list says something about the proposer. So:

- **Draft** — fully private, client-local (Dexie vault, syncs as user data like a persona). Nobody sees that you use this model — not even the admin.
- **Proposal** — a deliberate, explicit disclosure to the admin ("I use this, help me / please curate this"). The user decides to emit this signal — not the app on their behalf.
- **Published** — instance-wide, **anonymised** (no proposer attribution). The curation belongs to the instance, not the user.

A derestricted-model user can curate silently for themselves and never propose — and that is legitimate. The draft never leaves their vault.

---

## 4. E1 — Declarative Adapter Factory

### 4.1 Purpose

The translation of `ReasoningControl` (UI data) + `ReasoningIntent` (engine intent) into a wire body becomes data-driven, not hand-written per provider. A factory `declarativeAdapter(spec): ModelAdapter` covers the 90% case; the remainder becomes named strategies, not separate files.

### 4.2 Strategy pattern per axis

Following Chris's steer, the factory does not encode dialects as a discriminated union in the spec (which would widen on every new dialect). Instead there is a **strategy registry per axis**, selected by string key:

```ts
type MessageStrategy   = (msgs: WireMessage[]) => unknown[];        // 'openai' | 'ollama-native' | ...
type SamplingStrategy  = (s: Record<string, unknown>) => Record<string, unknown>;  // 'flat' | 'ollama-options' | ...
type ReasoningStrategy = (intent, control, canDisable) => { body, modelId? };  // the 5 mechanisms + none
type TraceStrategy     = (raw, state) => StreamChunk[];             // the 3 channels
```

A `DeclarativeAdapterSpec` selects one key per axis:

```ts
interface DeclarativeAdapterSpec {
  framing: 'sse' | 'ndjson';
  path?: string;                       // default '/chat/completions'
  message: string;                     // strategy key, default 'openai'
  reasoning: { mechanism: string; control: ReasoningControl; defaultEffort?: string };
  trace: string;                       // strategy key
  sampling?: string;                   // strategy key, default 'flat'
  headers?: Record<string, string>;    // wafer ZDR, xAI conv-id — static
  includeReasoning?: boolean;          // OpenAI GPT-5 "trace gated behind flag" — static
  cacheControl?: { kind: 'anthropic'; ttl?: '5m' | '1h' };  // → decoration
  // off-guard is NOT here — derived from control.mode / offStep, non-overridable
}
```

A new dialect is a new strategy registration, not a spec-union widening. And — the learning accelerant — a deviation is *axis-local*: an offering with a strange message shape but normal reasoning keeps the declarative reasoning strategy and overrides only `message`. You can see exactly *which axis* is special per outlier. That is what feeds "we learn what we can automate next."

### 4.3 The two-tier curation model

Reconciled with the existing `AdapterRef = { kind: 'catalogue', adapterId } | { kind: 'generic' }`:

- **Tier 1 (default): declarative spec** — `{ kind: 'declarative', spec }`. The 11 hand-written adapters are re-expressed as specs where possible (a *reducing* refactor — it removes code).
- **Tier 2 (escape hatch): registered strategy** — `{ kind: 'strategy', strategyId }` for genuine special cases that need code (Anthropic `cache_control`, ollama-native if it resists declarative capture, dynamic conv-id). A strategy is a bundle of axis-strategies, mixed-and-matched.

The learning loop: Tier-2 strategies that *recur* (three offerings need the same special handling) get **promoted** into the declarative spec as a new axis-strategy option — from then on, Tier-1. **Code today, data tomorrow.** This is the self-improving element Chris described.

### 4.4 Why this does not re-open the two-wire-paths trap

The 2026-07-17 lesson: a curation suite that reimplements the wire it verifies cannot fail the way production fails. Here, *both* tiers consume the same factory core: `declarativeAdapter(spec)` for Tier-1, `strategyAdapter(strategyId)` for Tier-2 — but both produce a `ModelAdapter`, and the suite verifies the `ModelAdapter` interface, not the spec or the strategy. The suite tests the *result*, not the *path*. A Tier-2 strategy bug surfaces in the suite because the suite feeds the adapter and checks the wire response.

### 4.5 Per-offering exceptions

"Per model/upstream combination exceptions" live on the `Offering` (the deployment grain). An offering carries its `AdapterRef`; the exception is that a specific offering binds `{ kind: 'strategy', strategyId: 'ollama-native-glm52' }` instead of the declarative default. The family's spec stays declarative; only this one offering diverges. Exactly Chris's "Sonderfälle bekommen Code, damit sie besser laufen."

### 4.6 Three confirmed decisions

- **Strategy keys are a closed internal vocabulary** (registered in code), not user-editable. User specs (E2b/E4) choose from *existing* strategies via dropdown; they cannot define their own. A new strategy is a code change, Tier-2, Liz + human.
- **The refactor shares the tool-call buffer boilerplate** (6× copied) as part of the factory core — no axis-strategy reimplements it.
- **E1 is behaviour-preserving + small cleanups**; large promotions (new axis-strategy into the spec) are a separate learning step, not E1 scope.

---

## 5. E2a — Base-Set Config + Upstream Metadata Parser

### 5.1 The central distinction: two tables, two confidence levels

| | **available** | **curated** |
|---|---|---|
| Source | Metadata parser (upstream `/models`) | Base-set + proposals + admin curations |
| Content | Model exists, declared hints (context window, capabilities per upstream) | Verified behaviour (ReasoningControl, real trace channels, off-guard empirical) |
| Confidence | low — `/models` lies (Qwen3.5 `reasoning:false`, Grok-4.5 context 1M→500k) | high — probe evidence from the suite |
| UI mark | "unverified" until curated | clean profile, display name, soft flags |

A model can be **available-but-not-curated** (visible, usable with conservative defaults, no verified profile) or **curated** (verified layer on top). Curation *attaches* to an available model — the available model is the substrate. This is the concrete form of "metadata = existence + hints, curation = verified behaviour."

### 5.2 Base-set config

- **Format:** `base-curation.json` + `BaseCurationSchema` (Valibot). A JSON seed, validated on import, not executable. Generated from the current `canonical-registry.ts` + `providers/*.ts` (one-time migration), then maintained as JSON.
- **Content:** the current builtins as data — canonicals, offerings (model+upstream grain), their declarative adapter specs (from E1), soft flags (freedom tri-state), display names, recommended/specialised/category.
- **First-boot import:** backend boots → imports `base-curation.json` into the catalogue tables (E2b), idempotent. A self-hoster gets GLM 5.2, Kimi K3, Grok 4.5, Claude etc. operational out-of-the-box.
- **Merge model — seed ⊕ overrides, no clobber:** the seed carries `seedVersion`; the backend tracks `absorbedSeedVersion`. On update, new canonicals/offerings are *added*; existing admin-edited fields (display name, soft flags, recommended/specialised/category) are **not overwritten**. Cleanest as layering: catalogue = `seed-base ⊕ admin-overrides ⊕ user-drafts`. The seed only ever *adds*; admin edits live in an override layer. No update can take away what an admin consciously set.
- **Self-hoster override:** an operator can ship their own/extended `base-curation.json` to pre-seed their instance. The point of data-not-code: the seed is swappable without forking our code.

### 5.3 Upstream metadata parser

- **Endpoint:** every `ProviderDefinition` already carries `probe: { path, method }`. The parser hits it (e.g. `/v1/models` GET), reads the model list, extracts per model: slug, declared context window, declared capabilities (vision/tools/reasoning per upstream), max output.
- **Output:** the **available** list for that upstream — models the upstream *offers*, marked "unverified," with declared hints. This is the source of truth for "which models exist" (Chris's requirement), but explicitly *not* for "what they can do."
- **When it runs:** (i) on provider-add (user adds an Ollama endpoint → we list its models), (ii) refreshable on-demand (admin triggers rescan; upstream added a model), (iii) optionally periodic (a drift-sensitive refresh — overlaps with E6).
- **Client/backend split:** the parser *as a concept* is client-side usable now (provider-add UX in the local-only alpha). The backend piece (base-set seed, catalogue tables) lands with the backend (v0.3.0). The same parser logic, two entry points — no duplication, because the parser is a pure `parseModelsResponse(raw): AvailableModel[]` that both sides call.
- **Hints ≠ truth — the UI must say so:** available models surface with declared hints but clearly "unverified" until curation. No blending of "upstream says `reasoning:true`" with "we verified reasoning."

### 5.4 Step-by-step principle (Chris)

In the first step, only what we have already curated surfaces. We go step by step and test "curation is now data-driven instead of code" before expanding. The "how do we present available-vs-curated to the user" problem is solved when we stand in front of it — not before.

---

## 6. E2b — Backend Catalogue Schema + ADR

### 6.1 The privacy-gradient tables

| Table | Visibility | Proposer identity | Content |
|---|---|---|---|
| **draft** | *client only* (Dexie vault, syncs as user data) | — | User curation before proposing. Backend never sees it. |
| **proposal** | Admin queue | yes (for abuse detection) | Deliberate disclosure — "I use this model, please curate." |
| **published** | instance-wide, **anonymised** | **no** (stripped) | Verified curation, instance property. |

Drafts are *not* a backend table — they are user-client data (Dexie, existing sync engine like a persona). The backend stores no untrusted drafts; a derestricted-model user can curate silently and never propose. The proposal table is the first backend write, and it is a deliberate user action.

### 6.2 Catalogue tables (schema sketch)

```ts
// weights-level — one model family
canonical_models {
  id: string                       // e.g. 'glm-5.2'
  displayName: string              // admin-controlled (no "GLM 5.2 voll super")
  category: string[]               // admin-set, controlled vocabulary, 0..n
  recommended: null | true | false // tri-state, admin-set
  specialised: boolean             // admin-set, default false
  freedomOriented: null | true | false  // tri-state, admin-set
}

// deployment-level — model × upstream (the acceptance grain)
offerings {                        // = published_curations
  canonicalRef: string             // → canonical_models.id
  providerId: string
  upstreamSlug: string
  adapterRef: AdapterRef            // {kind:'declarative', spec} | {kind:'strategy', strategyId}
  profile: ModelProfile             // verified behaviour
  context: number | null            // verified context window (vs. declared)
  confidence: 'high' | 'medium'      // high = suite-verified, medium = derived
  source: 'seed' | 'admin' | 'proposal-accepted'
  serviceKind: 'cloud' | 'self-hosted'
  locked: boolean                   // admin-authoritative, no user overrides without re-review
}

admin_overrides {                   // override layer — no-clobber on seed update
  targetId: string
  field: string
  value: unknown
}

proposals {                         // admin queue
  id, canonicalRef, providerId, upstreamSlug
  proposer: string                  // for abuse detection
  spec: DeclarativeAdapterSpec
  profile: ModelProfile
  status: 'open' | 'accepted' | 'rejected' | 'escalated' | 'review-flagged'
  billingProbeResult?: { defect: boolean; autoAction: 'fixed-on' | null; reviewFlag: boolean; rationale: string }
  submittedAt, reviewedAt, reviewedBy
}

seed_meta { absorbedSeedVersion: string }
```

### 6.3 Proposal → published: versioning, not overwrite

A proposal for a `(canonicalRef, providerId, upstreamSlug)` with no existing published offering **creates** one on accept. A proposal for an existing offering **versions** it — a new verified layer, the old one remains until the admin swaps. This makes **rollback possible** when a new curation turns out flawed (Chris: "damit ist auch rollback möglich, wenn eine neue kuratierung doch fehlerhaft war"). The *dere* half: a faulty re-curation is not a disaster, it has a next step (roll back).

### 6.4 Merge = seed ⊕ overrides ⊕ published (no clobber)

Loaded: `seed-base` (from `base-curation.json`, E2a) ⊕ `admin_overrides` (what the admin explicitly set) ⊕ `published` (accepted proposals + admin curations). On seed update: new canonicals/offerings *added*, existing admin-override fields *not overwritten*.

### 6.5 ADR — the new backend data class

A sequential ADR recording:

1. **Model-behaviour metadata is operator-instance-public metadata, not user data.** ReasoningControl, soft flags, display names, categories are *how the service is configured*, not *what a user said*.
2. **No zero-knowledge violation.** The ZK guarantee (Hard Rule §3) forbids plaintext keys/passphrases/master keys on the server. The catalogue contains no user plaintext, no keys, no passphrases — only model-behaviour metadata. The guarantee is untouched.
3. **Per-instance scope.** The catalogue is not global; each instance builds its own (seed + its own curations). No cross-instance synchronisation.
4. **Writes admin-gated for published; user-proposed-via-deliberate-upload for proposals.** Poisoning prevention via the invitation-trusted-user model (only invited users can propose) + admin publish gate. A malicious frontend user is an exclusion ground (Chris's earlier point).
5. **Privacy gradient as mechanism.** Draft client-private → proposal deliberate disclosure (with identity) → published anonymised (without identity). Protects derestricted-model users: they can curate without ever proposing, and an accepted proposal no longer carries their name.
6. **The open item (proposer attribution on published)** is recorded as an explicit Open Question in the ADR, not as decided (Chris is thinking about it).

---

## 7. E3 — Probe-Harness + Token-Accounting Crosscheck

### 7.1 Purpose

The verification substrate the curation loop (E4) drives. Consumes `declarativeAdapter(spec)` — does not reimplement the wire. Extends the existing suite with a `billingProbe` that catches the off-only-hides defect class at scale.

### 7.2 Two layers of the suite

**Structural (fixture-based, runs in CI):** replays recorded upstream responses against a factory-produced `ModelAdapter`. Verifies structure: chunk parsing, tool-call reassembly, finish reason, usage normalisation. No keys needed.

**Empirical (live probe, runs out-of-CI):** real upstream calls, full fidelity. Discipline per the project lessons: **serial** (one probe at a time), **full response match** (not phrase-match), **never claim a pass-rate before measuring**. This is the empirical-truth-over-docs layer.

Both layers consume the *same factory path* as production. The 2026-07-17 lesson: a suite that reimplements its wire cannot fail as production fails. Here the suite feeds the factory adapter and checks the `ModelAdapter` result.

### 7.3 The billing-probe — the new probe

The existing suite validated the **channel** (does reasoning text appear?). Émile adds the **billing** probe (does reasoning text appear *and are tokens billed for it*?). Defect class:

```
Model X accepts off-intent without 400
  → trace channel empties (no delta.reasoning)
  → BUT usage.reasoning_tokens > 0
  → reasoning happens hidden, is billed, just concealed
  → user thinks "I turned reasoning off" but pays for it
```

**Two strategies, primary + fallback (Chris):**

1. **Direct (when upstream reports `reasoning_tokens` separately):** send off-intent, capture usage, assert `reasoning_tokens === 0` (or field absent). If `reasoning_tokens > 0` with empty trace → defect: off-only-hides.
2. **Comparative (model-agnostic, fallback only — runs when direct unavailable):** send the same prompt once off, once on. Compare `completion_tokens`. If off does *not* reduce token count → reasoning is still happening concealed → defect. The robust fallback for upstreams without a `reasoning_tokens` field (e.g. ollama native: `prompt_eval_count` + `eval_count`, no reasoning breakdown).

Strategy 1 is primary; strategy 2 runs only as fallback. Reality will tell us whether that is sufficient (Chris: "die Realität wird uns zeigen, ob das korrekt ist").

### 7.4 Defect escalation (Chris)

On defect: **auto-`fixed-on`** (remove off from the control, no human waiting) **+ flag "requires review" with rationale**. The user is immediately safe (off no longer pretends); the expert is notified for the nuance. Mechanism-embodies-ethos: the safe default happens without waiting, the human confirms/refines. This honours "only experts can judge what an answer means" while not leaving the user exposed pending review.

### 7.5 Fixture fidelity — the pill-loss lesson

A text-only stub hid a pill-loss CRITICAL (project lesson). Fixtures must be the **richest realistic chunk sequence**, not minimal: multimodal (text + image), tool calls (fragmented + atomic), reasoning trace + token stream concurrent, usage block with `reasoning_tokens` and `cachedTokens`. A text-only fixture hides exactly the bug class the suite should catch. Fixture choice is a review point, not a routine.

### 7.6 Evidence → record

The suite produces structured evidence (probe → result → assertion pass/fail) flowing two ways:
- **Today:** feeds the model record (`obsidian/models/*.md` — header T/R/V + freedom, per-offering sections with probe evidence).
- **Émile:** feeds the backend catalogue `confidence: 'high'` field on the published offering. A proposal becomes `high`-confidence only when the suite passes.

### 7.7 Components (existing + new)

| Component | Status |
|---|---|
| `ProbeHarness` | existing (adapt to factory) |
| `RunnerBinding` (live vs fixture) | existing |
| `permutationsForReasoning` | existing |
| 10 assertion types | existing (consume factory) |
| **`billingProbe`** (direct + fallback) | **new — Émile** |
| **Fixture-fidelity rule** | **new — as a review check** |

---

## 8. E4 — Agentic Curation Loop (Two Modes, One Engine)

### 8.1 Purpose

The agent loop that takes a model from "available, unverified" to "curated, profiled." Two modes — user-self (browser, non-interactive, best-effort, produces a draft) and admin/expert (Claude Code, Liz + admin, quality path for hard cases, can lock) — share **one curation protocol and one engine**. The protocol is the contract between the two front-ends; the difference is who the "expert" is.

### 8.2 What the loop does — six steps

```
1. Discover/Select  — which model (from available list, user-picked, or admin-targeted)
2. Probe            — E3 harness: identify mechanism (the 5), trace channel, billingProbe, off-guard behaviour
3. Classify         — from probe evidence: ReasoningControl (none/fixed-on/toggle/steps), ModelProfile, confidence
4. Soft flags       — freedomOriented/recommended/specialised/category (admin-set; agent proposes null/unknown)
5. Verify           — re-run suite against the derived spec, confirm behaviour = classification
6. Record           — evidence + spec + profile → draft (user) or published (admin); confidence: high on suite pass
```

The agent (a strong model — in the browser the runtime model, in Claude Code Liz) drives 2–5; the expert (when present) approves/edits specific fields at step 4 and reviews the classification.

### 8.3 The curation protocol — the shared contract

```ts
CurationSession {
  target: { canonicalRef?: string; providerId: string; upstreamSlug: string }
  probes: ProbeResult[]
  proposedSpec: DeclarativeAdapterSpec
  proposedProfile: ModelProfile
  proposedControl: ReasoningControl
  flags: {
    freedomOriented: null | true | false   // agent proposes null; admin/expert sets
    recommended: null                      // always null until admin
    specialised: false
    category: string[]                     // controlled vocab
  }
  billingProbeResult: { defect: boolean; autoAction: 'fixed-on' | null; reviewFlag: boolean; rationale: string }
  confidence: 'high' | 'medium'
  evidence: Evidence[]
  userNote?: string                        // short, surfaced as a small indicator (e.g. "reasoning cannot be disabled — verified: off still bills tokens, admin reviewing")
}
```

Both front-ends speak this protocol. The agent produces it; the expert (when present) reviews/edits `flags`, `proposedControl`, and confirms the `billingProbeResult` escalation. The engine is shared — a new `packages/curation-engine` (clean separation, per Chris); the front-ends are thin.

### 8.4 Mode (i): user-self — browser, non-interactive, best-effort

**The user cannot and must not judge hard calls.** So: the user clicks "curate this model for me" → the agent runs steps 2–5 *automatically*, without asking "how many steps do you want?" — the user cannot judge that, and that is exactly Chris's "non-interactive for non-experts" point.

- The agent derives `proposedControl` *from probe evidence* (not from user questions). Toggle if off-intent 400s; steps if effort takes discrete values; fixed-on if the billing-probe finds the off-only-hides defect.
- `flags`: agent proposes `null`/`unknown` (freedom/recommended = unassessed; category = []).
- Result: a **draft** (client-local, Dexie vault, private). The user can use the model immediately (for themselves) and can optionally propose (→ E5 admin queue).
- This is the "library" packaging — Project Émile's client surface: self-service model availability without waiting on an admin.
- `userNote`: the draft carries a short note for the small UI indicator (e.g. when the billing-probe auto-set fixed-on). The user sees the state in the cockpit anyway (reasoning toggle greyed); the note adds the *why*, without a wall of text. Exact UI form is the deferred presentation work.

### 8.5 Mode (ii): admin/expert — Claude Code, Liz + admin, quality path

Same engine, but the expert is in the loop — for the hard judgements the user-self mode cannot make:

- **Billing-defect interpretation:** user-self auto-sets `fixed-on` + flags; the expert decides whether the model is *really* fixed-on or whether a different mechanism applies (e.g. a steps-model whose off is only partially defective).
- **Soft flags set consciously:** freedomOriented, recommended, specialised, category — the admin sets these, not the agent.
- **Semantic-drift cases:** the five re-clarification triggers (ollama-think drift, ZDR-drift, mechanism-split) — expert judgements, not best-effort.
- **Lock:** an admin can *lock* a model — a locked published offering is admin-authoritative; user proposals for a locked model go to the queue but do not auto-apply. Lock is a boolean flag on the offering.
- Result: a **published** offering (versioned, rollback-capable, E2b), `confidence: 'high'`, instance-wide visible.

### 8.6 What unites and what separates the two modes

| | User-self (browser) | Admin/expert (Claude Code) |
|---|---|---|
| Driver | User ("curate for me") | Admin/expert (review, hard cases, lock) |
| Interactivity | **no** (agent does best-effort) | yes (expert in loop) |
| Soft flags | null/unknown | consciously set |
| Output | Draft (client-local, private) | Published (instance-wide, anonymised) |
| billingProbe defect | auto-fixed-on + flag | conscious decision |
| Confidence | medium (best-effort) | high (suite-verified + expert-reviewed) |
| Engine | **same** | **same** |
| Protocol | **same** | **same** |

### 8.7 Confirmed decisions

- **Engine location:** new `packages/curation-engine` (clean separation — Émile has its own identity).
- **Lock:** boolean flag on the published offering, admin-authoritative, no user overrides without re-review.
- **User-self `userNote`:** short field, surfaced as a small UI indicator; exact rendering is the deferred presentation work.

---

## 9. E5 — Admin Curation-Review Queue UI

### 9.1 Purpose

The admin surface that operates the contribution funnel: review open proposals, confirm billing-probe defects, set soft flags/display names/categories, lock models, escalate hard cases to Claude Code. Mechanics first — styling is Catppuccin Mocha (admin client), but that is a separate pass; this section is the functional surface.

### 9.2 The three views

**1. Proposal queue (the main entry surface)**

List of open proposals, per entry:
- Proposer + `(canonicalRef, providerId, upstreamSlug)` + status (`open` / `review-flagged`)
- Proposed spec + profile (what the user best-effort derived)
- `confidence` (medium for best-effort user proposals)
- Actions:
  - **Accept** → publish to all (versioned, anonymised, E2b). Demand fulfilled.
  - **Reject** → discard. **Demand signal remains** ("someone wanted this model") — the admin learns what users want even on rejection.
  - **Escalate to Claude Code** → "non-interactive was too weak for this case" → flag `escalated-needs-expert` with a **copyable task brief** (provider + slug + rationale), Liz + admin handle it (E4 mode ii).
- Filters: status, provider, confidence, "new since last review."

**2. Requires-review queue (billing-probe defects)**

- billingProbe auto-set `fixed-on` + `reviewFlag` + rationale → appears here.
- Admin/expert **confirms** the auto-action (yes, really fixed-on) or **overrides** (e.g. recognises: actually a steps-model with partial defect — off works for high/medium, just not low).
- The `rationale` is shown — the admin sees *why* the algorithm decided before confirming/overriding.

**3. Canonical editor (soft flags on `canonical_models`)**

- **Display-name editor** — against "GLM 5.2 voll super" / "DeepSeek V4 Flash Checkpoint von wanns heiß war." Admin sets the clean name.
- **Freedom tri-state** (null/true/false) — initially `null` (unassessed), admin sets consciously.
- **Recommended tri-state** (null/true/false).
- **Specialised** boolean.
- **Category multi-select** — controlled vocabulary, admin-extensible. New tags are added **consciously via an in-place modal** ("+ new tag" opens a short modal right where the category editor is, not a separate admin page, not en-passant typing) — disciplined without wildwuchs, but low-friction (Chris).
- **Lock toggle** — boolean, admin-authoritative, no user overrides without re-review.

### 9.3 The escalation path (E5 → E4 mode ii)

When the admin clicks "Escalate to Claude Code":
- The proposal is flagged `escalated-needs-expert`.
- A **copyable task brief** is shown in the admin client: provider + slug + rationale. Chris copies it, pastes into chat, Liz picks up E4 mode ii.
- **Manual handoff** — the admin client does not spawn anything automatic; it shows "this needs Liz" with the copyable brief. This matches how Chris and Liz actually work (Chris briefs, Liz executes) and avoids an automated admin-client→Claude-Code binding we do not need (Chris: "ein Anzeige im Adminclient, dass da 'was nicht ohne Liz geht' passt wunderbar").

### 9.4 The proactive admin path (not only reactive)

The admin can *proactively* curate a model with no proposal (e.g. a new model seen upstream). That is E4 mode ii, triggered by admin, not by proposal escalation. The proposal queue is *one* entry; proactive admin curation is a second. Both feed `published`.

### 9.5 What E5 is not

- Not the end-user presentation UX (the deferred question).
- Not the curation engine (E4) — E5 is the *surface* that drives the engine and consumes its outputs.
- Not styling — mechanics first; Catppuccin Mocha is a separate pass.

---

## 10. E6 — Drift & Re-Verification

### 10.1 Purpose

"Curated once" is really "curated once, periodically re-verified." Classifications have shelf-life — upstreams change models, wire semantics, billing, ZDR posture without announcement. E6 is the pipeline that detects drift and triggers re-curation.

### 10.2 Shelf-life model

Every published offering carries:
- `lastVerified: timestamp` — when the E3 suite last passed.
- `verifyBy: timestamp` — suggested re-verify date, **per-provider-churn** (short for wafer/novita, long for chutes), admin-overridable.
- `verifiedEvidence: ProbeResult[]` — the recorded evidence that re-probes diff against.

The dashboard surfaces **stale curations** (`verifyBy` past, or drift-detected) — the admin sees what needs re-verification.

### 10.3 The five drift signals → detection mechanisms

| Drift signal | Detection | Automatable? |
|---|---|---|
| **1. Semantic drift** (ollama `think:false` became a real off-switch; nothing changed our side) | **probe-diff** — re-probe shows different off behaviour than recorded | yes |
| **2. off-only-hides** (new instances in already-curated models) | **billingProbe re-run** (E3) | yes |
| **3. ZDR-drift** (provider changes ZDR posture; freedom flag stale) | **metadata-parser re-fetch** + provider announcement → freedom flag re-evaluation | yes (fetch) + admin (flag) |
| **4. Mechanism-split** (novita: model switches `enable_thinking`→`reasoning_effort`) | **probe-diff** — mechanism identification re-run shows a different mechanism | yes |
| **5. Device-screenshot defects** (runtime/API behaviour diverges from what the suite captured) | **manual/device verification** — Chris runs the device-tested steps; *future: user-reported defect channel feeds this trigger* | **no** (stays manual) |

Four of five are automatable; one stays manual (device-screenshot — that is Chris on the device, not automatable in CI, and correctly so). The pipeline automates what it can and flags the rest for manual verify.

### 10.4 Re-verify pipeline

**Triggers:**
- **Scheduled** — periodic (`verifyBy` reached; default per-provider-churn).
- **Event-driven** — provider announces a model change (if we learn of it).
- **Manual** — admin triggers rescan (or a user reports a defect — future channel).
- **Drift-detected** — probe-diff shows a deviation.

**Flow:**
```
trigger → E3 suite re-run against published offering
        → probe-diff against verifiedEvidence
        → drift?
            no → lastVerified updated, verifyBy += shelf-life
            yes → offering flagged "stale, needs re-verification"
                → admin/expert re-curates (E4 mode ii)
                → new versioned offering (E2b, rollback-capable)
                → old remains until admin swaps
```

### 10.5 Relationship to the curation loop

E6 *drives* the same E3 engine as E4 — it is not separate verification logic. The difference: E4 curates a *new/unknown* model; E6 re-verifies a *known* one against its recorded evidence. Same suite, same factory path, different entry (published offering + verifyBy vs. available model + best-effort).

---

## 11. Sequencing

The implementation plan phases this; the sequence is:

1. **E1** first — enabler and safety net. "E1 brauchen wir sowieso." A reducing refactor; the suite pins every wire form.
2. **E2a / E2b** — the backend can hold a catalogue. Base-set JSON seed + metadata parser + tables + ADR. Lands with the backend (v0.3.0).
3. **E3** — the probe-harness + billing-probe, factory-consuming.
4. **E4** — the agentic loop, two modes via the shared engine.
5. **E5** — the admin review-queue UI.
6. **E6** — drift & re-verification on what exists.

The first testable step is "curation is now data-driven instead of code" (E1 + E2a seed), tested before expanding into the contribution funnel and presentation UX.

---

## 12. Open Items (parked, not decided)

1. **Proposer attribution on published curations.** The privacy gradient says published is anonymised (no proposer). But the admin queue shows proposer identity (for abuse detection). The open question: should the published artefact's proposer be stripped entirely (anonymised even to the admin post-acceptance), or retained as admin-visible metadata? Chris is thinking about this — no quick shot. Recorded as an Open Question in the ADR (E2b).
2. **End-user presentation UX** — how `available`-vs-`curated` surfaces in the model picker. Deferred until we stand in front of it.

---

## 13. Out of Scope / Future

1. **User-reported defect channel** — a future E6 input source where users report "this model behaves weird," feeding the manual re-verify trigger (drift signal 5). Users as co-creators catching drift no suite sees. Recorded here; not in first scope.
2. **Exact scheduling infrastructure** for periodic re-verification (cron/queue) — an ops/plan concern.
3. **Automated device-screenshot verification** — stays manual by design.
4. **Category-vocabulary governance** beyond the in-place modal — e.g. merging/aliasing tags. Future if wildwuchs appears despite the conscious-add discipline.

---

## 14. Manual Verification

Chris runs these on the device that matters, after each unit lands:

- **E1:** the re-expressed declarative adapters produce byte-identical wire bodies to the hand-written originals for the 11 existing offerings (suite pins this, but a device-level chat against GLM 5.2 / Kimi K3 / Grok 4.5 confirms no behavioural regression). Reasoning on/off/toggle/steps all behave as before on a real chat.
- **E2a:** a fresh backend boot absorbs `base-curation.json` and the known models appear operational without anyone curating. Adding an Ollama endpoint lists its models in the available list, marked "unverified." A seed update adds a new canonical without clobbering an admin-set display name.
- **E2b:** a proposal accepted from a test user appears as a published offering (anonymised) visible to a second user. Rejecting a proposal leaves a demand signal. Rolling back a faulty re-curation restores the prior offering.
- **E3:** against a known off-only-hides model (Opus-5 or Grok-4.5 class), the billing-probe flags the defect and the suite marks the model fixed-on. The comparative fallback catches the same on an ollama-native model (no `reasoning_tokens` field).
- **E4 (user-self):** clicking "curate for me" on an available model produces a working draft in under a minute, usable immediately, no questions asked. The reasoning control the agent derives matches what a manual probe would set.
- **E4 (admin/expert):** escalating a weak proposal and running it in Claude Code produces a `high`-confidence published offering. Locking a model prevents a user proposal from auto-applying.
- **E5:** the admin queue accepts/rejects/escalates with a copyable task brief. The requires-review queue shows a billing-probe rationale and an override works. The category modal adds a new tag consciously. Display-name edits stick across a seed update.
- **E6:** a model whose upstream silently changes off-semantics (ollama `think:false` scenario) is flagged stale on the next scheduled re-probe, and re-curation produces a versioned offering with the old one restorable.

---

## Pointers

- Adapter contract: `packages/llm-unified/src/adapter-contract.ts`
- Reasoning control + model profile: `packages/llm-unified/src/catalogue/types.ts`
- The off-guard formula: `packages/llm-unified/src/adapters/openrouter-openai.ts:158`
- Wire composition: `packages/llm-unified/src/stream-completion.ts` (`composeWire`)
- ollama-native adapter (the one second message dialect): `packages/llm-unified/src/adapters/ollama-native.ts`
- The "two wire paths" lesson: `obsidian/insights/` 2026-07-17
- Prior adapter-analysis (circulated): `obsidian/synthesis/2026-08-04-declarative-adapter-analysis.md`
- Related ADRs: 0031 (roadmap), 0032/0037 (premium routing), 0036 (desktop)
- The `/curate` skill: `.claude/skills/curate/SKILL.md`
- Model records (today's curation output): `obsidian/models/*.md`
- Freedom rubric: `obsidian/FREEDOM-CRITERIA.md`