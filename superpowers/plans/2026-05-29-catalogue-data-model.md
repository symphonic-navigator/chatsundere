# Catalogue Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the catalogue data model (`CanonicalModel`, `Offering`, `ReasoningControl`, evolved `ModelProfile`) with Valibot validation, the capability gate, and effective-freedom derivation — the foundation the Curation CLI (separate plan) builds on.

**Architecture:** Pure TS types + Valibot schemas + small pure functions in a new `packages/llm-unified/src/catalogue/` subtree. `ModelProfile` migrates from the spike's `ReasoningCapability`-based shape to a UI-driving `ReasoningControl` union; `contextWindow` and `confidence` move off the profile onto the `Offering`. All existing synthesis tests stay green through the migration.

**Tech Stack:** TypeScript (strict), Bun test runner, Valibot (new dep for `@chatsundere/llm-unified`), Biome.

**Spec:** `superpowers/specs/2026-05-29-model-catalogue-data-model-design.md`

**Conventions:** British English. Free-form imperative commits, trailer `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Before each commit run `bunx @biomejs/biome check --write <files>`. Tests: `bun test` from `packages/llm-unified`. Typecheck: `pnpm --filter @chatsundere/llm-unified typecheck`.

---

## Task 1: Add Valibot + catalogue types

**Files:**
- Modify: `packages/llm-unified/package.json` (add `valibot` dependency)
- Create: `packages/llm-unified/src/catalogue/types.ts`
- Test: `packages/llm-unified/src/catalogue/types.test.ts`

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @chatsundere/llm-unified add valibot`
Expected: `valibot` appears under `dependencies` in `packages/llm-unified/package.json`.

- [ ] **Step 2: Write the failing test**

```ts
// catalogue/types.test.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { isReasoningControl } from './types.js';

describe('isReasoningControl', () => {
  it('accepts each of the four control modes', () => {
    expect(isReasoningControl({ mode: 'none' })).toBe(true);
    expect(isReasoningControl({ mode: 'fixed-on' })).toBe(true);
    expect(isReasoningControl({ mode: 'toggle', defaultOn: true })).toBe(true);
    expect(
      isReasoningControl({ mode: 'steps', steps: ['off', 'low'], offStep: 'off', defaultStep: 'low' }),
    ).toBe(true);
  });

  it('rejects an unknown mode', () => {
    expect(isReasoningControl({ mode: 'wat' })).toBe(false);
    expect(isReasoningControl(null)).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/catalogue/types.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement**

```ts
// catalogue/types.ts
// SPDX-License-Identifier: LGPL-3.0-only

/** How the user steers reasoning — drives the cockpit UI directly. */
export type ReasoningControl =
  | { mode: 'none' } // UI: always-off, shown disabled
  | { mode: 'fixed-on' } // UI: always-on (incl. "off only hides")
  | { mode: 'toggle'; defaultOn: boolean } // UI: on/off switch
  | { mode: 'steps'; steps: string[]; offStep: string | null; defaultStep: string };

/** Per-offering measured behaviour. (Context + confidence live on the Offering.) */
export interface ModelProfile {
  reasoning: ReasoningControl;
  toolCalls: { supported: boolean; streaming: boolean; concurrentWithReasoning: boolean };
  vision: boolean;
  /** Hard-CoT models replay thinking into history; soft-CoT do not. */
  replayReasoning: boolean;
}

/** Curated, provider-independent identity. What the user picks. */
export interface CanonicalModel {
  id: string;
  displayName: string;
  family: string;
  requiredCaps: { tools: boolean; reasoning: boolean; vision: boolean };
  /** Model-intrinsic freedom; null = not yet assessed. */
  freedomOriented: boolean | null;
  freedomNote?: string;
}

export type AdapterRef = { kind: 'catalogue'; adapterId: string } | { kind: 'generic' };

/** One upstream endpoint: provider × slug × variant. Curated or discovered. */
export interface Offering {
  canonicalRef: string | null;
  providerId: string;
  upstreamSlug: string;
  adapter: AdapterRef;
  profile: ModelProfile;
  context: { recommended: number; max: number };
  trust: { tee: boolean; zdr: boolean; jurisdiction?: string };
  freedomOrientedDeployment: boolean | null;
  source: 'curated' | 'discovered';
  confidence: 'verified' | 'partial' | 'heuristic';
}

const MODES = new Set(['none', 'fixed-on', 'toggle', 'steps']);

/** Runtime guard used by tests and defensive call-sites. */
export function isReasoningControl(value: unknown): value is ReasoningControl {
  if (typeof value !== 'object' || value === null) return false;
  const mode = (value as { mode?: unknown }).mode;
  return typeof mode === 'string' && MODES.has(mode);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/catalogue/types.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/package.json packages/llm-unified/src/catalogue/types.ts packages/llm-unified/src/catalogue/types.test.ts
git commit -m "Add catalogue data-model types and Valibot dependency

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 2: Migrate `ModelProfile` off `adapter-contract.ts`

`adapter-contract.ts` currently defines its own `ModelProfile` (with `reasoning: ReasoningCapability`, `contextWindow`, `confidence`). Point it at the new catalogue type and update `conservativeProfile`.

**Files:**
- Modify: `packages/llm-unified/src/adapter-contract.ts`
- Modify: `packages/llm-unified/src/adapter-contract.test.ts`

- [ ] **Step 1: Update the failing test first**

Replace the `conservativeProfile` test body in `adapter-contract.test.ts` with:

```ts
import { describe, expect, it } from 'bun:test';
import { conservativeProfile } from './adapter-contract.js';

describe('conservativeProfile', () => {
  it('defaults unknown capabilities to the safest, least-breaking choice', () => {
    const p = conservativeProfile({ toolsSupported: true });
    expect(p.reasoning).toEqual({ mode: 'fixed-on' }); // hidden-reasoning safe default
    expect(p.toolCalls.streaming).toBe(false); // assume block — never break a request
    expect(p.toolCalls.concurrentWithReasoning).toBe(false);
    expect(p.toolCalls.supported).toBe(true);
    expect(p.vision).toBe(false);
    expect(p.replayReasoning).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/adapter-contract.test.ts`
Expected: FAIL — old `conservativeProfile` returns `confidence`/`contextWindow`, no `reasoning.mode`.

- [ ] **Step 3: Update `adapter-contract.ts`**

Remove the local `ModelProfile` and `ReasoningCapability` import; import `ModelProfile` from catalogue; rewrite `conservativeProfile`. The `ModelAdapter` interface keeps `readonly profile: ModelProfile`.

```ts
// adapter-contract.ts — replace the ModelProfile definition and conservativeProfile
import type { ModelProfile } from './catalogue/types.js';
import type { ReasoningIntent, StreamChunk, WireMessage } from './types.js';

// ... ToolDef, CanonicalRequest, WireRequest, ParseState unchanged ...

export type { ModelProfile };

export interface ModelAdapter {
  buildRequest(req: CanonicalRequest): WireRequest;
  parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState };
  readonly profile: ModelProfile;
}

/**
 * Fallback profile: every unverified capability takes the safest, least-breaking
 * value. Context size and confidence are NOT part of the profile — they live on
 * the Offering. Per UX "disabled over hidden", unverified capabilities are greyed
 * out downstream rather than offered.
 */
export function conservativeProfile(base: { toolsSupported: boolean }): ModelProfile {
  return {
    reasoning: { mode: 'fixed-on' },
    toolCalls: { supported: base.toolsSupported, streaming: false, concurrentWithReasoning: false },
    vision: false,
    replayReasoning: true,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/adapter-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/adapter-contract.ts packages/llm-unified/src/adapter-contract.test.ts
git commit -m "Point adapter-contract ModelProfile at the catalogue type; slim conservativeProfile

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 3: Migrate the baseline adapter profile

The baseline adapter's `PROFILE` constant uses the old shape. Migrate it to `ReasoningControl` and drop `contextWindow`/`confidence` (those are Offering-level now).

**Files:**
- Modify: `packages/llm-unified/src/adapters/nano-gpt-deepseek.baseline.ts`
- Modify: `packages/llm-unified/src/adapters/nano-gpt-deepseek.baseline.test.ts` (only if it asserts profile fields — the existing tests assert buildRequest/parseChunk, not profile, so likely no change)

- [ ] **Step 1: Update the `PROFILE` constant**

Replace the `PROFILE` constant in `nano-gpt-deepseek.baseline.ts` with:

```ts
const PROFILE: ModelProfile = {
  // DeepSeek V4 Pro on nano-gpt: reasoning-off honoured + effort steps → steps with an explicit off.
  reasoning: { mode: 'steps', steps: ['off', 'low', 'medium', 'high'], offStep: 'off', defaultStep: 'medium' },
  toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
  vision: false,
  replayReasoning: false,
};
```

Update the import line so `ModelProfile` resolves (it is re-exported from `adapter-contract.js`, so the existing `import type { ... ModelProfile ... } from '../adapter-contract.js'` keeps working — confirm it still type-checks).

- [ ] **Step 2: Run the baseline tests + typecheck**

Run: `cd packages/llm-unified && bun test src/adapters/nano-gpt-deepseek.baseline.test.ts && pnpm --filter @chatsundere/llm-unified typecheck`
Expected: PASS, no type errors. (buildRequest/parseChunk are unchanged; only the descriptive profile changed.)

- [ ] **Step 3: Commit**

```bash
git add packages/llm-unified/src/adapters/nano-gpt-deepseek.baseline.ts
git commit -m "Migrate baseline adapter profile to ReasoningControl

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 4: Update `validate` profile-gate to map control mode ↔ observed kind

`deriveObservedProfile` still returns `reasoningKind: 'no_reasoning' | 'optional' | 'always_on'`. `checkProfile` previously compared `profile.reasoning.kind`; now the profile carries `reasoning.mode`. Map mode → kind for the comparison.

**Files:**
- Modify: `packages/llm-unified/src/synthesis/validate.ts`
- Modify: `packages/llm-unified/src/synthesis/validate.test.ts`

- [ ] **Step 1: Update the contradiction test's expectation**

The existing test "fails when the candidate profile contradicts the captured evidence" loads the baseline (now `reasoning.mode: 'steps'`, which maps to kind `'optional'`) against fixtures showing `always_on`. That mismatch must still be caught. Confirm the assertion still reads `verdict.failures.some((f) => f.includes('reasoning'))` (broaden from `reasoning.kind` to `reasoning` so it matches the new message). Edit that assertion accordingly.

- [ ] **Step 2: Run to verify the current code fails/needs update**

Run: `cd packages/llm-unified && bun test src/synthesis/validate.test.ts`
Expected: the contradiction test FAILS (the old `checkProfile` reads `profile.reasoning.kind`, now `undefined`, so it no longer maps correctly).

- [ ] **Step 3: Update `checkProfile` in `validate.ts`**

Add a mode→kind mapping and compare against the observed kind:

```ts
import type { ReasoningControl } from '../catalogue/types.js';

/** The observed reasoning fact a probe can establish, derived from a profile's control mode. */
function controlToKind(c: ReasoningControl | undefined): 'no_reasoning' | 'optional' | 'always_on' | undefined {
  switch (c?.mode) {
    case 'none':
      return 'no_reasoning';
    case 'fixed-on':
      return 'always_on';
    case 'toggle':
    case 'steps':
      return 'optional';
    default:
      return undefined;
  }
}
```

Then in `checkProfile`, replace the reasoning comparison:

```ts
  if (probed.has('reasoning-on') || probed.has('reasoning-off')) {
    const profileKind = controlToKind(profile.reasoning);
    if (profileKind !== observed.reasoningKind) {
      const note = observed.reasoningKind === 'always_on' ? 'still emitted' : 'did not emit';
      out.push(
        `profile.reasoning implies "${profileKind}" but the evidence shows "${observed.reasoningKind}" (reasoning-off ${note} reasoning).`,
      );
    }
  }
```

(The `toolCalls` and `concurrentWithReasoning` checks are unchanged.)

- [ ] **Step 4: Run tests + typecheck**

Run: `cd packages/llm-unified && bun test src/synthesis/validate.test.ts && pnpm --filter @chatsundere/llm-unified typecheck`
Expected: PASS — the contradiction (steps→optional vs always_on) is still caught.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/synthesis/validate.ts packages/llm-unified/src/synthesis/validate.test.ts
git commit -m "Map ReasoningControl mode to observed kind in the profile-gate

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 5: Effective-freedom derivation

**Files:**
- Create: `packages/llm-unified/src/catalogue/freedom.ts`
- Test: `packages/llm-unified/src/catalogue/freedom.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// catalogue/freedom.test.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { effectiveFreedom } from './freedom.js';

describe('effectiveFreedom', () => {
  it('is free only when both model and deployment are free', () => {
    expect(effectiveFreedom(true, true)).toBe('free');
  });
  it('is restricted when either side is false', () => {
    expect(effectiveFreedom(true, false)).toBe('restricted'); // MiMo on nano-gpt
    expect(effectiveFreedom(false, true)).toBe('restricted');
  });
  it('is unknown when either side is null (uncurated)', () => {
    expect(effectiveFreedom(null, true)).toBe('unknown');
    expect(effectiveFreedom(true, null)).toBe('unknown');
    expect(effectiveFreedom(null, null)).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/catalogue/freedom.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// catalogue/freedom.ts
// SPDX-License-Identifier: LGPL-3.0-only

export type FreedomState = 'free' | 'restricted' | 'unknown';

/**
 * Effective freedom is the AND of model-intrinsic and deployment freedom.
 * `null` on either side (uncurated / unassessed) yields 'unknown' — absence of
 * evidence is not evidence of restriction.
 */
export function effectiveFreedom(
  modelFreedom: boolean | null,
  deploymentFreedom: boolean | null,
): FreedomState {
  if (modelFreedom === null || deploymentFreedom === null) return 'unknown';
  return modelFreedom && deploymentFreedom ? 'free' : 'restricted';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/catalogue/freedom.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/catalogue/freedom.ts packages/llm-unified/src/catalogue/freedom.test.ts
git commit -m "Add effective-freedom derivation (three-state)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 6: Valibot schemas + `parseCatalogueEntry` (with capability gate)

Validate a parsed catalogue entry (a CanonicalModel plus its Offerings) and enforce the capability gate: every offering must deliver the canonical's `requiredCaps`.

**Files:**
- Create: `packages/llm-unified/src/catalogue/schema.ts`
- Test: `packages/llm-unified/src/catalogue/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// catalogue/schema.test.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { parseCatalogueEntry } from './schema.js';

const validEntry = {
  canonical: {
    id: 'glm-6',
    displayName: 'GLM 6',
    family: 'glm',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
  },
  offerings: [
    {
      canonicalRef: 'glm-6',
      providerId: 'nano-gpt',
      upstreamSlug: 'zai-org/glm-6',
      adapter: { kind: 'catalogue', adapterId: 'glm-6.nano-gpt' },
      profile: {
        reasoning: { mode: 'toggle', defaultOn: true },
        toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
        vision: false,
        replayReasoning: false,
      },
      context: { recommended: 128000, max: 200000 },
      trust: { tee: false, zdr: false },
      freedomOrientedDeployment: false,
      source: 'curated',
      confidence: 'verified',
    },
  ],
};

describe('parseCatalogueEntry', () => {
  it('accepts a well-formed entry', () => {
    const r = parseCatalogueEntry(validEntry);
    expect(r.ok).toBe(true);
  });

  it('rejects an offering that does not deliver a required capability', () => {
    const bad = structuredClone(validEntry);
    bad.offerings[0].profile.toolCalls.supported = false; // requiredCaps.tools is true
    const r = parseCatalogueEntry(bad);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.errors.join(' ')).toMatch(/capability gate/i);
  });

  it('rejects a structurally invalid entry', () => {
    const r = parseCatalogueEntry({ canonical: { id: 'x' } });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/catalogue/schema.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// catalogue/schema.ts
// SPDX-License-Identifier: LGPL-3.0-only
import * as v from 'valibot';
import type { CanonicalModel, Offering } from './types.js';

const ReasoningControlSchema = v.variant('mode', [
  v.object({ mode: v.literal('none') }),
  v.object({ mode: v.literal('fixed-on') }),
  v.object({ mode: v.literal('toggle'), defaultOn: v.boolean() }),
  v.object({
    mode: v.literal('steps'),
    steps: v.array(v.string()),
    offStep: v.nullable(v.string()),
    defaultStep: v.string(),
  }),
]);

const ModelProfileSchema = v.object({
  reasoning: ReasoningControlSchema,
  toolCalls: v.object({
    supported: v.boolean(),
    streaming: v.boolean(),
    concurrentWithReasoning: v.boolean(),
  }),
  vision: v.boolean(),
  replayReasoning: v.boolean(),
});

const CanonicalSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  displayName: v.pipe(v.string(), v.minLength(1)),
  family: v.pipe(v.string(), v.minLength(1)),
  requiredCaps: v.object({ tools: v.boolean(), reasoning: v.boolean(), vision: v.boolean() }),
  freedomOriented: v.nullable(v.boolean()),
  freedomNote: v.optional(v.string()),
});

const AdapterRefSchema = v.variant('kind', [
  v.object({ kind: v.literal('catalogue'), adapterId: v.string() }),
  v.object({ kind: v.literal('generic') }),
]);

const OfferingSchema = v.object({
  canonicalRef: v.nullable(v.string()),
  providerId: v.pipe(v.string(), v.minLength(1)),
  upstreamSlug: v.pipe(v.string(), v.minLength(1)),
  adapter: AdapterRefSchema,
  profile: ModelProfileSchema,
  context: v.object({ recommended: v.number(), max: v.number() }),
  trust: v.object({ tee: v.boolean(), zdr: v.boolean(), jurisdiction: v.optional(v.string()) }),
  freedomOrientedDeployment: v.nullable(v.boolean()),
  source: v.picklist(['curated', 'discovered']),
  confidence: v.picklist(['verified', 'partial', 'heuristic']),
});

const EntrySchema = v.object({ canonical: CanonicalSchema, offerings: v.array(OfferingSchema) });

export interface CatalogueEntry {
  canonical: CanonicalModel;
  offerings: Offering[];
}

export type ParseResult =
  | { ok: true; entry: CatalogueEntry }
  | { ok: false; errors: string[] };

/** The capability gate: every offering must deliver the canonical's requiredCaps. */
function capabilityGateErrors(entry: CatalogueEntry): string[] {
  const req = entry.canonical.requiredCaps;
  const errs: string[] = [];
  for (const o of entry.offerings) {
    if (req.tools && !o.profile.toolCalls.supported)
      errs.push(`capability gate: offering ${o.providerId}:${o.upstreamSlug} lacks required tools`);
    if (req.vision && !o.profile.vision)
      errs.push(`capability gate: offering ${o.providerId}:${o.upstreamSlug} lacks required vision`);
    // reasoning: required means it must not be 'none'
    if (req.reasoning && o.profile.reasoning.mode === 'none')
      errs.push(`capability gate: offering ${o.providerId}:${o.upstreamSlug} lacks required reasoning`);
  }
  return errs;
}

/** Validate structure (Valibot) then enforce the capability gate. */
export function parseCatalogueEntry(input: unknown): ParseResult {
  const result = v.safeParse(EntrySchema, input);
  if (!result.success) {
    return { ok: false, errors: result.issues.map((i) => `${i.path?.map((p) => p.key).join('.') ?? ''}: ${i.message}`) };
  }
  const entry = result.output as CatalogueEntry;
  const gateErrors = capabilityGateErrors(entry);
  if (gateErrors.length > 0) return { ok: false, errors: gateErrors };
  return { ok: true, entry };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/catalogue/schema.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/catalogue/schema.ts packages/llm-unified/src/catalogue/schema.test.ts
git commit -m "Add Valibot catalogue-entry validation with capability gate

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 7: Barrel export + full verification

**Files:**
- Create: `packages/llm-unified/src/catalogue/index.ts`
- Modify: `packages/llm-unified/src/index.ts`

- [ ] **Step 1: Catalogue barrel**

```ts
// catalogue/index.ts
// SPDX-License-Identifier: LGPL-3.0-only
export type {
  ReasoningControl,
  ModelProfile,
  CanonicalModel,
  Offering,
  AdapterRef,
} from './types.js';
export { isReasoningControl } from './types.js';
export { effectiveFreedom, type FreedomState } from './freedom.js';
export { parseCatalogueEntry, type CatalogueEntry, type ParseResult } from './schema.js';
```

- [ ] **Step 2: Re-export from the package index**

Add to `packages/llm-unified/src/index.ts`:

```ts
export * from './catalogue/index.js';
```

- [ ] **Step 3: Full suite + typecheck + build**

Run: `cd packages/llm-unified && bun test && pnpm --filter @chatsundere/llm-unified typecheck && pnpm --filter @chatsundere/llm-unified build`
Expected: all tests pass, no type errors, build clean.

- [ ] **Step 4: Commit**

```bash
git add packages/llm-unified/src/catalogue/index.ts packages/llm-unified/src/index.ts
git commit -m "Export the catalogue data model from llm-unified

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §3 entities `CanonicalModel`/`Offering`/`AdapterRef` → Task 1. ✓
- §4 `ReasoningControl` + evolved `ModelProfile` (context/confidence moved off) → Tasks 1–4. ✓
- §3 capability gate → Task 6. ✓
- §6 effective freedom (three-state) → Task 5. ✓
- Migration off the spike's profile shape, tests stay green → Tasks 2–4. ✓
- §8 type placement (llm-unified, shared-types deferred) → honoured (all in llm-unified). ✓
- Out of scope here (correctly): the two UI surfaces, YAML file I/O (Plan 2 / CLI), trust badge rendering, delivery/signing.

**Placeholder scan:** No TBD/TODO; every code step is complete. ✓

**Type consistency:** `ModelProfile` (Task 1) is imported by `adapter-contract` (Task 2), the baseline (Task 3), `validate` (Task 4); `ReasoningControl` used in Tasks 1, 4, 6 with identical shape; `controlToKind` (Task 4) maps the same modes defined in Task 1; `parseCatalogueEntry`/`CatalogueEntry` (Task 6) exported in Task 7. ✓

**Note for executor:** Tasks 2–4 are a migration — run the FULL `bun test` after Task 4 to confirm no synthesis test regressed before moving on; the spike's sandbox/derive-profile/loop tests must stay green.
