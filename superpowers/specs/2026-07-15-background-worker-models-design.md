# Background-worker models — Design Spec

**Date:** 2026-07-15
**Author:** Liz
**Status:** IMPLEMENTED. Laura spec-pass (1 HARD + 5 soft, all folded) →
built → **Laura pre-squash CLEAR (no hard defects; 2 non-blocking softs)**.
Gates green: typecheck 14/14, build 9/9, llm-unified 425/425, full user-client
vitest at the doorbell-flake baseline, Biome clean.
**Audit path:** Not Larissa (no crypto/auth/sync/proxy). Laura spec-pass done
(a new user-reachable persona field, a conditional warning, and a greeting toggle).

> **Laura spec-pass (2026-07-15):** primary placement (helper slot beneath the
> main model in the hub) **confirmed**; disabled-over-hidden greeting toggle
> **confirmed correct**; the "helper" framing is behaviourally honest. **HARD-1**:
> the warning copy misdirected toward changing the *main* model → fixed (§4.B, now
> points to the helper below, never "a different model"). Softs folded: "Models"
> subgroup, narrower-list explainer line, "helper" not "assistant", the greeting
> toggle's disabled-reason precedence + cross-page "where" (§4.B / §4.D). No
> blocking structural defect.

---

## 1. Problem

Some models reason and then stop — they emit a full chain of thought and never
produce a final answer. The DeepSeek family is the current offender. In the
interactive chat this is merely annoying: the user hits **Regenerate**. But the
same failure is silent and destructive for the invisible **background chores**
that also drive a model: **title generation, the memory pipeline
(extraction / auto-commit / dreaming), and compaction**. There is no user in the
loop to press Regenerate, so a persona on a DeepSeek model quietly gets no chat
titles, no memory, and no compaction.

We accept a small, conscious deviation from **omakase** here (§11): a functioning
app beats a purist single-model persona. We give the user a way to nominate a
second, *reliable* model that runs the persona's background chores while the
persona's own (possibly fancy, possibly problematic) model stays in the
conversation. We wrap it in a Chatsundere framing so it reads as a warm helper,
not a technical escape hatch.

---

## 2. Goals

1. Mark models that misbehave as background workers in the catalogue metadata
   (currently: all DeepSeek canonicals).
2. Give each persona an **optional** second model slot — its background helper.
   Empty is the normal, unwarned state. When the persona's *main* model is a
   flagged model, surface a constructive warning nudging the user to pick a
   helper.
3. Filter that helper list harder than the main picker: only models that do
   **not** resolve to *restricted* freedom, and never a flagged model itself.
4. Route the background chores (title, memory, compaction) through the helper
   model when one is set; fall back to the persona's own model otherwise.
5. Offer — per persona, opt-in — to let the helper write the **greeting** too.

## 3. Non-goals

- No change to the global "expert" features (ask-expert, artefact-expert). They
  keep their own settings-level offering refs.
- No per-*deployment* background flag. Suitability is model-intrinsic, so it
  lives on `CanonicalModel`, not `Offering`.
- No server change, no `shared-types` change (the catalogue is client-side).
- **No Dexie schema bump.** Every new persona field is optional and non-indexed
  (established pattern — artefact-expert, memory fields). `providerId` stays the
  only indexed persona field.
- No automatic greeting override. The greeting is user-visible content; the
  helper touches it only behind an explicit per-persona toggle.

---

## 4. Design

### 4.A Step 1 — flag problematic models (`packages/llm-unified`)

Add one optional field to `CanonicalModel`
(`packages/llm-unified/src/catalogue/types.ts`):

```ts
/** The model tends to emit reasoning and then stop, producing no final answer.
 *  Fine for interactive chat (the user regenerates); unreliable for the
 *  unattended background chores. Absent ⇒ suitable. */
unsuitableAsBackgroundWorker?: boolean;
```

Optional (absent ⇒ suitable) so the 31 unaffected canonicals are untouched;
`freedomOriented` stays the tri-state it is. Mirror the field in
`CanonicalSchema` (`schema.ts`) as `v.optional(v.boolean())` — the two must move
together (Valibot-validated).

Set `unsuitableAsBackgroundWorker: true` on the three DeepSeek canonicals in
`canonical-registry.ts` (`deepseek-v3.2`, `deepseek-v4-flash`, `deepseek-v4-pro`).
No other family qualifies today. Because the flag is per-canonical and explicit,
adding or removing a model from the list later is a one-line change with no
`family`-string coupling.

A small public predicate keeps call sites honest:

```ts
// catalogue/index.ts (re-export)
export function isUnsuitableAsBackgroundWorker(m: CanonicalModel): boolean {
  return m.unsuitableAsBackgroundWorker === true;
}
```

### 4.B Step 2 — the helper slot on the persona (`apps/user-client`)

**Data.** Three new optional, non-indexed fields on `PersonaRow`
(`boot/client-data-db.ts`), mirroring the main tuple:

```ts
/** Background-helper model — runs this persona's background chores (title,
 *  memory, compaction) instead of the persona's own model. null/absent ⇒ unset
 *  → the persona's own model runs the chores. */
backgroundCanonicalId?: string | null;
backgroundProviderId?: string;
backgroundModelId?: string;
```

Unset is `backgroundCanonicalId` absent or `null`. `defaultDraft` sets
`backgroundCanonicalId: null` (helper fields omitted otherwise). No migration.

**Picker filter.** Extend the picker's filter axis in
`components/model-picker/model-picker-data.ts`. `ModelFilter` gains a
`'background-worker'` value. In `buildPickerData`:

- Per-offering: in `'background-worker'` mode, additionally require
  `effectiveFreedom(canonical.freedomOriented, offering.freedomOrientedDeployment) !== 'restricted'`
  (so `'free'` and `'unknown'` both stay — Chris's call 2026-07-15; only
  *proven* censorship is excluded).
- Per-canonical: drop any canonical with `isUnsuitableAsBackgroundWorker` — a
  flagged model cannot be its own backup.

(`'background-worker'` implies no vision requirement; the two axes don't need to
compose here.)

**UI — where it lives.** **Primary placement (Laura spec-pass confirmed):**
directly **beneath the main Model slot in the persona hub**
(`routes/app/persona/hub.tsx`, the Identity section), so the warning appears
exactly where the problematic choice was made — co-locating the remedy with the
choice (Laura: the alternative manufactures click-depth and buries the override
for the majority of non-flagged personas). A second `ModelSlotPicker` with
`filter="background-worker"`, `label="Background helper"`,
`emptyLabel="Optional — pick a reliable helper"`, writing
`backgroundCanonicalId` / `backgroundProviderId` / `backgroundModelId`. It clears
back to unset via the picker's existing "Use none" clear affordance. The main and
helper slots are **wrapped in one small "Models" subgroup** so the eye reads them
as a pair, not a fourth loose Identity field (Laura SOFT — ND-friendly density).

Because the helper picker is filtered harder than the main one (no *Censored*
models, no flagged think-only models), it silently omits entries the main picker
shows. One quiet line in the helper picker's empty/header area explains the
narrower list so its absence is understood, not mysterious (Laura SOFT):
> Censored and think-only models can't be helpers.

**The warning.** Shown only when the persona's **main** canonical is flagged
**and** no helper is set. It must point the user **down to the helper slot**, and
must **not** tell them to change their main model — the whole point is to *keep*
the chosen main model in the conversation and add a reliable helper for the
chores (Laura HARD-1: the original "pick a different model here" actively
misdirected toward abandoning the deliberately-chosen model):

> This model sometimes only thinks and never answers, which breaks background
> chores like chat titles and memory. Pick a reliable helper below to run them
> for you.

The word **"below"** (or a direct tie to the helper field) is load-bearing.
(British English; final *deredere* phrasing is Chris's to arbitrate, but the
*direction* — toward the helper, never away from the main model — is a HARD build
mandate.) The warning is a soft, inline, non-blocking cue (not a hard gate — the
persona still functions, just without reliable chores). It **clears the moment a
helper is chosen**, so it reads as a resolvable nudge, not a nag.

**Chatsundere twist (copy, Chris-arbitrated).** Frame the slot as the persona's
quiet **helper** who takes care of the background chores (titles, remembering)
while the persona herself stays in the conversation — rather than a technical
"background worker model" label. Use **"helper"**, not "assistant" (Laura SOFT:
"assistant" collides with "the AI assistant" and risks reading as a second
conversational voice). Proposed surface label **"Background helper"**; open to
Chris's wording.

### 4.C Step 3 — route the chores through the helper

Today title / memory-on-send / compaction-valve / greeting all inherit the single
`offering` produced by `resolvePersonaContext` (`data/send-message.ts:147`);
manual memory and manual compaction resolve independently
(`memory/resolve-args.ts:40`, `stream-manager.store.ts:315`).

Introduce one shared resolver so the rule lives in exactly one place:

```ts
// data/resolve-background-offering.ts (new)
/** The offering that should run this persona's background chores: the helper
 *  model when set AND reachable, else the persona's own offering. Background
 *  chores are best-effort and invisible, so an unreachable helper (deleted
 *  provider row / missing key) degrades silently to the main offering rather
 *  than surfacing an error. */
export function resolveBackgroundOffering(
  persona: PersonaRow,
  providers: ProviderRow[],
  mainOffering: Offering,
): Offering
```

Threading:

- `resolvePersonaContext` computes `backgroundOffering` alongside `offering` and
  adds it to `PersonaContext`. The **interactive** send + streaming keep
  `offering`; the fire-and-forget chores switch to `backgroundOffering`:
  `fireTitleGen`, `fireMemoryPipeline`, `fireCompactionValve`
  (`stream-manager.store.ts:197–276`) receive/read `backgroundOffering` instead
  of reusing `args.offering`.
- `resolveMemoryPipelineArgs` (manual memory) and `compactNow` (manual
  compaction) call `resolveBackgroundOffering` on the same inputs.

The override applies **whenever a helper is set**, independent of whether the
main model is flagged — the flag only drives the *warning*, the field is a
general chore override.

### 4.D Step 4 — offer the helper for the greeting

New optional field on `PersonaRow`:

```ts
/** Let the background helper write the opening greeting too. Absent ⇒ false
 *  (the persona's own model greets). Only meaningful when a helper is set. */
greetingUsesBackgroundModel?: boolean;
```

A toggle in the greeting section (`routes/app/persona/roleplay.tsx`, where
`greetingEnabled` / `greetingInstructions` already live), labelled e.g.
**"Let the helper write the greeting"**. Keep its copy off "behind the scenes" —
here the helper produces visible, in-character content (Laura SOFT). Per §11
*disabled over hidden*: the toggle is always shown but **disabled-with-reason**.

The greeting block already disables when Roleplay is off; this toggle adds a
third gate (no helper set). The disabled reason must name the **true first
blocker** in precedence order **roleplay-off → greeting-off → no-helper** so it
never misleads (Laura SOFT-3). The no-helper reason must also say **where** the
helper is set, since it lives on a different page (Laura SOFT-2):
> Set a background helper on the persona's main screen first.

Resolution: `useStartOpener` (`data/send-message.ts:459`) already holds the
`PersonaContext`; it picks `ctx.backgroundOffering` when
`persona.greetingUsesBackgroundModel === true` **and** a helper is actually set,
else `ctx.offering`. (The `resolveBackgroundOffering` reachability fallback still
applies, so a stale helper degrades to the persona's own model.)

---

## 5. Touched files (expected)

**`packages/llm-unified`**
- `src/catalogue/types.ts` — `unsuitableAsBackgroundWorker?` on `CanonicalModel`.
- `src/catalogue/schema.ts` — matching Valibot field.
- `src/catalogue/canonical-registry.ts` — flag the three DeepSeek canonicals.
- `src/catalogue/index.ts` — re-export `isUnsuitableAsBackgroundWorker`.

**`apps/user-client`**
- `src/boot/client-data-db.ts` — four optional `PersonaRow` fields (no migration).
- `src/routes/app/persona/persona-draft.ts` — draft defaults.
- `src/components/model-picker/model-picker-data.ts` — `'background-worker'`
  filter (freedom + suitability predicates).
- `src/routes/app/persona/hub.tsx` — helper slot + warning (primary placement).
- `src/routes/app/persona/roleplay.tsx` — greeting-helper toggle.
- `src/data/resolve-background-offering.ts` — **new** shared resolver.
- `src/data/send-message.ts` — `backgroundOffering` on `PersonaContext`; greeting
  resolution.
- `src/memory/resolve-args.ts` — manual-memory background resolution.
- `src/state/stream-manager.store.ts` — fire-fns read `backgroundOffering`;
  `compactNow` background resolution.
- `src/components/ModelSlotPicker.tsx` (+ `ModelPickerField`/`ModelPickerModal` as
  needed) — thread the new filter value; confirm a clear-to-unset affordance.

## 6. Testing

- **llm-unified** (`bun test`): the three DeepSeek canonicals report
  `isUnsuitableAsBackgroundWorker === true`; a representative non-DeepSeek
  (e.g. a GLM / Kimi) reports false; `CanonicalSchema` round-trips the new field
  (present + absent).
- **Picker filter** (vitest): `buildPickerData(..., 'background-worker')` excludes
  every flagged canonical and every offering resolving to `'restricted'`, while
  keeping `'free'` and `'unknown'`; `'all'` is byte-unchanged.
- **`resolveBackgroundOffering`** (vitest): unset ⇒ main; set + reachable ⇒
  helper; set + unreachable (missing provider row / not in configured set) ⇒ main
  (silent fallback).
- **Persona draft** (vitest): defaults leave the helper unset and
  `greetingUsesBackgroundModel` falsey.
- **Warning gate** (vitest): visible iff main canonical flagged **and** helper
  unset; clears once a helper is set. The copy points at the helper slot and
  never instructs a main-model change (HARD-1 regression guard).
- **Greeting resolution** (vitest): opener uses helper iff
  `greetingUsesBackgroundModel && helper set`, else main. Disabled-reason
  precedence: roleplay-off → greeting-off → no-helper, each naming its true
  blocker.
- Full user-client vitest at the standing 8-Node-localStorage baseline; llm-unified
  suite green; `pnpm typecheck --force` 14/14; `pnpm build` 9/9; Biome clean.

## 7. Manual verification (Chris, on device)

1. Persona on a DeepSeek model, no helper → the warning shows under the model
   slot; chat titles / memory do **not** generate (status quo, confirms the bug).
2. Pick a reliable helper (e.g. a nano-gpt GLM) → warning clears; send a message
   → a chat title appears and memory extraction runs, driven by the helper; the
   reply itself still streams from DeepSeek.
3. Confirm the helper picker offers no DeepSeek entry and no *Censored*-badged
   (restricted) model; `'unknown'`-freedom models remain offered.
4. Set the greeting-helper toggle (only enabled once a helper is set); start a new
   chat with greeting enabled → the greeting is produced (by the helper) rather
   than silently failing on DeepSeek.
5. Delete the helper's provider → background chores silently fall back to the
   persona's own model (no error surfaced on the invisible chores).
6. A persona with **no** helper and a non-flagged model → no warning, chores run
   on its own model exactly as before (no regression).
