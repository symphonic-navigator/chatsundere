# Model Catalogue Data Model — Design

- **Date:** 2026-05-29
- **Status:** Draft
- **Author:** Liz (Claude Code), brief-led with Chris
- **Package:** `packages/llm-unified` (types may later move to `packages/shared-types`)
- **Related:** [adapter-synthesis spike](2026-05-29-agentic-adapter-synthesis-design.md);
  supersedes the static `knownModels` / `_nano-gpt-pairs` / `_reasoning-body`
  approach in `packages/llm-unified`.

---

## 1. Context & Motivation

Today `packages/llm-unified` carries a **static, per-provider** model list:
`ProviderDefinition.knownModels: KnownModel[]`, a hand-maintained nano-gpt
slug-pair map, and a per-provider reasoning-translation switch. This drifts, is
never complete, and — as the synthesis spike proved empirically — encodes
**wrong** assumptions (e.g. `reasoning.kind: 'optional'` where a provider
actually behaves differently). It also forces a **provider → model** selection
flow, which buries the thing the user actually cares about (the model) under the
plumbing (which provider).

This spec defines the data model that replaces it, enabling:

- **Model-first selection.** The user picks a *model* (its character, freedom,
  intelligence); we show *which providers* offer it and at what trade-offs.
- **Per-offering truth.** The same model behaves differently per provider
  (nano-gpt buffers tool calls; another provider may stream them; reasoning
  control differs; context ceilings and pricing differ). Behaviour lives on the
  offering, not the model.
- **Curated vs uncurated, cleanly separated.** A curated catalogue (model-first)
  and a separate "Your Endpoints" surface (provider-first) for local/LAN/sidecar
  and any model we have not curated — honest best-effort, never mixed with the
  curated experience.
- **First-class trust and freedom signals.** Privacy (TEE/ZDR) and Freedom
  (uncensored within EU law) are differentiators for Chatsundere and must be
  representable and displayable.

## 2. Scope

**In scope:**
- The two core entities (`CanonicalModel`, `Offering`) and the capability gate.
- The behavioural `profile` shape (reasoning control taxonomy, tool-call facts,
  vision), extending the spike's `ModelProfile`.
- `context: { recommended, max }`, trust flags, and the freedom signals.
- The **data contract** of the two surfaces (Catalogue, Your Endpoints) and how
  uncurated discovery populates the latter.
- The curation definition of "freedom oriented".
- The relationship to, and supersession of, the current static model data.

**Deferred (named):**
- Catalogue **delivery/signing** as a pulled feed → the maintainer pipeline
  (separate spec).
- Full **UI implementation** of the two surfaces (this spec defines their data
  contract only).
- Runtime UX hooks the model *enables* (e.g. constructive-error handling when a
  censoring deployment returns HTTP 400) — noted, not specified here.
- The **migration** mechanics off `knownModels` — direction stated here, steps
  belong to the implementation plan.

## 3. Core Entities

```ts
/** Curated identity in our own stable namespace. This is what the user picks. */
interface CanonicalModel {
  id: string;            // 'deepseek-v4-pro' — our kebab-case id, provider-independent
  displayName: string;   // 'DeepSeek V4 Pro'
  family: string;        // 'deepseek-v4' — grouping / sorting
  /** Hard capabilities that DEFINE the identity. An offering must deliver all of these. */
  requiredCaps: { tools: boolean; reasoning: boolean; vision: boolean };
  /** Model-intrinsic freedom (baked-in refusals). null = not yet assessed. See §6. */
  freedomOriented: boolean | null;
  /** Transparency: what restricts it, for fuzzy/borderline cases. */
  freedomNote?: string;
  notes?: string;
}

/** One per upstream endpoint: (provider × upstream slug × variant). Curated OR discovered. */
interface Offering {
  /** The CanonicalModel this realises, or null for uncurated / local models. */
  canonicalRef: string | null;
  /** References a ProviderDefinition (the connection: baseUrl, auth, probe, corsHint). */
  providerId: string;
  /** What goes on the wire, e.g. 'zai-org/glm-5.1' or 'TEE/glm-5.1'. */
  upstreamSlug: string;
  /** Per-offering adapter (generated/curated), or the generic OpenAI adapter for discovered. */
  adapter: AdapterRef;
  /** Per-offering measured behaviour. */
  profile: ModelProfile;
  /** Recommended (quality/cost sweet-spot) and hard maximum context. See §5. */
  context: { recommended: number; max: number };
  /** Privacy signals → 🔒 badge. */
  trust: { tee: boolean; zdr: boolean; jurisdiction?: string };
  /** Deployment-level freedom (provider-added censorship). null = unknown. See §6. */
  freedomOrientedDeployment: boolean | null;
  source: 'curated' | 'discovered';
  confidence: 'verified' | 'partial' | 'heuristic';
}

type AdapterRef =
  | { kind: 'catalogue'; adapterId: string } // a curated/generated adapter shipped in the catalogue
  | { kind: 'generic' };                      // the hand-written generic OpenAI-compatible adapter
```

**Capability-gate invariant.** An `Offering` with `canonicalRef = X` is only a
valid offering of `CanonicalModel X` if it delivers **every** capability in
`X.requiredCaps`. A provider that drops vision on a vision-required model yields
no valid offering — it is excluded during curation. (Uncurated offerings have
`canonicalRef: null` and are not gated.)

**No routing / no failover.** Offerings are never chained or auto-substituted.
The user picks a model, then picks an offering. Offerings are *sorted* for
display (e.g. privacy-first, recommended-first) but the system never silently
fails over to another provider — this avoids billing chaos across accounts and
keeps the trust story legible.

**TEE / non-TEE = two offerings.** A single provider may serve the same model
in a standard and a TEE deployment (e.g. nano-gpt's `zai-org/glm-5.1` and
`TEE/glm-5.1`, the latter using `-thinking` rather than `:thinking` — a
nano-gptism). These are two `Offering`s under one `CanonicalModel`, one provider,
each with its **own adapter** (the slug-swap convention differs) and its own
profile — and probed/generated **separately**, since they may behave differently.

## 4. Behavioural Profile (per offering)

Extends the spike's `ModelProfile` (`adapter-contract.ts`). The reasoning part
is replaced by a control taxonomy that drives the UI directly:

```ts
type ReasoningControl =
  | { mode: 'none' }                                  // UI: always-off, shown disabled
  | { mode: 'fixed-on' }                              // UI: always-on (incl. "off only hides")
  | { mode: 'toggle'; defaultOn: boolean }            // UI: on/off switch
  | { mode: 'steps'; steps: string[]; offStep: string | null; defaultStep: string };
                                                      // UI: step selector; offStep names the
                                                      // step (if any) that means reasoning-off
                                                      // (covers None/Low/Med/High with None=off
                                                      // and On/Off + extra steps via offStep)

interface ModelProfile {
  reasoning: ReasoningControl;
  toolCalls: { supported: boolean; streaming: boolean; concurrentWithReasoning: boolean };
  vision: boolean;
  /** Hard-CoT models replay thinking into history; soft-CoT do not. Curated/metadata. */
  replayReasoning: boolean;
}
```

`confidence` lives on the `Offering` (§3), not the profile — it characterises how
well we know the whole offering. The spike's `ModelProfile.confidence` field is
folded into `Offering.confidence` here.

`context` moves OUT of the profile to the `Offering` as `{ recommended, max }`
(it is provider-specific, see §5). What the synthesis pipeline can *measure*
(reasoning control mode, tool-call streaming/concurrency, vision-in-stream)
populates the profile; fields no probe can determine (`replayReasoning`, context
sizes, freedom) are **injected from curation/metadata**, never synthesised — the
synthesis-spike's profile-validation already enforces this boundary.

## 5. Context: recommended + max

Two sizes, because marketing context windows lie:

- `recommended` — the window within which the model stays *smart and affordable*.
  Many models degrade sharply past 150–200k (attention dilution / positional
  unreliability) despite advertising "1M"; some get more expensive past a
  threshold. This is a **human judgement** recorded during curation.
- `max` — the hard ceiling the endpoint accepts.

`recommended` drives the Context-Gauge (the existing `KnownModel.contextWindow`
already carries "recommended" semantics — this formalises it and adds `max`).
Both live on the `Offering` because pricing/ceiling thresholds are
provider-specific, even though degradation is largely model-intrinsic.

## 6. Trust and Freedom (two independent badges)

**Privacy (🔒).** From `Offering.trust` — `tee` (Trusted Execution Environment)
and `zdr` (Zero Data Retention), with optional `jurisdiction` (e.g. `'EU'` for an
EU ZDR provider). Curated.

**Freedom (🕊️).** Two orthogonal levels combined at display time:

- `CanonicalModel.freedomOriented` — model-intrinsic (baked-in refusals).
- `Offering.freedomOrientedDeployment` — provider-added censorship (e.g.
  geo-routing through a censoring jurisdiction, an HTTP-400 content filter).
- `effectiveFreedom = canonical.freedomOriented && offering.freedomOrientedDeployment`,
  rendered as a **three-state badge: free / restricted / unknown**. `null` on
  either side → `unknown` (absence of evidence is not evidence of restriction);
  this is the honest default for uncurated offerings.

Independent of Privacy: a TEE/ZDR provider may still censor; a non-TEE provider
may be fully free. Example: nano-gpt serving MiMo V2.5 Pro → model `true`,
deployment `false` (routed through China) → **restricted**.

**Curation definition of `freedomOriented` (→ Provider Integration Policy).** A
model is freedom-oriented when:

1. it does not patronise, hedge, or fear the user;
2. it does not suppress legal (within ordinary EU law) expressions of adult life;
3. it has no problem with fictional contexts.

Yardstick: *it may say anything legally purchasable in the adult section of a
bookshop in Vienna, Brussels, Berlin, Paris, Madrid, Warsaw, or Sofia.* Political
refusals are a tolerated exception (some models cannot discuss e.g. Tiananmen
1989 even on Western compute) — not disqualifying, but recorded in `freedomNote`.
Representation is **boolean + note**; fuzzy/borderline cases are a curator's
single-call judgement (e.g. GLM 4.6 → free; GLM 4.7 → borderline, subsumed as
unfree).

## 7. The Two Surfaces (data contract)

**Catalogue (model-first, curated).** Lists `CanonicalModel`s (grouped by
`family`). Under each: its valid `Offering`s as rows showing the trade-offs —
provider, tool-call streaming, `recommended/max` context, reasoning control,
and the 🔒/🕊️ badges. Display-sorted (privacy/recommended), never failover.

**Your Endpoints (provider-first, uncurated).** Lists configured providers
(direct, and later LAN / wss-sidecar homelab). Each expands its **discovered**
models from `/models` (OpenAI-compatible) or `/tags` (Ollama) into `Offering`s
with `canonicalRef: null`, `adapter: { kind: 'generic' }`, a
`conservativeProfile`, `confidence: 'heuristic'`, and `unknown` freedom. Clearly
labelled best-effort. This is where local/LAN/sidecar models live; they are
never mixed into the curated Catalogue.

## 8. Relationship to Existing Code

- `ProviderDefinition` (the *connection*: `baseUrl`, `configFields`, `probe`,
  `secretFields`, `corsHint`) **survives** largely unchanged.
- `ProviderDefinition.knownModels`, `_nano-gpt-pairs.ts`, and
  `_reasoning-body.ts` are **superseded** by per-offering adapters + profiles.
  Their behaviour is absorbed into generated/curated adapters.
- The spike's `ModelProfile`/`conservativeProfile` (`adapter-contract.ts`) are
  the seed; this spec extends them (§4).
- Type placement: the pure data shapes (`CanonicalModel`, `Offering`,
  `ModelProfile`) may move to `packages/shared-types` (MIT) so the client can
  consume them without the LGPL adapter code; the adapter implementations stay
  in `packages/llm-unified`. Decided at plan time.

The migration is the "improve the code you are working in" kind — its mechanics
belong to the implementation plan, not this spec.

## 9. Open Questions / Risks

- **Catalogue physical shape & delivery** — defined by the maintainer-pipeline
  spec (next). This spec assumes the client receives a catalogue (list of
  `CanonicalModel` + `Offering`) plus adapter blobs; the wire/feed format and
  signing are out of scope here.
- **Adapter storage for `AdapterRef.catalogue`** — how a curated adapter blob is
  referenced, fetched, and run client-side (sandbox) ties into the pipeline +
  the deferred production-iframe boundary.
- **Step encoding** for `ReasoningControl.steps` across genuinely odd providers
  may need refinement once we curate a model that combines an on/off toggle with
  effort steps; the `offStep` field is the intended handle.

## 10. Manual Verification (Chris confirms the model represents reality)

The data model is validated by representing these real cases without contortion:

1. **GLM 5.1 on nano-gpt, TEE + non-TEE** → one `CanonicalModel`, two `Offering`s
   under one provider, different `upstreamSlug` (`zai-org/glm-5.1:thinking` vs
   `TEE/glm-5.1-thinking`), different adapters, `trust.tee` true on one.
2. **Split freedom (MiMo V2.5 Pro on nano-gpt)** → `CanonicalModel.freedomOriented
   = true`, `Offering.freedomOrientedDeployment = false` → badge renders
   **restricted**.
3. **Same model, divergent behaviour across providers** → two `Offering`s with
   different `profile.toolCalls.streaming` and different `ReasoningControl`
   (effort vs toggle), both valid under the capability gate.
4. **Uncurated local Ollama model** → `Offering` with `canonicalRef: null`,
   generic adapter, conservative profile, heuristic confidence, `unknown`
   freedom — appears only in "Your Endpoints".
5. **Capability gate** → a provider serving a vision-required model without
   vision yields no valid catalogue offering.
