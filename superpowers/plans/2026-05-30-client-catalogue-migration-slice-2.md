# Client Catalogue Migration (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the client from `KnownModel`/`ProviderDefinition.knownModels` to the catalogue's `CanonicalModel`/`Offering`, with canonical-first model selection (model in the foreground, offering chosen with a ranked suggestion), and move the cockpit + reasoning-resolver from `ReasoningCapability` to `ReasoningControl`.

**Architecture:** Approach A — each provider gains a hand-authored `offerings: Offering[]` field (canonicals live in a new `canonical-registry.ts`). The runtime takes a minimal `CompletionTarget = { slug, adapterId? }` derived from the chosen offering, decoupling `llm-unified`'s hot path from the selection model. `knownModels`/`KnownModel`/`ReasoningCapability` are kept additively during the migration and removed in the final cleanup task, so the build stays green between tasks.

**Tech Stack:** TypeScript (strict), Bun test runner (`llm-unified`), Vitest (`user-client`), React 18, Dexie (IndexedDB), Valibot.

**Spec:** `superpowers/specs/2026-05-30-client-catalogue-migration-slice-2-design.md`

**Build/test commands (from repo root unless noted):**
- `llm-unified` src tests: `cd packages/llm-unified && bun test ./src/`
- `llm-unified` curation tests: `cd packages/llm-unified && bun test ./curation/`
- typecheck (covers curation): `pnpm --filter @chatsundere/llm-unified typecheck` (or `pnpm typecheck` at root)
- build: `pnpm --filter @chatsundere/llm-unified build`
- user-client tests: `pnpm --filter @chatsundere/user-client test`
- user-client typecheck/build: `pnpm --filter @chatsundere/user-client build`
- After any commit rejected by the Biome pre-commit hook: `bunx @biomejs/biome check --write <files>`, re-stage, recommit.

**Commit convention:** free-form imperative subject; body ends with `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. These are code commits — no `[skip ci]`.

---

## Reference data — the canonical/offering values (used by Tasks 1 & 2)

Seven canonicals and their offerings. `requiredCaps` is the intersection of what every offering of that canonical delivers (so the capability gate in `schema.ts` passes).

| Canonical `id` | displayName | family | requiredCaps {tools,reasoning,vision} | freedomOriented |
|---|---|---|---|---|
| `deepseek-v3.2` | DeepSeek V3.2 | deepseek | {true,true,false} | null |
| `deepseek-v4-flash` | DeepSeek V4 Flash | deepseek | {true,true,false} | null |
| `deepseek-v4-pro` | DeepSeek V4 Pro | deepseek | {true,true,false} | null |
| `glm-5` | GLM 5 | glm | {true,true,false} | null |
| `glm-5.1` | GLM 5.1 | glm | {true,true,false} | null |
| `kimi-k2.6` | Kimi K2.6 | kimi | {true,true,true} | null |
| `gemma-4-31b` | Gemma 4 31B | gemma | {true,true,true} | null |

Provider `sortPriority` (already in code): chutes 10, novita 20, ollama-cloud 30, nano-gpt 40.

**Offering rows.** `toolCalls` is `{ supported: true, streaming: true, concurrentWithReasoning: false }` for every offering below. `source: 'curated'` for all. `context` is `{ recommended: N, max: N }` using the table's N. `trust` and `confidence` per column. `adapter` is `{ kind: 'catalogue', adapterId: 'chutes:<slug>' }` for chutes offerings, `{ kind: 'generic' }` otherwise. `freedomOrientedDeployment` is `true` for chutes (TEE), `null` otherwise.

| canonicalRef | providerId | upstreamSlug | reasoning (ReasoningControl) | vision | replayReasoning | context N | trust {tee,zdr} | confidence |
|---|---|---|---|---|---|---|---|---|
| `deepseek-v3.2` | chutes | `deepseek-ai/DeepSeek-V3.2-TEE` | steps[low,medium,high] off=`off` def=`medium` | false | false | 131072 | {true,false} | verified |
| `kimi-k2.6` | chutes | `moonshotai/Kimi-K2.6-TEE` | steps[low,medium,high] off=`off` def=`medium` | true | false | 262144 | {true,false} | verified |
| `glm-5.1` | chutes | `zai-org/GLM-5.1-TEE` | steps[low,medium,high] off=`off` def=`medium` | false | false | 202752 | {true,false} | verified |
| `gemma-4-31b` | chutes | `google/gemma-4-31B-turbo-TEE` | steps[low,medium,high] off=`off` def=`medium` | true | false | 131072 | {true,false} | verified |
| `deepseek-v4-flash` | nano-gpt | `deepseek/deepseek-v4-flash` | steps[low,medium,high] off=`off` def=`medium` | false | false | 200000 | {false,false} | heuristic |
| `deepseek-v4-pro` | nano-gpt | `deepseek/deepseek-v4-pro` | steps[low,medium,high] off=`off` def=`medium` | false | false | 200000 | {false,false} | heuristic |
| `glm-5` | nano-gpt | `zai-org/glm-5` | toggle defaultOn=true | false | false | 200000 | {false,false} | heuristic |
| `glm-5.1` | nano-gpt | `zai-org/glm-5.1` | toggle defaultOn=true | false | false | 200000 | {false,false} | heuristic |
| `kimi-k2.6` | nano-gpt | `moonshotai/kimi-k2.6` | toggle defaultOn=true | true | false | 256000 | {false,false} | heuristic |
| `gemma-4-31b` | nano-gpt | `google/gemma-4-31b-it` | toggle defaultOn=true | true | false | 262144 | {false,false} | heuristic |
| `deepseek-v4-flash` | novita | `deepseek/deepseek-v4-flash` | steps[low,medium,high] off=`off` def=`medium` | false | false | 200000 | {false,false} | heuristic |
| `deepseek-v4-pro` | novita | `deepseek/deepseek-v4-pro` | steps[low,medium,high] off=`off` def=`medium` | false | false | 200000 | {false,false} | heuristic |
| `glm-5` | novita | `zai-org/glm-5` | toggle defaultOn=true | false | false | 200000 | {false,false} | heuristic |
| `glm-5.1` | novita | `zai-org/glm-5.1` | toggle defaultOn=true | false | false | 200000 | {false,false} | heuristic |
| `kimi-k2.6` | novita | `moonshotai/kimi-k2.6` | toggle defaultOn=true | true | false | 256000 | {false,false} | heuristic |
| `gemma-4-31b` | novita | `google/gemma-4-31b-it` | toggle defaultOn=true | true | false | 262144 | {false,false} | heuristic |
| `deepseek-v4-flash` | ollama-cloud | `deepseek-v4-flash` | steps[low,medium,high] off=`off` def=`medium` | false | false | 200000 | {false,false} | heuristic |
| `deepseek-v4-pro` | ollama-cloud | `deepseek-v4-pro` | steps[low,medium,high] off=`off` def=`medium` | false | false | 200000 | {false,false} | heuristic |
| `glm-5` | ollama-cloud | `glm-5` | toggle defaultOn=true | false | false | 200000 | {false,false} | heuristic |
| `glm-5.1` | ollama-cloud | `glm-5.1` | toggle defaultOn=true | false | false | 200000 | {false,false} | heuristic |
| `kimi-k2.6` | ollama-cloud | `kimi-k2.6` | toggle defaultOn=true | true | false | 256000 | {false,false} | heuristic |
| `gemma-4-31b` | ollama-cloud | `gemma4:31b` | toggle defaultOn=true | true | false | 262144 | {false,false} | heuristic |

`steps[low,medium,high] off=off def=medium` means `{ mode: 'steps', steps: ['low','medium','high'], offStep: 'off', defaultStep: 'medium' }`.
`toggle defaultOn=true` means `{ mode: 'toggle', defaultOn: true }`.

The mechanical mapping that produced the non-chutes reasoning columns (for reference): `kind:'optional'` + `effort` → `steps` with `offStep:'off'`; `kind:'optional'` no `effort` → `toggle { defaultOn }`; `no_reasoning` → `none`; `always_on` no effort → `fixed-on`.

---

## File Structure

**`packages/llm-unified/src/`**
- `catalogue/canonical-registry.ts` (new) — `CANONICALS`, `listCanonicals()`, `getCanonical()`.
- `catalogue/target.ts` (new) — `CompletionTarget` type + `offeringToTarget()`.
- `types.ts` — add `offerings: Offering[]` to `ProviderDefinition` (Task 2); remove `KnownModel`/`ReasoningCapability`/`ReasoningEffortSpec` (Task 8).
- `index.ts` — export catalogue registry/target additions (Task 1/4); drop removed types (Task 8).
- `registry.ts` — `rankOfferings()`, `listOfferings()`, `getOffering()`.
- `providers/{chutes,nano-gpt,novita,ollama-cloud}.ts` — add `offerings`; remove `knownModels` in Task 8.
- `stream-completion.ts`, `one-shot-completion.ts` — `model: KnownModel` → `target: CompletionTarget`.

**`apps/user-client/src/`**
- `boot/client-data-db.ts` — `PersonaRow.canonicalId`, DB version 8.
- `routes/app/persona-editor.tsx` — two-level picker (`ModelList` rewrite, custom input removed), `canonicalId` in draft + validation + meta string.
- `lib/reasoning-resolver.ts` — `ReasoningState` + functions on `ReasoningControl`.
- `components/chat/{Cockpit,CockpitMenu,InteractionMode}.tsx` — consume `Offering`.
- `data/send-message.ts` — resolve `Offering` via `getOffering`; build `CompletionTarget`.
- `lib/stream-engine.ts` — `StartStreamArgs.offering`; build target + control.
- `lib/title-generator.ts` — build target from offering.
- `routes/app/chat/chat-page.tsx` — resolve offering, init reasoning from control.

---

## Task 1: Canonical registry (`llm-unified`)

**Files:**
- Create: `packages/llm-unified/src/catalogue/canonical-registry.ts`
- Create test: `packages/llm-unified/src/catalogue/canonical-registry.test.ts`
- Modify: `packages/llm-unified/src/catalogue/index.ts` (export the registry)

- [ ] **Step 1: Write the failing test**

`packages/llm-unified/src/catalogue/canonical-registry.test.ts`:
```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { CANONICALS, getCanonical, listCanonicals } from './canonical-registry.js';

describe('canonical-registry', () => {
  test('lists seven canonicals with unique ids', () => {
    const ids = listCanonicals().map((c) => c.id);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    expect(ids).toContain('glm-5.1');
    expect(ids).toContain('deepseek-v3.2');
  });

  test('getCanonical returns by id and undefined for unknown', () => {
    expect(getCanonical('kimi-k2.6')?.displayName).toBe('Kimi K2.6');
    expect(getCanonical('nope')).toBeUndefined();
  });

  test('CANONICALS is the source listCanonicals copies', () => {
    expect(listCanonicals()).toEqual([...CANONICALS]);
    expect(listCanonicals()).not.toBe(CANONICALS); // fresh array
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `cd packages/llm-unified && bun test ./src/catalogue/canonical-registry.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the registry**

`packages/llm-unified/src/catalogue/canonical-registry.ts`:
```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { CanonicalModel } from './types.js';

/** Curated, provider-independent identities. The user picks one of these. */
export const CANONICALS: CanonicalModel[] = [
  {
    id: 'deepseek-v3.2',
    displayName: 'DeepSeek V3.2',
    family: 'deepseek',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: null,
  },
  {
    id: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    family: 'deepseek',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: null,
  },
  {
    id: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    family: 'deepseek',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: null,
  },
  {
    id: 'glm-5',
    displayName: 'GLM 5',
    family: 'glm',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: null,
  },
  {
    id: 'glm-5.1',
    displayName: 'GLM 5.1',
    family: 'glm',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: null,
  },
  {
    id: 'kimi-k2.6',
    displayName: 'Kimi K2.6',
    family: 'kimi',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: null,
  },
  {
    id: 'gemma-4-31b',
    displayName: 'Gemma 4 31B',
    family: 'gemma',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: null,
  },
];

/** Fresh array so callers may sort/filter freely. */
export function listCanonicals(): CanonicalModel[] {
  return [...CANONICALS];
}

export function getCanonical(id: string): CanonicalModel | undefined {
  return CANONICALS.find((c) => c.id === id);
}
```

Append to `packages/llm-unified/src/catalogue/index.ts`:
```ts
export { CANONICALS, listCanonicals, getCanonical } from './canonical-registry.js';
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `cd packages/llm-unified && bun test ./src/catalogue/canonical-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/catalogue/canonical-registry.ts packages/llm-unified/src/catalogue/canonical-registry.test.ts packages/llm-unified/src/catalogue/index.ts
git commit -m "Add canonical model registry to llm-unified catalogue"
```

---

## Task 2: Offerings on providers (`llm-unified`)

Add `offerings: Offering[]` to `ProviderDefinition` (additive — `knownModels` stays) and populate all four providers from the reference table. A small local `mkOffering` helper per file keeps the literals DRY without a runtime transform.

**Files:**
- Modify: `packages/llm-unified/src/types.ts:51-64` (add field)
- Modify: `packages/llm-unified/src/providers/chutes.ts`, `nano-gpt.ts`, `novita.ts`, `ollama-cloud.ts`
- Create test: `packages/llm-unified/src/providers/offerings.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/llm-unified/src/providers/offerings.test.ts`:
```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { getCanonical } from '../catalogue/canonical-registry.js';
import { parseCatalogueEntry } from '../catalogue/schema.js';
import { chutes } from './chutes.js';
import { nanoGpt } from './nano-gpt.js';
import { novita } from './novita.js';
import { ollamaCloud } from './ollama-cloud.js';

const PROVIDERS = [chutes, nanoGpt, novita, ollamaCloud];

describe('provider offerings', () => {
  test('every offering references a known canonical and passes the capability gate', () => {
    for (const p of PROVIDERS) {
      expect(p.offerings.length).toBeGreaterThan(0);
      for (const o of p.offerings) {
        expect(o.providerId).toBe(p.id);
        const canonical = o.canonicalRef ? getCanonical(o.canonicalRef) : undefined;
        expect(canonical).toBeDefined();
        const res = parseCatalogueEntry({ canonical, offerings: [o] });
        if (!res.ok) throw new Error(`${p.id}:${o.upstreamSlug} → ${res.errors.join('; ')}`);
      }
    }
  });

  test('chutes offerings are TEE + catalogue-adapter, others generic', () => {
    for (const o of chutes.offerings) {
      expect(o.trust.tee).toBe(true);
      expect(o.adapter).toEqual({ kind: 'catalogue', adapterId: `chutes:${o.upstreamSlug}` });
    }
    for (const o of [...nanoGpt.offerings, ...novita.offerings, ...ollamaCloud.offerings]) {
      expect(o.trust.tee).toBe(false);
      expect(o.adapter).toEqual({ kind: 'generic' });
    }
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `cd packages/llm-unified && bun test ./src/providers/offerings.test.ts`
Expected: FAIL (`offerings` undefined on providers).

- [ ] **Step 3a: Add the field to `ProviderDefinition`**

In `packages/llm-unified/src/types.ts`, add `import type { Offering } from './catalogue/types.js';` at the top of the type imports, and inside `interface ProviderDefinition` (after `knownModels: KnownModel[];` at line 62) add:
```ts
  /** Catalogue offerings exposed by this provider (Slice 2). */
  offerings: Offering[];
```

- [ ] **Step 3b: Populate `chutes.ts`**

Replace the body of `packages/llm-unified/src/providers/chutes.ts` so the existing `knownModels`/`MODELS`/`REASONING`/`registerChutes` stay AND an `offerings` array is added. Add this helper + array above the `export const chutes` and wire `offerings` into the object:
```ts
import type { Offering } from '../catalogue/types.js';

const STEPS = {
  mode: 'steps' as const,
  steps: ['low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};

function chutesOffering(canonicalRef: string, slug: string, vision: boolean, ctx: number): Offering {
  return {
    canonicalRef,
    providerId: 'chutes',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `chutes:${slug}` },
    profile: {
      reasoning: STEPS,
      toolCalls: { supported: true, streaming: true, concurrentWithReasoning: false },
      vision,
      replayReasoning: false,
    },
    context: { recommended: ctx, max: ctx },
    trust: { tee: true, zdr: false },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified',
  };
}

const offerings: Offering[] = [
  chutesOffering('deepseek-v3.2', 'deepseek-ai/DeepSeek-V3.2-TEE', false, 131_072),
  chutesOffering('kimi-k2.6', 'moonshotai/Kimi-K2.6-TEE', true, 262_144),
  chutesOffering('glm-5.1', 'zai-org/GLM-5.1-TEE', false, 202_752),
  chutesOffering('gemma-4-31b', 'google/gemma-4-31B-turbo-TEE', true, 131_072),
];
```
Then add `offerings,` to the `export const chutes: ProviderDefinition = { ... }` object (next to `knownModels,`).

- [ ] **Step 3c: Populate `nano-gpt.ts`, `novita.ts`, `ollama-cloud.ts`**

In each of the three files add this helper block above `export const <provider>` and an `offerings` array, then add `offerings,` to the provider object. Use the per-file `upstreamSlug` values from the reference table (nano-gpt and novita share slugs; ollama-cloud differs).

Shared helper (paste into each of the three files; change `providerId` to `'nano-gpt'` / `'novita'` / `'ollama-cloud'`):
```ts
import type { Offering } from '../catalogue/types.js';
import type { ReasoningControl } from '../catalogue/types.js';

const TOGGLE_ON: ReasoningControl = { mode: 'toggle', defaultOn: true };
const STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};

function genericOffering(
  canonicalRef: string,
  slug: string,
  reasoning: ReasoningControl,
  vision: boolean,
  ctx: number,
): Offering {
  return {
    canonicalRef,
    providerId: '<PROVIDER_ID>', // 'nano-gpt' | 'novita' | 'ollama-cloud'
    upstreamSlug: slug,
    adapter: { kind: 'generic' },
    profile: {
      reasoning,
      toolCalls: { supported: true, streaming: true, concurrentWithReasoning: false },
      vision,
      replayReasoning: false,
    },
    context: { recommended: ctx, max: ctx },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: null,
    source: 'curated',
    confidence: 'heuristic',
  };
}
```

`nano-gpt.ts` and `novita.ts` offerings (identical slugs):
```ts
const offerings: Offering[] = [
  genericOffering('deepseek-v4-flash', 'deepseek/deepseek-v4-flash', STEPS, false, 200_000),
  genericOffering('deepseek-v4-pro', 'deepseek/deepseek-v4-pro', STEPS, false, 200_000),
  genericOffering('glm-5', 'zai-org/glm-5', TOGGLE_ON, false, 200_000),
  genericOffering('glm-5.1', 'zai-org/glm-5.1', TOGGLE_ON, false, 200_000),
  genericOffering('kimi-k2.6', 'moonshotai/kimi-k2.6', TOGGLE_ON, true, 256_000),
  genericOffering('gemma-4-31b', 'google/gemma-4-31b-it', TOGGLE_ON, true, 262_144),
];
```

`ollama-cloud.ts` offerings (different slugs):
```ts
const offerings: Offering[] = [
  genericOffering('deepseek-v4-flash', 'deepseek-v4-flash', STEPS, false, 200_000),
  genericOffering('deepseek-v4-pro', 'deepseek-v4-pro', STEPS, false, 200_000),
  genericOffering('glm-5', 'glm-5', TOGGLE_ON, false, 200_000),
  genericOffering('glm-5.1', 'glm-5.1', TOGGLE_ON, false, 200_000),
  genericOffering('kimi-k2.6', 'kimi-k2.6', TOGGLE_ON, true, 256_000),
  genericOffering('gemma-4-31b', 'gemma4:31b', TOGGLE_ON, true, 262_144),
];
```

- [ ] **Step 3d: Fix `ProviderDefinition` literals in tests/curation**

Adding a required `offerings` field breaks any hand-built `ProviderDefinition`. Find and patch them:
```bash
rg -ln "ProviderDefinition\b" packages/llm-unified/src --glob '*.test.ts'
```
For each such mock (notably `registry.test.ts` and `probe.test.ts`), add `offerings: [],` to the literal next to `knownModels`. Do the same for any non-test construction the typecheck flags.

- [ ] **Step 4: Run the tests — expect PASS**

Run: `cd packages/llm-unified && bun test ./src/providers/offerings.test.ts && bun test ./src/`
Run: `pnpm --filter @chatsundere/llm-unified typecheck`
Expected: PASS (existing tests still green — `knownModels` untouched; typecheck clean once mocks carry `offerings`).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @chatsundere/llm-unified typecheck`
```bash
git add packages/llm-unified/src/types.ts packages/llm-unified/src/providers/
git commit -m "Add catalogue offerings to all providers"
```

---

## Task 3: Offering ranking & lookup (`llm-unified` registry)

**Files:**
- Modify: `packages/llm-unified/src/registry.ts`
- Modify: `packages/llm-unified/src/index.ts` (export new fns)
- Create test: `packages/llm-unified/src/registry.offerings.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/llm-unified/src/registry.offerings.test.ts`:
```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chutes } from './providers/chutes.js';
import { nanoGpt } from './providers/nano-gpt.js';
import { novita } from './providers/novita.js';
import { ollamaCloud } from './providers/ollama-cloud.js';
import {
  _resetRegistryForTests,
  getOffering,
  listOfferings,
  registerProvider,
} from './registry.js';

beforeEach(() => {
  _resetRegistryForTests();
  registerProvider(chutes);
  registerProvider(novita);
  registerProvider(ollamaCloud);
  registerProvider(nanoGpt);
});
afterEach(() => _resetRegistryForTests());

describe('listOfferings', () => {
  test('returns offerings for a canonical, TEE first then by provider priority', () => {
    const offers = listOfferings('glm-5.1');
    expect(offers.map((o) => o.providerId)).toEqual(['chutes', 'novita', 'ollama-cloud', 'nano-gpt']);
    expect(offers[0]?.trust.tee).toBe(true);
  });

  test('returns a single offering for a chutes-only canonical', () => {
    expect(listOfferings('deepseek-v3.2').map((o) => o.providerId)).toEqual(['chutes']);
  });

  test('empty for an unknown canonical', () => {
    expect(listOfferings('nope')).toEqual([]);
  });
});

describe('getOffering', () => {
  test('finds an offering by provider template + slug', () => {
    expect(getOffering('chutes', 'zai-org/GLM-5.1-TEE')?.canonicalRef).toBe('glm-5.1');
    expect(getOffering('nano-gpt', 'zai-org/glm-5.1')?.adapter.kind).toBe('generic');
  });

  test('undefined for unknown provider or slug', () => {
    expect(getOffering('chutes', 'nope')).toBeUndefined();
    expect(getOffering('nope', 'x')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `cd packages/llm-unified && bun test ./src/registry.offerings.test.ts`
Expected: FAIL (`listOfferings`/`getOffering` not exported).

- [ ] **Step 3: Implement ranking + lookup**

Append to `packages/llm-unified/src/registry.ts` (it already imports nothing from catalogue; add the import):
```ts
import type { Offering } from './catalogue/types.js';

const CONFIDENCE_RANK: Record<Offering['confidence'], number> = {
  verified: 0,
  partial: 1,
  heuristic: 2,
};

/**
 * Deterministic pick-time ordering: TEE first, then freedom-oriented
 * deployments, then provider sortPriority, then confidence. Never called on
 * the send path.
 */
export function rankOfferings(offerings: Offering[]): Offering[] {
  return [...offerings].sort((a, b) => {
    if (a.trust.tee !== b.trust.tee) return a.trust.tee ? -1 : 1;
    const fa = a.freedomOrientedDeployment === true ? 0 : 1;
    const fb = b.freedomOrientedDeployment === true ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const pa = getProvider(a.providerId)?.sortPriority ?? Number.MAX_SAFE_INTEGER;
    const pb = getProvider(b.providerId)?.sortPriority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
  });
}

/** All offerings across providers for a canonical, rank-sorted. */
export function listOfferings(canonicalId: string): Offering[] {
  const all = listProviders().flatMap((p) => p.offerings);
  return rankOfferings(all.filter((o) => o.canonicalRef === canonicalId));
}

/** Exact lookup for the send path: provider template id + upstream slug. */
export function getOffering(providerTemplateId: string, upstreamSlug: string): Offering | undefined {
  return getProvider(providerTemplateId)?.offerings.find((o) => o.upstreamSlug === upstreamSlug);
}
```

In `packages/llm-unified/src/index.ts`, extend the registry export line:
```ts
export {
  registerProvider,
  getProvider,
  listProviders,
  rankOfferings,
  listOfferings,
  getOffering,
} from './registry.js';
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `cd packages/llm-unified && bun test ./src/registry.offerings.test.ts && bun test ./src/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/registry.ts packages/llm-unified/src/registry.offerings.test.ts packages/llm-unified/src/index.ts
git commit -m "Add offering ranking and lookup to the registry"
```

---

## Task 4: `CompletionTarget` — decouple the runtime (`llm-unified`)

Introduce `CompletionTarget = { slug, adapterId? }` and `offeringToTarget()`; switch `streamCompletion`/`runOneShotCompletion` from `model: KnownModel` to `target: CompletionTarget`. Update the two callers (`stream-engine`, `title-generator`) to build the target from their **current** `KnownModel` (`{ slug: model.id, adapterId: model.adapterId }`) — they migrate to offerings in Task 7.

**Files:**
- Create: `packages/llm-unified/src/catalogue/target.ts` + export in `catalogue/index.ts`
- Modify: `packages/llm-unified/src/stream-completion.ts`, `one-shot-completion.ts`, `index.ts`
- Modify: `packages/llm-unified/src/stream-completion.test.ts`, `one-shot-completion.test.ts` (per failures)
- Modify (callers, keep green): `apps/user-client/src/lib/stream-engine.ts`, `apps/user-client/src/lib/title-generator.ts`
- Create test: `packages/llm-unified/src/catalogue/target.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/llm-unified/src/catalogue/target.test.ts`:
```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { chutes } from '../providers/chutes.js';
import { nanoGpt } from '../providers/nano-gpt.js';
import { offeringToTarget } from './target.js';

describe('offeringToTarget', () => {
  test('catalogue adapter → slug + adapterId', () => {
    const o = chutes.offerings[0]!;
    expect(offeringToTarget(o)).toEqual({ slug: o.upstreamSlug, adapterId: `chutes:${o.upstreamSlug}` });
  });
  test('generic adapter → slug only', () => {
    const o = nanoGpt.offerings[0]!;
    expect(offeringToTarget(o)).toEqual({ slug: o.upstreamSlug });
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `cd packages/llm-unified && bun test ./src/catalogue/target.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3a: Implement `target.ts`**

`packages/llm-unified/src/catalogue/target.ts`:
```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { Offering } from './types.js';

/**
 * Minimal view the runtime needs to issue a completion: the upstream model
 * slug and, when the offering is catalogue-adapted, its adapter id. Keeps
 * stream-completion/one-shot decoupled from the catalogue/selection model.
 */
export interface CompletionTarget {
  slug: string;
  adapterId?: string;
}

export function offeringToTarget(o: Offering): CompletionTarget {
  return {
    slug: o.upstreamSlug,
    ...(o.adapter.kind === 'catalogue' ? { adapterId: o.adapter.adapterId } : {}),
  };
}
```
Append to `packages/llm-unified/src/catalogue/index.ts`:
```ts
export { type CompletionTarget, offeringToTarget } from './target.js';
```

- [ ] **Step 3b: Switch `stream-completion.ts` to `target`**

In `packages/llm-unified/src/stream-completion.ts`:
- Replace the type import `KnownModel,` in the `from './types.js'` block with nothing (remove it), and add `import type { CompletionTarget } from './catalogue/target.js';`.
- In `StreamCompletionArgs` (line 29) replace `model: KnownModel;` with `target: CompletionTarget;`.
- Line 62: `const adapter = args.target.adapterId ? getAdapter(args.target.adapterId) : undefined;`
- In `buildBody` (line 152): `let modelId = args.target.slug;` and line 155 `applyReasoningToBody(args.provider.id as ProviderId, args.target.slug, intent, {})`.

- [ ] **Step 3c: Switch `one-shot-completion.ts` to `target`**

In `packages/llm-unified/src/one-shot-completion.ts`:
- Remove `KnownModel,` from the `from './types.js'` import; add `import type { CompletionTarget } from './catalogue/target.js';`.
- In `OneShotArgs` (line 13) replace `model: KnownModel;` with `target: CompletionTarget;`.
- Line 31: `let modelId = args.target.slug;`
- Line 34: `const pair = NANO_GPT_PAIRS[args.target.slug];`

- [ ] **Step 3d: Update package tests**

Run the package tests and fix the two completion test files where they construct `model: { ... }` to pass `target: { slug, adapterId? }` instead. Search:
```bash
rg -n "model:\s*\{" packages/llm-unified/src/stream-completion.test.ts packages/llm-unified/src/one-shot-completion.test.ts
```
For each occurrence, replace the `model: { id: 'x', adapterId: 'y', ... }` argument with `target: { slug: 'x', adapterId: 'y' }` (drop the other `KnownModel` fields — the runtime no longer reads them).

- [ ] **Step 3e: Keep the two client callers compiling**

In `apps/user-client/src/lib/stream-engine.ts` line ~75-85, the `streamCompletion({ ... model: args.model ... })` call: replace `model: args.model,` with `target: { slug: args.model.id, ...(args.model.adapterId ? { adapterId: args.model.adapterId } : {}) },`.

In `apps/user-client/src/lib/title-generator.ts` line ~102-111, the `runOneShotCompletion({ ... model: args.model ... })` call: replace `model: args.model,` with `target: { slug: args.model.id, ...(args.model.adapterId ? { adapterId: args.model.adapterId } : {}) },`.

(`args.model` is still a `KnownModel` here; Task 7 replaces it with an offering.)

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd packages/llm-unified && bun test ./src/ && bun test ./curation/`
Run: `pnpm --filter @chatsundere/llm-unified typecheck`
Run: `pnpm --filter @chatsundere/user-client build`
Expected: all PASS / typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src apps/user-client/src/lib/stream-engine.ts apps/user-client/src/lib/title-generator.ts
git commit -m "Route completions through a minimal CompletionTarget"
```

---

## Task 5: Persona schema — add `canonicalId` (`user-client`)

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (PersonaRow + version 8)
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx` (defaultDraft only)
- Create test: `apps/user-client/tests/unit/persona-canonical-id.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/user-client/tests/unit/persona-canonical-id.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { getClientDataDb } from '../../src/boot/client-data-db.js';

describe('persona canonicalId column', () => {
  it('persists and reads back canonicalId', async () => {
    const db = getClientDataDb();
    const id = 'p-test-canonical';
    await db.personas.put({
      id,
      name: 'T',
      tagline: '',
      colour: '#fff',
      font: 'serif',
      instructions: 'x',
      canonicalId: 'glm-5.1',
      providerId: 'prov-1',
      modelId: 'zai-org/glm-5.1',
      mindspaceId: null,
      aboutMeOverride: null,
      textureOverride: null,
      temperature: 0.8,
      adultPersona: false,
      createdAt: 1,
      updatedAt: 1,
    });
    const row = await db.personas.get(id);
    expect(row?.canonicalId).toBe('glm-5.1');
    await db.personas.delete(id);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @chatsundere/user-client test -- persona-canonical-id`
Expected: FAIL (type error: `canonicalId` not on `PersonaRow`).

- [ ] **Step 3: Add the field + version 8**

In `apps/user-client/src/boot/client-data-db.ts`:
- In `interface PersonaRow` (lines 66-82) add after `instructions: string;`:
```ts
  /** Canonical model id (Slice 2). null = not set → user must re-pick. */
  canonicalId: string | null;
```
- After the version-7 block (lines 260-268) add:
```ts
    // Version 8 — Slice 2: personas gain a non-indexed `canonicalId`. Clean
    // break: rows from v7 have no canonicalId; the editor treats that as
    // "model not set" and prompts a re-pick. No upgrade callback needed.
    this.version(8).stores({
      settings: 'id',
      providers: 'id, templateId, enabled',
      mindspaces: 'id, builtIn, displayName',
      personas: 'id, providerId',
      chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
      messages: 'id, chatId, [chatId+createdAt]',
      pills: 'id, messageId',
    });
```

In `apps/user-client/src/routes/app/persona-editor.tsx` `defaultDraft` (lines 44-57) add `canonicalId: null,` after `instructions: '',`.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @chatsundere/user-client test -- persona-canonical-id`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/tests/unit/persona-canonical-id.test.ts
git commit -m "Add canonicalId to persona schema (DB v8)"
```

---

## Task 6: Reasoning-resolver rewrite (`user-client`)

Rewrite the pure resolver functions against `ReasoningControl`. This task is self-contained (the new functions are tested in isolation); its consumers (`CockpitMenu`, `stream-engine`, `chat-page`) are migrated in Task 7. To keep the package building between Task 6 and 7, **keep the function names** (`initialReasoningState`, `resolveReasoningBodyExtras`) but change their signatures — the consumers are updated in Task 7, which lands in the same review batch.

> **Sequencing note for the orchestrator:** Tasks 6 and 7 together form the reasoning+offering cut-over. The build is green again at the end of Task 7. Run them back-to-back; do not interleave other work.

**Files:**
- Rewrite: `apps/user-client/src/lib/reasoning-resolver.ts`
- Rewrite: `apps/user-client/tests/unit/reasoning-resolver.test.ts`

- [ ] **Step 1: Rewrite the test**

Replace `apps/user-client/tests/unit/reasoning-resolver.test.ts` with:
```ts
import { describe, expect, it } from 'vitest';
import type { ReasoningControl } from '@chatsundere/llm-unified';
import {
  initialReasoningState,
  resolveReasoningBodyExtras,
} from '../../src/lib/reasoning-resolver.js';

const NONE: ReasoningControl = { mode: 'none' };
const FIXED: ReasoningControl = { mode: 'fixed-on' };
const TOGGLE_ON: ReasoningControl = { mode: 'toggle', defaultOn: true };
const TOGGLE_OFF: ReasoningControl = { mode: 'toggle', defaultOn: false };
const STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};

describe('initialReasoningState', () => {
  it('none → off', () => expect(initialReasoningState(NONE)).toEqual({ kind: 'off' }));
  it('fixed-on → on', () => expect(initialReasoningState(FIXED)).toEqual({ kind: 'on' }));
  it('toggle defaultOn → on', () => expect(initialReasoningState(TOGGLE_ON)).toEqual({ kind: 'on' }));
  it('toggle !defaultOn → off', () =>
    expect(initialReasoningState(TOGGLE_OFF)).toEqual({ kind: 'off' }));
  it('steps → step at defaultStep', () =>
    expect(initialReasoningState(STEPS)).toEqual({ kind: 'step', step: 'medium' }));
});

describe('resolveReasoningBodyExtras', () => {
  it('none → empty', () => expect(resolveReasoningBodyExtras(NONE, { kind: 'off' })).toEqual({}));
  it('fixed-on → empty', () => expect(resolveReasoningBodyExtras(FIXED, { kind: 'on' })).toEqual({}));
  it('toggle on → enabled true', () =>
    expect(resolveReasoningBodyExtras(TOGGLE_ON, { kind: 'on' })).toEqual({
      reasoning: { enabled: true },
    }));
  it('toggle off → enabled false', () =>
    expect(resolveReasoningBodyExtras(TOGGLE_ON, { kind: 'off' })).toEqual({
      reasoning: { enabled: false },
    }));
  it('steps step → enabled true + effort', () =>
    expect(resolveReasoningBodyExtras(STEPS, { kind: 'step', step: 'high' })).toEqual({
      reasoning: { enabled: true, effort: 'high' },
    }));
  it('steps off → enabled false', () =>
    expect(resolveReasoningBodyExtras(STEPS, { kind: 'off' })).toEqual({
      reasoning: { enabled: false },
    }));
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @chatsundere/user-client test -- reasoning-resolver`
Expected: FAIL (old signatures take `KnownModel`).

- [ ] **Step 3: Rewrite the resolver**

Replace `apps/user-client/src/lib/reasoning-resolver.ts` with:
```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { ReasoningControl, ReasoningIntent } from '@chatsundere/llm-unified';

/**
 * Cockpit-side reasoning selection, mirroring the ReasoningControl modes:
 *   - `off`  — reasoning disabled (toggle-off or the steps `offStep`)
 *   - `on`   — reasoning enabled, no granular step (toggle / fixed-on)
 *   - `step` — a chosen effort step (steps mode)
 */
export type ReasoningState = { kind: 'off' } | { kind: 'on' } | { kind: 'step'; step: string };

/** Derive the initial UI reasoning state from the offering's control. */
export function initialReasoningState(control: ReasoningControl): ReasoningState {
  switch (control.mode) {
    case 'none':
      return { kind: 'off' };
    case 'fixed-on':
      return { kind: 'on' };
    case 'toggle':
      return control.defaultOn ? { kind: 'on' } : { kind: 'off' };
    case 'steps':
      return { kind: 'step', step: control.defaultStep };
  }
}

/**
 * Map control + state onto request-body extras the engine shallow-merges.
 * `none`/`fixed-on` are unsteerable → no intent emitted. Steps map the chosen
 * label onto the canonical low/medium/high effort; anything else falls back to
 * a bare enabled intent. The per-provider wire translation stays in
 * `applyReasoningToBody`.
 */
export function resolveReasoningBodyExtras(
  control: ReasoningControl,
  state: ReasoningState,
): Record<string, unknown> {
  if (control.mode === 'none' || control.mode === 'fixed-on') return {};
  if (control.mode === 'toggle') {
    const intent: ReasoningIntent = { enabled: state.kind !== 'off' };
    return { reasoning: intent };
  }
  // steps
  if (state.kind === 'off') {
    const intent: ReasoningIntent = { enabled: false };
    return { reasoning: intent };
  }
  const step = state.kind === 'step' ? state.step : control.defaultStep;
  const intent: ReasoningIntent =
    step === 'low' || step === 'medium' || step === 'high'
      ? { enabled: true, effort: step }
      : { enabled: true };
  return { reasoning: intent };
}
```

- [ ] **Step 4: Run — expect PASS (resolver test only; package build is red until Task 7)**

Run: `pnpm --filter @chatsundere/user-client test -- reasoning-resolver`
Expected: PASS. (A full `build` will fail until Task 7 updates the consumers — that is expected and resolved there.)

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/reasoning-resolver.ts apps/user-client/tests/unit/reasoning-resolver.test.ts
git commit -m "Rewrite reasoning-resolver against ReasoningControl"
```

---

## Task 7: Offering cut-over — cockpit, send path, chat-page (`user-client`)

Thread the resolved `Offering` everywhere `model: KnownModel` was threaded, switch leaf reads to `offering.profile`/`offering.context`, rewrite `CockpitMenu`, and resolve offerings via `getOffering` in the send path. Ends green.

**Files:**
- Modify: `apps/user-client/src/components/chat/CockpitMenu.tsx`
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx`
- Modify: `apps/user-client/src/components/chat/InteractionMode.tsx`
- Modify: `apps/user-client/src/lib/stream-engine.ts`
- Modify: `apps/user-client/src/lib/title-generator.ts`
- Modify: `apps/user-client/src/data/send-message.ts`
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx`
- Modify tests: `apps/user-client/tests/unit/cockpit-menu.test.tsx` (rewrite for control), plus any cockpit/interaction-mode/use-send-message tests that construct a `KnownModel`.

- [ ] **Step 1: Rewrite the CockpitMenu test**

Replace `apps/user-client/tests/unit/cockpit-menu.test.tsx` reasoning-shape setup to drive `control: ReasoningControl`. Core cases:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReasoningControl } from '@chatsundere/llm-unified';
import { CockpitMenu } from '../../src/components/chat/CockpitMenu.js';

const noop = () => {};

function renderMenu(control: ReasoningControl, reasoning = { kind: 'off' as const }) {
  return render(
    <CockpitMenu control={control} reasoning={reasoning} onReasoningChange={noop} onClose={noop} />,
  );
}

describe('CockpitMenu reasoning', () => {
  it('none → renders nothing', () => {
    const { container } = renderMenu({ mode: 'none' });
    expect(container.firstChild).toBeNull();
  });
  it('fixed-on → a single disabled lit On indicator', () => {
    renderMenu({ mode: 'fixed-on' }, { kind: 'on' });
    const on = screen.getByRole('button', { name: /on/i });
    expect(on).toBeDisabled();
    expect(on.getAttribute('data-active')).toBe('true');
  });
  it('toggle → On/Off chips', () => {
    renderMenu({ mode: 'toggle', defaultOn: true });
    expect(screen.getByRole('button', { name: /^on$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^off$/i })).toBeEnabled();
  });
  it('steps → one chip per step plus Off', () => {
    renderMenu({ mode: 'steps', steps: ['low', 'medium', 'high'], offStep: 'off', defaultStep: 'medium' });
    for (const s of ['low', 'medium', 'high']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${s}$`, 'i') })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /^off$/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @chatsundere/user-client test -- cockpit-menu`
Expected: FAIL (CockpitMenu still takes `model`).

- [ ] **Step 3a: Rewrite `CockpitMenu.tsx`**

Replace `apps/user-client/src/components/chat/CockpitMenu.tsx` with:
```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { ReasoningControl } from '@chatsundere/llm-unified';
import type { ReasoningState } from '../../lib/reasoning-resolver.js';

interface Props {
  control: ReasoningControl;
  reasoning: ReasoningState;
  onReasoningChange: (r: ReasoningState) => void;
  onClose: () => void;
}

export function CockpitMenu(p: Props): JSX.Element | null {
  if (p.control.mode === 'none') return null;

  return (
    <div className="cockpit-menu" role="menu">
      <div className="cockpit-menu-section" data-section="reasoning">
        <div className="cockpit-menu-label">Reasoning</div>
        {renderReasoning(p)}
      </div>
    </div>
  );
}

function chip(
  label: string,
  active: boolean,
  opts: { disabled?: boolean; onClick?: () => void; dataAttr?: [string, string] },
): JSX.Element {
  const [attrKey, attrVal] = opts.dataAttr ?? [];
  return (
    <button
      key={label}
      type="button"
      className="cockpit-menu-chip"
      disabled={opts.disabled}
      data-active={active ? 'true' : undefined}
      {...(attrKey ? { [attrKey]: attrVal } : {})}
      onClick={opts.onClick}
    >
      {label}
    </button>
  );
}

function renderReasoning(p: Props): JSX.Element {
  const c = p.control;

  // fixed-on: a lit, non-interactive affirmation that the model reasons.
  if (c.mode === 'fixed-on') {
    return <div className="cockpit-menu-chips">{chip('On', true, { disabled: true })}</div>;
  }

  if (c.mode === 'toggle') {
    return (
      <div className="cockpit-menu-chips">
        {chip('On', p.reasoning.kind === 'on', {
          onClick: () => p.onReasoningChange({ kind: 'on' }),
          dataAttr: ['data-action', 'on'],
        })}
        {chip('Off', p.reasoning.kind === 'off', {
          onClick: () => p.onReasoningChange({ kind: 'off' }),
          dataAttr: ['data-action', 'off'],
        })}
      </div>
    );
  }

  // steps
  return (
    <div className="cockpit-menu-chips">
      {c.steps.map((s) =>
        chip(s, p.reasoning.kind === 'step' && p.reasoning.step === s, {
          onClick: () => p.onReasoningChange({ kind: 'step', step: s }),
          dataAttr: ['data-bucket', s],
        }),
      )}
      {c.offStep !== null
        ? chip('Off', p.reasoning.kind === 'off', {
            onClick: () => p.onReasoningChange({ kind: 'off' }),
            dataAttr: ['data-action', 'off'],
          })
        : null}
    </div>
  );
}
```

- [ ] **Step 3b: Update `Cockpit.tsx`**

In `apps/user-client/src/components/chat/Cockpit.tsx`:
- Change the prop type import from `KnownModel` to `Offering` (`import type { Offering } from '@chatsundere/llm-unified';`).
- In `interface Props` replace `model: KnownModel;` with `offering: Offering;`.
- At the `<CockpitMenu .../>` usage (line ~105) replace `model={p.model}` with `control={p.offering.profile.reasoning}`.

- [ ] **Step 3c: Update `InteractionMode.tsx`**

In `apps/user-client/src/components/chat/InteractionMode.tsx`:
- Replace `model: KnownModel;` with `offering: Offering;` (and the import).
- Line ~106 `contextWindow={p.model.contextWindow}` → `contextWindow={p.offering.context.recommended}`.
- Wherever it passes `model` down to `Cockpit`, pass `offering={p.offering}`.

- [ ] **Step 3d: Update `stream-engine.ts`**

In `apps/user-client/src/lib/stream-engine.ts`:
- `StartStreamArgs`: replace `model: KnownModel;` with `offering: Offering;` (import `Offering`, `offeringToTarget` from `@chatsundere/llm-unified`).
- The reasoning extras call (lines 66-69):
```ts
const extras: Record<string, unknown> = {
  ...resolveReasoningBodyExtras(args.offering.profile.reasoning, args.reasoning),
  temperature: args.persona.temperature,
};
```
- The `streamCompletion` call (replace the `target:` line added in Task 4): `target: offeringToTarget(args.offering),`.

- [ ] **Step 3e: Update `title-generator.ts`**

In `apps/user-client/src/lib/title-generator.ts`:
- `TitleGenArgs`: replace `model: KnownModel;` with `offering: Offering;` (import `Offering`, `offeringToTarget`).
- The `runOneShotCompletion` call: `target: offeringToTarget(args.offering),`.

- [ ] **Step 3f: Update `send-message.ts`**

In `apps/user-client/src/data/send-message.ts`, both `useSendMessage` (lines 81-89) and `useRegenerate` (lines 197-205): replace the `knownModels.find` resolution with offering resolution and pass `offering` to the stream manager. Import `getOffering` from `@chatsundere/llm-unified`. Replace each block:
```ts
const offering = getOffering(provider.templateId, persona.modelId);
if (!offering)
  throw new Error(
    `useSendMessage: no offering for "${persona.modelId}" on provider "${provider.templateId}" — re-pick the model`,
  );
```
(use `useRegenerate:` in the second block's message), and in the `start({ ... })` payload replace `model,` with `offering,`.

- [ ] **Step 3g: Update `chat-page.tsx`**

In `apps/user-client/src/routes/app/chat/chat-page.tsx`:
- The model resolution (lines 122-123) becomes:
```ts
const def = getProvider(provider.templateId);
const slug = effectivePersona.modelId;
return def && slug ? (getOffering(provider.templateId, slug) ?? null) : null;
```
  (rename the query result to `offeringQuery`/`offering` as appropriate; import `getOffering`).
- Where `initialReasoningState(model)` was called (line ~130), call `initialReasoningState(offering.profile.reasoning)`.
- Where the offering/model is passed to `InteractionMode`/`Cockpit`, pass `offering={offering}`.

- [ ] **Step 3h: Fix remaining `KnownModel` test constructions**

Run the user-client tests; for any failing test that builds a `KnownModel` mock for cockpit/interaction-mode/use-send-message, replace it with an `Offering` mock, e.g.:
```ts
import { getOffering } from '@chatsundere/llm-unified';
const offering = getOffering('chutes', 'zai-org/GLM-5.1-TEE')!;
```
(or an inline literal matching the `Offering` shape). Pass `offering={offering}` / `offering` instead of `model`.

- [ ] **Step 4: Run everything — expect PASS / green build**

Run: `pnpm --filter @chatsundere/user-client test`
Run: `pnpm --filter @chatsundere/user-client build`
Expected: all PASS, build clean.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src apps/user-client/tests
git commit -m "Cut the client over to canonical offerings and ReasoningControl"
```

---

## Task 8: Two-level picker — canonical-first (`user-client`)

Rewrite `ModelList` into the two-level picker, remove the custom-model input, and wire `canonicalId` into the persona draft, validation, and meta string.

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx` (`ModelList`, lines 486-548; selection wiring lines 122-128, 169, 332-337)
- Modify tests: `apps/user-client/tests/routes/persona-editor.dynamic-meta.test.tsx`, `persona-editor.required-markers.test.tsx` (canonicalId now required)
- Create test: `apps/user-client/tests/routes/persona-editor.model-picker.test.tsx`

- [ ] **Step 1: Write the failing picker test**

`apps/user-client/tests/routes/persona-editor.model-picker.test.tsx` — render the editor (follow the existing persona-editor test harness for store/router setup), then assert: (a) canonical models are listed (e.g. "GLM 5.1" appears once, not once-per-provider); (b) selecting a canonical reveals its offerings with the TEE one pre-highlighted; (c) an unconfigured provider's offering is shown disabled with a CTA; (d) no "Custom model id" input exists. Use the existing harness in `persona-editor.dynamic-meta.test.tsx` as the template for setup. Minimal assertions:
```tsx
expect(screen.queryByPlaceholderText(/custom model id/i)).toBeNull();
expect(screen.getAllByText('GLM 5.1')).toHaveLength(1);
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @chatsundere/user-client test -- model-picker`
Expected: FAIL.

- [ ] **Step 3a: Rewrite `ModelList`**

Replace `ModelList` (lines 486-548) with a two-level picker. It receives configured providers and the current selection, and emits `(canonicalId, providerRowId, upstreamSlug)`:
```tsx
function ModelList({
  providers,
  selectedCanonicalId,
  selectedProviderId,
  selectedModelId,
  onSelect,
}: {
  providers: ProviderRow[];
  selectedCanonicalId: string | null;
  selectedProviderId: string;
  selectedModelId: string;
  onSelect: (canonicalId: string, providerId: string, upstreamSlug: string) => void;
}): JSX.Element {
  const enabled = providers.filter((p) => p.enabled);
  // Provider templates the user has configured, for intersecting offerings.
  const configuredByTemplate = new Map(enabled.map((p) => [p.templateId, p]));

  return (
    <div className="flex flex-col gap-4">
      {/* Stage 1: canonical models */}
      <div className="flex flex-col gap-2">
        {listCanonicals().map((c) => {
          const offers = listOfferings(c.id);
          const teeAvailable = offers.some((o) => o.trust.tee);
          const active = selectedCanonicalId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                // Pre-select the top-ranked *configured* offering, if any.
                const suggested =
                  offers.find((o) => configuredByTemplate.has(o.providerId)) ?? offers[0];
                if (suggested) {
                  const row = configuredByTemplate.get(suggested.providerId);
                  onSelect(c.id, row?.id ?? selectedProviderId, suggested.upstreamSlug);
                } else {
                  onSelect(c.id, selectedProviderId, selectedModelId);
                }
              }}
              className={`flex items-center justify-between gap-3 rounded-md border p-3 text-left ${
                active ? 'border-paper bg-white/[0.04]' : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
              }`}
            >
              <div className="font-display text-sm text-paper">{c.displayName}</div>
              <div className="flex items-center gap-2 text-xs text-paper-soft">
                {teeAvailable ? <span className="rounded bg-white/10 px-1.5 py-0.5">TEE</span> : null}
                <span>{offers.length} provider{offers.length === 1 ? '' : 's'}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Stage 2: offerings for the chosen canonical */}
      {selectedCanonicalId ? (
        <div className="flex flex-col gap-2">
          <div className="text-xs uppercase tracking-wider text-paper-soft">Deployment</div>
          {listOfferings(selectedCanonicalId).map((o) => {
            const row = configuredByTemplate.get(o.providerId);
            const configured = !!row;
            const def = getProvider(o.providerId);
            const active = configured && selectedProviderId === row.id && selectedModelId === o.upstreamSlug;
            return (
              <button
                key={`${o.providerId}:${o.upstreamSlug}`}
                type="button"
                disabled={!configured}
                onClick={() => configured && onSelect(selectedCanonicalId, row.id, o.upstreamSlug)}
                className={`flex items-center justify-between gap-3 rounded-md border p-3 text-left disabled:opacity-50 ${
                  active ? 'border-paper bg-white/[0.04]' : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
                }`}
              >
                <div>
                  <div className="font-display text-sm text-paper">{def?.displayName ?? o.providerId}</div>
                  <div className="text-xs text-paper-soft">
                    {o.trust.tee ? 'TEE · ' : ''}
                    {o.context.recommended.toLocaleString()} ctx
                    {configured ? '' : ` · add ${def?.displayName ?? o.providerId} to use this deployment`}
                  </div>
                </div>
                {active ? <span>✓</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3b: Wire the selection in `PersonaEditor`**

Add the catalogue imports at the top of `persona-editor.tsx`:
```ts
import { getCanonical, getOffering, getProvider, listCanonicals, listOfferings } from '@chatsundere/llm-unified';
```
(merge with the existing `getProvider` import if present.)

- Replace `selectedModelDef`/`modelMeta` (lines 122-128) with:
```ts
const selectedCanonical = draft.canonicalId ? getCanonical(draft.canonicalId) : undefined;
const selectedProvider = providers.data?.find((p) => p.id === draft.providerId);
const selectedOffering =
  selectedProvider && draft.modelId
    ? getOffering(selectedProvider.templateId, draft.modelId)
    : undefined;
const modelMeta: ReactNode =
  selectedCanonical && selectedProvider
    ? `${selectedCanonical.displayName} · via ${getProvider(selectedProvider.templateId)?.displayName ?? selectedProvider.templateId}`
    : 'Pick a model';
```
- Validation (line 169): `const personaInvalid = !draft.name || !draft.instructions || !draft.providerId || !draft.modelId || !draft.canonicalId;` (and the `saveDisabled`/`requiredMarker` expressions that mirror it).
- The `<ModelList .../>` usage (lines 332-337):
```tsx
<ModelList
  providers={providers.data ?? []}
  selectedCanonicalId={draft.canonicalId}
  selectedProviderId={draft.providerId}
  selectedModelId={draft.modelId}
  onSelect={(canonicalId, providerId, modelId) => patch({ canonicalId, providerId, modelId })}
/>
```

- [ ] **Step 3c: Update the affected persona-editor tests**

- `persona-editor.required-markers.test.tsx`: a persona is now also invalid without `canonicalId` — set `canonicalId` in any fixture expected to be valid.
- `persona-editor.dynamic-meta.test.tsx`: the meta string is now `"<Canonical> · via <Provider>"`; update the expectation and set `canonicalId` in the draft fixture.

- [ ] **Step 4: Run — expect PASS / green build**

Run: `pnpm --filter @chatsundere/user-client test`
Run: `pnpm --filter @chatsundere/user-client build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/tests/routes
git commit -m "Add canonical-first two-level model picker"
```

---

## Task 9: Remove `KnownModel`/`ReasoningCapability` (`llm-unified` cleanup)

With no consumers left, delete the old shapes.

**Files:**
- Modify: `packages/llm-unified/src/types.ts` (remove `KnownModel`, `ReasoningCapability`, `ReasoningEffortSpec`; remove `knownModels` from `ProviderDefinition`)
- Modify: `packages/llm-unified/src/index.ts` (drop the three type exports)
- Modify: `packages/llm-unified/src/providers/{chutes,nano-gpt,novita,ollama-cloud}.ts` (remove `knownModels`, the `MODELS`/`REASONING`/`knownModels` scaffolding; keep `registerChutes` adapter registration)
- Modify: `packages/llm-unified/src/types.test.ts` (remove `KnownModel`/`ReasoningCapability` cases)

- [ ] **Step 1: Verify there are no remaining references**

Run:
```bash
rg -n "KnownModel|ReasoningCapability|ReasoningEffortSpec|knownModels" packages/llm-unified/src apps/user-client/src apps/user-client/tests
```
Expected: only the definitions/exports to be removed (no live consumers). If a consumer remains, fix it before deleting.

- [ ] **Step 2: Remove the shapes**

- `types.ts`: delete `ReasoningEffortSpec` (15-18), `ReasoningCapability` (20-32), `KnownModel` (34-49); in `ProviderDefinition` delete the `knownModels: KnownModel[];` line (62).
- `index.ts`: remove `KnownModel,`, `ReasoningCapability,`, `ReasoningEffortSpec,` from the `export type { ... } from './types.js'` block.
- Each provider file: delete `knownModels` (and chutes' `MODELS`/`REASONING` only if now unused — note `registerChutes` still iterates the slugs to register adapters; if it used `MODELS`, replace that loop to iterate `offerings` instead: `for (const o of offerings) registerAdapter(o.adapter.kind === 'catalogue' ? o.adapter.adapterId : '', chutesAdapter(o.upstreamSlug, o.profile.vision));` — guard the empty-string case out, or iterate a local slug list).
- `types.test.ts`: delete the `KnownModel`/`ReasoningCapability` test cases.

- [ ] **Step 3: Run the full suite + builds**

Run:
```bash
cd packages/llm-unified && bun test ./src/ && bun test ./curation/
cd ../.. && pnpm typecheck && pnpm --filter @chatsundere/llm-unified build && pnpm --filter @chatsundere/user-client build
```
Expected: all green.

- [ ] **Step 4: Final reference sweep**

Run: `rg -n "KnownModel|ReasoningCapability|knownModels" packages apps` → expect no matches.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src apps
git commit -m "Remove KnownModel and ReasoningCapability after catalogue cut-over"
```

---

## Task 10: Larissa security gate + STATUS update

- [ ] **Step 1: Summon Larissa** for the `packages/llm-unified` changes (the curation/adapter surface). Frontend-only changes skip the audit, but the `llm-unified` runtime (`stream-completion`, `one-shot`, registry) is in scope. Provide the diff + this spec + the Slice 1 spec. Address findings; record any conscious deferrals in `obsidian/insights/security-deferrals.md`.

- [ ] **Step 2: Update `obsidian/STATUS-CLIENT-ONLY.md`** — move Slice 2 from "Briefed" to "Done"; refresh the "Next session" block (Slice 3 + custom-model-as-uncatalogued-offering follow-up + provider-only re-pick follow-up); update `Last updated:`.

- [ ] **Step 3: Manual verification (Chris).** Run the §7 manual-verification steps from the spec on device. Needs at least one configured provider (e.g. `NANO_GPT_API_KEY` / chutes key).

- [ ] **Step 4: Squash-merge** the Slice 2 work into one feature commit on `master` (Liz only — subagents never merge/push/switch branches).

---

## Self-review notes (author)

- **Spec coverage:** §3.1 catalogue data → T1, T2; §3.2 ranking → T3; §3.3 persona schema → T5; §3.4 data flow (pick/send/runtime) → T4 (runtime), T6/T7 (send + reasoning), T8 (pick); §4 reasoning mapping → T2 (authoring) + T6 (resolver); §5.1 cockpit incl. lit-disabled fixed-on → T7; §5.2 picker incl. custom-input removal → T8; §6 tests → woven per task; §2.4 clean break → T5 (v8) + T7 (send-message throws "re-pick") + T8 (validation requires canonicalId).
- **Type consistency:** `CompletionTarget {slug, adapterId?}` (T4) consumed identically in T4/T7; `ReasoningState {kind:'off'|'on'|'step'}` (T6) used in T6/T7; `onSelect(canonicalId, providerId, upstreamSlug)` (T8) matches the `patch({canonicalId, providerId, modelId})` mapping.
- **Sequencing:** Tasks 6+7 are one reasoning/offering cut-over; the build is red between them and green at the end of T7 (flagged in T6). Every other task ends green.
</content>
