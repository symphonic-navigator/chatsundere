# `/curate` Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the machine adapter-synthesis pipeline with an interactive `/curate` Claude Code skill, backed by a deterministic conversation-suite verification harness.

**Architecture:** Retire `synthesis/` and the CLI curation driver; migrate the genuinely hand-written provider knowledge (`provider-scanner.ts`, `model-file.ts`) into `src/providers/curation/`; keep the catalogue data model untouched. Add a deterministic conversation-suite (pure assertion library + scenario schema + live runner) under `packages/llm-unified/curation/`. Author the skill as a project-local `.claude/skills/curate/` with an intent router and per-mode reference playbooks.

**Tech Stack:** TypeScript (strict), Bun test runner, Valibot (already in `catalogue/`), Markdown skill references.

**Spec:** [`superpowers/specs/2026-05-30-curate-skill-design.md`](../specs/2026-05-30-curate-skill-design.md)

---

## File Structure

**Deleted:**
- `packages/llm-unified/src/synthesis/` (entire directory — ~15 files + tests)
- `packages/llm-unified/src/curate/cli.ts`, `cli-dispatch.ts`, `cli-dispatch.test.ts`, `build.ts`, `build.test.ts`, `synthesise.ts`, `report.ts`, `report.test.ts`, `write-back.ts`, `write-back.test.ts`

**Moved (git mv, preserve history):**
- `src/curate/provider-scanner.ts` → `src/providers/curation/provider-scanner.ts`
- `src/curate/provider-scanner.test.ts` → `src/providers/curation/provider-scanner.test.ts`
- `src/curate/model-file.ts` → `src/providers/curation/model-file.ts`
- `src/curate/model-file.test.ts` → `src/providers/curation/model-file.test.ts`

**Created — conversation-suite (testable code):**
- `packages/llm-unified/curation/conversation-suite/types.ts`
- `packages/llm-unified/curation/conversation-suite/assertions.ts`
- `packages/llm-unified/curation/conversation-suite/assertions.test.ts`
- `packages/llm-unified/curation/conversation-suite/scenario.ts`
- `packages/llm-unified/curation/conversation-suite/scenarios/core.ts` (seed scenario data)
- `packages/llm-unified/curation/conversation-suite/runner.ts` (live; manual-verify only)
- `packages/llm-unified/curation/conversation-suite/report.ts`
- `packages/llm-unified/curation/conversation-suite/report.test.ts`
- `packages/llm-unified/curation/conversation-suite/index.ts`

**Created — skill (markdown):**
- `.claude/skills/curate/SKILL.md`
- `.claude/skills/curate/references/catalogue-model.md`
- `.claude/skills/curate/references/conventions.md`
- `.claude/skills/curate/references/model-curation.md`
- `.claude/skills/curate/references/provider-onboarding.md`
- `.claude/skills/curate/references/verify-offering.md`
- `.claude/skills/curate/references/batch-check.md`
- `.claude/skills/curate/references/conversation-suite.md`

**Modified:**
- `packages/llm-unified/src/types.ts` (add `NormalisedUsage` + `usage` StreamChunk variant)
- `packages/llm-unified/package.json` (remove `synthesise` + `curate` scripts; add `curate:suite` test/run script)
- `CLAUDE.md` (§10 Quality Bar addition)
- `README.md` (progressive-discovery pointer)

**Left untouched (look-before-delete):**
- `models/glm-5.1.yaml` — real curation work; keep.
- `packages/llm-unified/fixtures/deepseek-v4-pro.fixtures.json` — orphaned spike evidence; leave in place, flag for Chris, do NOT delete.

---

## Phase A — Retire & Migrate

### Task A1: Confirm no external consumers, then delete `synthesis/`

**Files:**
- Delete: `packages/llm-unified/src/synthesis/` (whole directory)

- [ ] **Step 1: Re-confirm nothing imports synthesis outside itself**

Run: `rg -l "from ['\"].*synthesis" packages/llm-unified/src --type ts | rg -v "src/synthesis/"`
Expected: no output (empty).

- [ ] **Step 2: Delete the directory**

```bash
git rm -r packages/llm-unified/src/synthesis
```

- [ ] **Step 3: Remove the `synthesise` script from package.json**

In `packages/llm-unified/package.json`, delete the line:
```json
"synthesise": "bun run src/synthesis/cli.ts",
```

- [ ] **Step 4: Verify the package still builds**

Run: `cd packages/llm-unified && bun run build`
Expected: build succeeds, no missing-module errors.

- [ ] **Step 5: Run the kept tests**

Run: `cd packages/llm-unified && bun test`
Expected: PASS (the synthesis tests are gone; remaining tests are green).

- [ ] **Step 6: Commit**

```bash
git add -A packages/llm-unified
git commit -m "Retire synthesis engine (replaced by /curate skill)"
```

### Task A2: Delete the retired `curate/` CLI driver files

**Files:**
- Delete: `cli.ts`, `cli-dispatch.ts`, `cli-dispatch.test.ts`, `build.ts`, `build.test.ts`, `synthesise.ts`, `report.ts`, `report.test.ts`, `write-back.ts`, `write-back.test.ts` (all under `packages/llm-unified/src/curate/`)

- [ ] **Step 1: Confirm these files do not import the four kept files in a way that blocks deletion**

Run: `rg -n "provider-scanner|model-file" packages/llm-unified/src/curate/cli-dispatch.ts packages/llm-unified/src/curate/build.ts`
Expected: note any imports — the kept files must not import the deleted ones (they don't; scanner/model-file are leaves). If a deleted file imports a kept file, that's fine (we're deleting the importer).

- [ ] **Step 2: Delete the retired driver files**

```bash
git rm packages/llm-unified/src/curate/cli.ts \
       packages/llm-unified/src/curate/cli-dispatch.ts \
       packages/llm-unified/src/curate/cli-dispatch.test.ts \
       packages/llm-unified/src/curate/build.ts \
       packages/llm-unified/src/curate/build.test.ts \
       packages/llm-unified/src/curate/synthesise.ts \
       packages/llm-unified/src/curate/report.ts \
       packages/llm-unified/src/curate/report.test.ts \
       packages/llm-unified/src/curate/write-back.ts \
       packages/llm-unified/src/curate/write-back.test.ts
```

- [ ] **Step 3: Remove the `curate` script from package.json**

In `packages/llm-unified/package.json`, delete the line:
```json
"curate": "bun run src/curate/cli.ts",
```

- [ ] **Step 4: Verify build + tests**

Run: `cd packages/llm-unified && bun run build && bun test`
Expected: build succeeds; remaining tests pass. (`provider-scanner.test.ts` and `model-file.test.ts` still live in `src/curate/` at this point — they should still pass.)

- [ ] **Step 5: Commit**

```bash
git add -A packages/llm-unified
git commit -m "Retire curate CLI driver (kept scanner + model-file for migration)"
```

### Task A3: Migrate `provider-scanner` + `model-file` into `src/providers/curation/`

**Files:**
- Move: `src/curate/provider-scanner.ts` → `src/providers/curation/provider-scanner.ts`
- Move: `src/curate/provider-scanner.test.ts` → `src/providers/curation/provider-scanner.test.ts`
- Move: `src/curate/model-file.ts` → `src/providers/curation/model-file.ts`
- Move: `src/curate/model-file.test.ts` → `src/providers/curation/model-file.test.ts`

- [ ] **Step 1: Create the target directory and move the four files**

```bash
mkdir -p packages/llm-unified/src/providers/curation
git mv packages/llm-unified/src/curate/provider-scanner.ts packages/llm-unified/src/providers/curation/provider-scanner.ts
git mv packages/llm-unified/src/curate/provider-scanner.test.ts packages/llm-unified/src/providers/curation/provider-scanner.test.ts
git mv packages/llm-unified/src/curate/model-file.ts packages/llm-unified/src/providers/curation/model-file.ts
git mv packages/llm-unified/src/curate/model-file.test.ts packages/llm-unified/src/providers/curation/model-file.test.ts
```

- [ ] **Step 2: Fix relative imports in the moved files**

The files moved from `src/curate/` (depth 2) to `src/providers/curation/` (depth 3). Any import of the form `from '../types.js'` becomes `from '../../types.js'`; `from '../catalogue/...'` becomes `from '../../catalogue/...'`. Inspect and update:

Run: `rg -n "from '\.\./" packages/llm-unified/src/providers/curation/`
For each match, prepend one `../` level. Imports between the two moved files (e.g. scanner importing model-file) stay as `./model-file.js`.

- [ ] **Step 3: Verify the `src/curate/` directory is now empty (only README remains)**

Run: `ls packages/llm-unified/src/curate/`
Expected: only `README.md` (and that will be removed/rewritten in Task C; for now leave it).

- [ ] **Step 4: Verify build + tests pass after the move**

Run: `cd packages/llm-unified && bun run build && bun test`
Expected: build succeeds; `provider-scanner.test.ts` and `model-file.test.ts` pass from their new home.

- [ ] **Step 5: Commit**

```bash
git add -A packages/llm-unified
git commit -m "Migrate provider-scanner and model-file into providers/curation"
```

---

## Phase B — Conversation-Suite Harness

### Task B1: Add `NormalisedUsage` type + `usage` StreamChunk variant

**Files:**
- Modify: `packages/llm-unified/src/types.ts`

- [ ] **Step 1: Add the `NormalisedUsage` interface and extend `StreamChunk`**

In `packages/llm-unified/src/types.ts`, add `NormalisedUsage` near the other interfaces and add a `usage` variant to the `StreamChunk` union:

```typescript
/**
 * Per-response token accounting, normalised to one shape across providers.
 * Adapters extract this from the upstream `usage` object (which varies per
 * provider) inside their `parseChunk`.
 */
export interface NormalisedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Present when the provider reports reasoning/thinking tokens separately. */
  reasoningTokens?: number;
  /** Present when the provider reports prompt-cache hits. */
  cachedTokens?: number;
}
```

Then add this member to the `StreamChunk` union (after the `tool-call` member):
```typescript
  | { type: 'usage'; usage: NormalisedUsage }
```

- [ ] **Step 2: Export `NormalisedUsage` from the package index**

In `packages/llm-unified/src/index.ts`, add `NormalisedUsage` to the existing `export type { ... } from './types.js';` block.

- [ ] **Step 3: Verify build**

Run: `cd packages/llm-unified && bun run build`
Expected: build succeeds. (Existing `StreamChunk` consumers must still compile — adding a union member is additive, but a `switch` with no default may warn; check `streaming.ts` / `stream-completion.ts` handle the new case or have a default. If a non-exhaustive switch breaks the build, add a `case 'usage':` that is a no-op passthrough where appropriate.)

- [ ] **Step 4: Commit**

```bash
git add packages/llm-unified/src/types.ts packages/llm-unified/src/index.ts
git commit -m "Add NormalisedUsage type and usage StreamChunk variant"
```

### Task B2: Conversation-suite core types

**Files:**
- Create: `packages/llm-unified/curation/conversation-suite/types.ts`

- [ ] **Step 1: Write the types**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import type { NormalisedUsage, StreamChunk } from '../../src/types.js';

/** The assembled result of running one conversation turn against a model. */
export interface TurnOutcome {
  /** HTTP status of the upstream call (200-class = ok). */
  httpStatus: number;
  /** Raw assembled adapter output for the turn. */
  chunks: StreamChunk[];
  /** Concatenated `token` chunk text. */
  text: string;
  /** Concatenated `reasoning` chunk text. */
  reasoning: string;
  /** Tool calls the model emitted this turn. */
  toolCalls: { name: string; argumentsJson: string }[];
  /** Normalised usage if the adapter surfaced it, else null. */
  usage: NormalisedUsage | null;
  /** Finish reason if seen, else null. */
  finishReason: string | null;
}

export type AssertionStatus = 'pass' | 'fail';

export interface AssertionResult {
  /** Stable machine label, e.g. `tool-call-fired:generate_image`. */
  assertion: string;
  status: AssertionStatus;
  /** Human-readable explanation of the verdict. */
  detail: string;
}

/** A deterministic, pure check over a single turn's outcome. */
export type Assertion = (outcome: TurnOutcome) => AssertionResult;
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd packages/llm-unified && bunx tsc --noEmit -p tsconfig.json` (or `bun run build` if the curation dir is included by tsconfig; if not, add `curation` to the tsconfig `include` array in this step).
Expected: no type errors. If `curation/` is outside the tsconfig include globs, add `"curation/**/*.ts"` to `include`.

- [ ] **Step 3: Commit**

```bash
git add packages/llm-unified/curation packages/llm-unified/tsconfig.json
git commit -m "Add conversation-suite core types"
```

### Task B3: Assertion library (TDD)

**Files:**
- Create: `packages/llm-unified/curation/conversation-suite/assertions.ts`
- Test: `packages/llm-unified/curation/conversation-suite/assertions.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import type { TurnOutcome } from './types.js';
import {
  assertNoHttpError,
  assertToolCallFired,
  assertToolArgsValidJson,
  assertUsagePresent,
  assertReasoningPresent,
  assertReasoningAbsent,
  assertMemoryEchoed,
} from './assertions.js';

function outcome(partial: Partial<TurnOutcome>): TurnOutcome {
  return {
    httpStatus: 200,
    chunks: [],
    text: '',
    reasoning: '',
    toolCalls: [],
    usage: null,
    finishReason: null,
    ...partial,
  };
}

describe('assertNoHttpError', () => {
  test('passes on 200', () => {
    expect(assertNoHttpError(outcome({ httpStatus: 200 })).status).toBe('pass');
  });
  test('fails on 400 (the MiMo/chutes case)', () => {
    const r = assertNoHttpError(outcome({ httpStatus: 400 }));
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('400');
  });
});

describe('assertToolCallFired', () => {
  test('fails when the model produced text but did not fire the tool', () => {
    const r = assertToolCallFired('generate_image')(
      outcome({ text: 'Here is a prompt for an image...' }),
    );
    expect(r.status).toBe('fail');
  });
  test('passes when the tool fired', () => {
    const r = assertToolCallFired('generate_image')(
      outcome({ toolCalls: [{ name: 'generate_image', argumentsJson: '{"prompt":"x"}' }] }),
    );
    expect(r.status).toBe('pass');
  });
});

describe('assertToolArgsValidJson', () => {
  test('fails on malformed arguments', () => {
    const r = assertToolArgsValidJson('generate_image')(
      outcome({ toolCalls: [{ name: 'generate_image', argumentsJson: '{prompt:' }] }),
    );
    expect(r.status).toBe('fail');
  });
  test('passes on valid JSON args', () => {
    const r = assertToolArgsValidJson('generate_image')(
      outcome({ toolCalls: [{ name: 'generate_image', argumentsJson: '{"prompt":"x"}' }] }),
    );
    expect(r.status).toBe('pass');
  });
});

describe('assertUsagePresent', () => {
  test('fails when usage missing', () => {
    expect(assertUsagePresent(outcome({ usage: null })).status).toBe('fail');
  });
  test('passes when usage normalised', () => {
    const r = assertUsagePresent(
      outcome({ usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }),
    );
    expect(r.status).toBe('pass');
  });
});

describe('reasoning presence', () => {
  test('assertReasoningPresent fails when empty', () => {
    expect(assertReasoningPresent(outcome({ reasoning: '' })).status).toBe('fail');
  });
  test('assertReasoningPresent passes when present', () => {
    expect(assertReasoningPresent(outcome({ reasoning: 'let me think' })).status).toBe('pass');
  });
  test('assertReasoningAbsent passes when empty (reasoning-off permutation)', () => {
    expect(assertReasoningAbsent(outcome({ reasoning: '' })).status).toBe('pass');
  });
  test('assertReasoningAbsent fails when reasoning leaked despite off', () => {
    expect(assertReasoningAbsent(outcome({ reasoning: 'oops' })).status).toBe('fail');
  });
});

describe('assertMemoryEchoed', () => {
  test('passes when the memory token appears in the reply', () => {
    const r = assertMemoryEchoed('cat lover')(outcome({ text: 'As a cat lover, you...' }));
    expect(r.status).toBe('pass');
  });
  test('fails when the memory token is absent', () => {
    const r = assertMemoryEchoed('cat lover')(outcome({ text: 'Hello there.' }));
    expect(r.status).toBe('fail');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/llm-unified && bun test curation/conversation-suite/assertions.test.ts`
Expected: FAIL with "Cannot find module './assertions.js'" / undefined exports.

- [ ] **Step 3: Implement the assertion library**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import type { Assertion, AssertionResult, TurnOutcome } from './types.js';

/** Upstream returned a non-error status. Catches the MiMo/chutes 400 case. */
export function assertNoHttpError(outcome: TurnOutcome): AssertionResult {
  const ok = outcome.httpStatus >= 200 && outcome.httpStatus < 300;
  return {
    assertion: 'no-http-error',
    status: ok ? 'pass' : 'fail',
    detail: ok ? `HTTP ${outcome.httpStatus}` : `HTTP ${outcome.httpStatus} (expected 2xx)`,
  };
}

/** The named tool actually fired (not: the model merely talked about it). */
export function assertToolCallFired(toolName: string): Assertion {
  return (outcome) => {
    const fired = outcome.toolCalls.some((t) => t.name === toolName);
    return {
      assertion: `tool-call-fired:${toolName}`,
      status: fired ? 'pass' : 'fail',
      detail: fired
        ? `${toolName} fired`
        : `${toolName} did not fire (model produced text instead of calling the tool)`,
    };
  };
}

/** The named tool's arguments parse as JSON. */
export function assertToolArgsValidJson(toolName: string): Assertion {
  return (outcome) => {
    const call = outcome.toolCalls.find((t) => t.name === toolName);
    if (!call) {
      return {
        assertion: `tool-args-valid-json:${toolName}`,
        status: 'fail',
        detail: `${toolName} did not fire, so no arguments to validate`,
      };
    }
    try {
      JSON.parse(call.argumentsJson);
      return { assertion: `tool-args-valid-json:${toolName}`, status: 'pass', detail: 'arguments are valid JSON' };
    } catch (e) {
      return {
        assertion: `tool-args-valid-json:${toolName}`,
        status: 'fail',
        detail: `arguments are not valid JSON: ${(e as Error).message}`,
      };
    }
  };
}

/** Usage was surfaced and normalised. */
export function assertUsagePresent(outcome: TurnOutcome): AssertionResult {
  const ok = outcome.usage !== null && outcome.usage.totalTokens > 0;
  return {
    assertion: 'usage-present',
    status: ok ? 'pass' : 'fail',
    detail: ok ? `total ${outcome.usage?.totalTokens} tokens` : 'no normalised usage surfaced',
  };
}

/** Reasoning text was emitted (for reasoning-on permutations). */
export function assertReasoningPresent(outcome: TurnOutcome): AssertionResult {
  const ok = outcome.reasoning.trim().length > 0;
  return {
    assertion: 'reasoning-present',
    status: ok ? 'pass' : 'fail',
    detail: ok ? 'reasoning channel populated' : 'no reasoning emitted',
  };
}

/** No reasoning leaked (for reasoning-off permutations). */
export function assertReasoningAbsent(outcome: TurnOutcome): AssertionResult {
  const ok = outcome.reasoning.trim().length === 0;
  return {
    assertion: 'reasoning-absent',
    status: ok ? 'pass' : 'fail',
    detail: ok ? 'no reasoning leaked' : 'reasoning emitted despite being turned off',
  };
}

/** A memory token was echoed through the protocol into the reply. */
export function assertMemoryEchoed(token: string): Assertion {
  return (outcome) => {
    const ok = outcome.text.toLowerCase().includes(token.toLowerCase());
    return {
      assertion: `memory-echoed:${token}`,
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? `reply references "${token}"`
        : `reply does not reference "${token}" (memory not carried through the protocol)`,
    };
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/llm-unified && bun test curation/conversation-suite/assertions.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/curation/conversation-suite/assertions.ts packages/llm-unified/curation/conversation-suite/assertions.test.ts
git commit -m "Add deterministic conversation-suite assertion library"
```

### Task B4: Scenario schema + seed scenario

**Files:**
- Create: `packages/llm-unified/curation/conversation-suite/scenario.ts`
- Create: `packages/llm-unified/curation/conversation-suite/scenarios/core.ts`

- [ ] **Step 1: Write the scenario schema**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import type { ReasoningIntent, WireMessage } from '../../src/types.js';
import type { Assertion } from './types.js';

export interface ScenarioTurn {
  id: string;
  /** Messages to send this turn (user/tool side), relative to prior turns. */
  send: WireMessage[];
  /** Deterministic assertions applied to this turn's outcome. */
  assertions: Assertion[];
  /**
   * If set, the named tool is expected to fire; the runner synthesises a tool
   * result for the following turn so the conversation can continue.
   */
  expectToolCall?: string;
}

export interface ReasoningPermutation {
  /** e.g. 'reasoning-off', 'reasoning-on', 'effort:low'. */
  label: string;
  intent: ReasoningIntent;
}

export interface ConversationScenario {
  id: string;
  description: string;
  turns: ScenarioTurn[];
}
```

- [ ] **Step 2: Write the seed scenario**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import {
  assertMemoryEchoed,
  assertNoHttpError,
  assertToolArgsValidJson,
  assertToolCallFired,
  assertUsagePresent,
} from '../assertions.js';
import type { ConversationScenario } from '../scenario.js';

/**
 * The core capability scenario. It must GROW with the inference-runner's
 * capabilities (see CLAUDE.md §10): every new capability the runner gains gets
 * a turn here. Validation is purely technical/protocol — never a judgement of
 * the model's intelligence (a model being "dumb as bread" is a weights problem,
 * not a communication problem).
 */
export const coreScenario: ConversationScenario = {
  id: 'core',
  description: 'Tool call (generate_image), tool-result round-trip, and memory echo.',
  turns: [
    {
      id: 'plain-completion',
      send: [{ role: 'user', content: 'Reply with a one-sentence greeting.' }],
      assertions: [assertNoHttpError, assertUsagePresent],
    },
    {
      id: 'tool-call-generate-image',
      send: [{ role: 'user', content: 'Please create an image of a calico cat asleep on a windowsill.' }],
      expectToolCall: 'generate_image',
      assertions: [
        assertNoHttpError,
        assertToolCallFired('generate_image'),
        assertToolArgsValidJson('generate_image'),
        assertUsagePresent,
      ],
    },
    {
      id: 'memory-echo',
      send: [
        { role: 'system', content: 'Known fact about the user: the user is a cat lover.' },
        { role: 'user', content: 'Suggest a weekend activity for me.' },
      ],
      assertions: [assertNoHttpError, assertMemoryEchoed('cat'), assertUsagePresent],
    },
  ],
};
```

- [ ] **Step 3: Verify it type-checks**

Run: `cd packages/llm-unified && bun run build`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/llm-unified/curation/conversation-suite/scenario.ts packages/llm-unified/curation/conversation-suite/scenarios/core.ts
git commit -m "Add conversation-suite scenario schema and seed scenario"
```

### Task B5: Suite report renderer (TDD)

**Files:**
- Create: `packages/llm-unified/curation/conversation-suite/report.ts`
- Test: `packages/llm-unified/curation/conversation-suite/report.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { renderSuiteReport, type SuiteRun } from './report.js';

const run: SuiteRun = {
  scenarioId: 'core',
  offeringRef: 'nano:glm-5.1',
  permutations: [
    {
      label: 'reasoning-off',
      turns: [
        {
          turnId: 'tool-call-generate-image',
          results: [
            { assertion: 'no-http-error', status: 'pass', detail: 'HTTP 200' },
            { assertion: 'tool-call-fired:generate_image', status: 'fail', detail: 'did not fire' },
          ],
        },
      ],
    },
  ],
};

describe('renderSuiteReport', () => {
  test('reports an overall FAIL when any assertion fails', () => {
    const md = renderSuiteReport(run);
    expect(md).toContain('FAIL');
    expect(md).toContain('tool-call-fired:generate_image');
  });
  test('summarises the offering ref and permutation labels', () => {
    const md = renderSuiteReport(run);
    expect(md).toContain('nano:glm-5.1');
    expect(md).toContain('reasoning-off');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test curation/conversation-suite/report.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the report renderer**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import type { AssertionResult } from './types.js';

export interface TurnRun {
  turnId: string;
  results: AssertionResult[];
}

export interface PermutationRun {
  label: string;
  turns: TurnRun[];
}

export interface SuiteRun {
  scenarioId: string;
  offeringRef: string;
  permutations: PermutationRun[];
}

/** Deterministic Markdown summary of a suite run. No LLM, no judgement. */
export function renderSuiteReport(run: SuiteRun): string {
  const all = run.permutations.flatMap((p) => p.turns.flatMap((t) => t.results));
  const failed = all.filter((r) => r.status === 'fail');
  const overall = failed.length === 0 ? 'PASS' : 'FAIL';

  const lines: string[] = [];
  lines.push(`# Conversation-suite: ${run.offeringRef} — ${overall}`);
  lines.push('');
  lines.push(`Scenario: \`${run.scenarioId}\` · ${all.length} checks · ${failed.length} failed`);
  lines.push('');
  for (const perm of run.permutations) {
    lines.push(`## ${perm.label}`);
    for (const turn of perm.turns) {
      lines.push(`### ${turn.turnId}`);
      for (const r of turn.results) {
        const mark = r.status === 'pass' ? 'PASS' : 'FAIL';
        lines.push(`- [${mark}] \`${r.assertion}\` — ${r.detail}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test curation/conversation-suite/report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/curation/conversation-suite/report.ts packages/llm-unified/curation/conversation-suite/report.test.ts
git commit -m "Add deterministic conversation-suite report renderer"
```

### Task B6: Live runner + suite index (manual-verify only — needs keys)

**Files:**
- Create: `packages/llm-unified/curation/conversation-suite/runner.ts`
- Create: `packages/llm-unified/curation/conversation-suite/index.ts`
- Modify: `packages/llm-unified/package.json` (add `curate:suite` run script)

> No unit test: the runner hits a live provider and needs an API key from `keys/`. It is verified by Chris running it (Manual Verification §3). Keep the runner thin — assembly + orchestration only; the deterministic assertions and report carry the logic.

- [ ] **Step 1: Implement the runner**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { streamCompletion, type StreamCompletionArgs } from '../../src/stream-completion.js';
import type { ReasoningIntent, StreamChunk, WireMessage } from '../../src/types.js';
import type { ConversationScenario, ReasoningPermutation, ScenarioTurn } from './scenario.js';
import type { PermutationRun, SuiteRun, TurnRun } from './report.js';
import type { TurnOutcome } from './types.js';

/** How the caller wires the suite to a concrete provider + adapter + key. */
export interface RunnerBinding {
  offeringRef: string;
  /**
   * Execute one turn: send `messages` with the given reasoning intent, return
   * the assembled outcome. Implemented by the caller using streamCompletion +
   * the offering's adapter + the provider's key. Kept injectable so the
   * orchestration stays free of provider specifics.
   */
  runTurn(messages: WireMessage[], reasoning: ReasoningIntent): Promise<TurnOutcome>;
  /** Synthesise a tool-result message to feed back after a tool call. */
  toolResultFor(toolName: string, argumentsJson: string): WireMessage;
}

/** Assemble a TurnOutcome from a sequence of StreamChunks + an HTTP status. */
export function assembleOutcome(httpStatus: number, chunks: StreamChunk[]): TurnOutcome {
  let text = '';
  let reasoning = '';
  const toolCalls: { name: string; argumentsJson: string }[] = [];
  let usage: TurnOutcome['usage'] = null;
  let finishReason: string | null = null;
  for (const c of chunks) {
    if (c.type === 'token') text += c.text;
    else if (c.type === 'reasoning') reasoning += c.text;
    else if (c.type === 'tool-call') toolCalls.push({ name: c.name, argumentsJson: c.argumentsJson });
    else if (c.type === 'usage') usage = c.usage;
    else if (c.type === 'finish') finishReason = c.reason;
  }
  return { httpStatus, chunks, text, reasoning, toolCalls, usage, finishReason };
}

/** Run one scenario across one permutation. */
async function runPermutation(
  scenario: ConversationScenario,
  perm: ReasoningPermutation,
  binding: RunnerBinding,
): Promise<PermutationRun> {
  const history: WireMessage[] = [];
  const turns: TurnRun[] = [];
  for (const turn of scenario.turns) {
    history.push(...turn.send);
    const outcome = await binding.runTurn(history, perm.intent);
    turns.push({ turnId: turn.id, results: turn.assertions.map((a) => a(outcome)) });
    // Carry the model's reply into history; feed a synthetic tool result if expected.
    if (outcome.text) history.push({ role: 'assistant', content: outcome.text });
    if (turn.expectToolCall) {
      const call = outcome.toolCalls.find((t) => t.name === turn.expectToolCall);
      if (call) history.push(binding.toolResultFor(call.name, call.argumentsJson));
    }
  }
  return { label: perm.label, turns };
}

/** Run a scenario across every supplied reasoning permutation. */
export async function runSuite(
  scenario: ConversationScenario,
  permutations: ReasoningPermutation[],
  binding: RunnerBinding,
): Promise<SuiteRun> {
  const runs: PermutationRun[] = [];
  for (const perm of permutations) {
    runs.push(await runPermutation(scenario, perm, binding));
  }
  return { scenarioId: scenario.id, offeringRef: binding.offeringRef, permutations: runs };
}

export type { StreamCompletionArgs };
```

- [ ] **Step 2: Write the barrel index**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
export * from './types.js';
export * from './scenario.js';
export * from './assertions.js';
export * from './report.js';
export * from './runner.js';
export { coreScenario } from './scenarios/core.js';
```

- [ ] **Step 3: Add a run script to package.json**

In `packages/llm-unified/package.json` `scripts`, add:
```json
"curate:suite": "bun test curation/conversation-suite",
```
(This runs the deterministic unit tests for the suite. The live runner is driven by the skill, not this script.)

- [ ] **Step 4: Verify build + all suite unit tests pass**

Run: `cd packages/llm-unified && bun run build && bun test curation/conversation-suite`
Expected: build succeeds; assertion + report tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/curation packages/llm-unified/package.json
git commit -m "Add conversation-suite live runner and barrel index"
```

---

## Phase C — The `/curate` Skill (markdown)

> These are documentation artefacts; verification is structural (files exist, valid frontmatter, links resolve), not unit tests. Each task lists the **required content** the author must include — write real prose, no placeholders.

### Task C1: `SKILL.md` router

**Files:**
- Create: `.claude/skills/curate/SKILL.md`

- [ ] **Step 1: Write the skill router**

Frontmatter (exact):
```yaml
---
name: curate
description: Curate Chatsundere model & provider support — onboard a provider, integrate/curate a model, or verify & repair a misbehaving offering. Use when adding a provider or model, or when a specific model behaves wrongly on a provider (e.g. a tool call failing, reasoning not surfacing, broken streaming).
---
```

Body must contain:
- One-paragraph purpose: this skill makes *me* (Claude) the adapter author, interactive, with the maintainer; it replaces the retired machine synthesis loop.
- An **intent router**: a short decision list mapping what the user said → which `references/` playbook to load:
  - "onboard / add a provider" → `references/provider-onboarding.md`
  - "curate / integrate / add a model" → `references/model-curation.md`
  - "X behaves wrongly / users complain about X on provider Y / verify X" → `references/verify-offering.md`
  - "check these N models / batch" → `references/batch-check.md`
- A note that the shared knowledge in `references/catalogue-model.md` and `references/conventions.md` is read first in every mode.
- The hard constraints restated briefly: British English everywhere; never commit anything alarming; subagents never merge/push/switch branches; verification is local-only (keys never in CI).

- [ ] **Step 2: Validate frontmatter + file presence**

Run: `head -6 .claude/skills/curate/SKILL.md`
Expected: well-formed `---` frontmatter with `name: curate` and a `description:` covering both deliberate and reactive entry.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/curate/SKILL.md
git commit -m "Add /curate skill router"
```

### Task C2: Shared references — `catalogue-model.md` + `conventions.md`

**Files:**
- Create: `.claude/skills/curate/references/catalogue-model.md`
- Create: `.claude/skills/curate/references/conventions.md`

- [ ] **Step 1: Write `catalogue-model.md`**

Required content (from `src/catalogue/` + spec §9):
- The two-level model: `CanonicalModel` (curated identity, `family`, `requiredCaps` T/R/V, `freedomOriented`) groups per-provider `Offering`s.
- Each `Offering`: its own measured `ModelProfile`, `AdapterRef`, `context {recommended, max}`, `trust {tee, zdr, jurisdiction}`, `freedomOrientedDeployment`.
- `ModelProfile.reasoning` is the `ReasoningControl` union (none / fixed-on / toggle / steps) — point to `src/catalogue/types.ts`.
- The capability gate: `parseCatalogueEntry` (Valibot) enforces each offering delivers the canonical's `requiredCaps`.
- `effectiveFreedom` = three-state AND of model + deployment freedom.
- **No lineage axis** (YAGNI); `family` gives loose grouping; do not introduce a lineage axis without an ADR.
- Where things live: model YAML in `packages/llm-unified/models/`, adapters as sibling `models/<id>.<provider>.adapter.ts`.

- [ ] **Step 2: Write `conventions.md`**

Required content (spec §8, §3, CLAUDE.md):
- **Curation Records genre:** model records → `obsidian/models/<id>.md`, provider records → `obsidian/providers/<id>.md`. What each must contain (identity/characteristics + the WHY + badges).
- **ADR boundary:** numbered ADRs in `obsidian/decisions/` only for cross-cutting decisions; records are NOT ADRs; they cross-link.
- **Ownership split:** human owns freedom/trust judgement; I own measured/authored parts; written collaboratively; Valibot is the gate.
- **British English** everywhere in artefacts.
- **Git/worktree rules:** subagents never merge/push/switch branches; the orchestrator handles git; squash per feature unit; `[skip ci]` for doc-only.
- **Verification is local-only:** keys live under `keys/`; never in CI.

- [ ] **Step 3: Verify links resolve**

Run: `rg -n "\]\(" .claude/skills/curate/references/catalogue-model.md .claude/skills/curate/references/conventions.md`
Expected: any relative links point to real paths (`src/catalogue/types.ts`, `obsidian/...`). Fix any dangling link.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/curate/references/catalogue-model.md .claude/skills/curate/references/conventions.md
git commit -m "Add shared /curate references (catalogue model, conventions)"
```

### Task C3: `model-curation.md` (core playbook, with harvested probe checklist)

**Files:**
- Create: `.claude/skills/curate/references/model-curation.md`

- [ ] **Step 1: Write the model-curation playbook**

Required content (spec §6 mode 2 + harvested knowledge from §4):
- The flow: resolve probe slug(s) via the provider's `ProviderScanner` → probe live (curl, inspect SSE) → author the adapter `.ts` (`buildRequest` + `parseChunk` incl. normalised `usage` + `ModelProfile`) → run the conversation-suite live across every reasoning permutation (on/off + each effort level) → write the YAML entry + model Curation Record → validate via `parseCatalogueEntry`.
- **The harvested probe checklist** (verbatim knowledge, do not lose):
  - Reasoning: slug-vs-flag — is reasoning toggled by a body flag (`{reasoning:{enabled}}` / `{think:bool}`) or a model-slug swap (`:thinking` / `-thinking`)?
  - Off-is-off vs hidden: when you ask for reasoning off, is it truly off, or merely hidden? If reasoning can never be disabled → `always_on`.
  - Tool calls: streamed incrementally vs delivered as a single block? **Fragmented streamed tool calls must be reassembled** — the case the runtime `streaming.ts:112` parser still gets wrong; the adapter's `parseChunk` must concatenate `argumentsJson` fragments before emitting a `tool-call` chunk.
  - Effort / `max`: does the provider accept granular effort buckets and `max_tokens`?
  - Reasoning + tools concurrency: can the model reason AND call tools in the same turn?
  - **Tool-invocation reliability:** some models (Gemma 4, DeepSeek V4 Flash with `generate_image`) only call a tool when it is named explicitly in the prompt; DSv4 Flash produced the prompt but did not fire the tool. If observed, record the mitigation (explicit tool-mention in prompt composition) in the Curation Record.
- The `usage` normalisation: map the provider's `usage` object into `NormalisedUsage` inside `parseChunk`; document the provider's quirk in the record.
- A pointer to `conversation-suite.md` for how to run the suite.
- A worked skeleton of an adapter `.ts` (the `buildRequest`/`parseChunk`/`ModelProfile` shape) referencing `src/transport.ts` and `src/types.ts` (`StreamChunk`).

- [ ] **Step 2: Verify it references real symbols**

Run: `rg -n "StreamChunk|parseChunk|buildRequest|NormalisedUsage|parseCatalogueEntry" .claude/skills/curate/references/model-curation.md`
Expected: these names appear and match the real exports (verify against `src/types.ts`, `src/transport.ts`, `src/catalogue/index.ts`).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/curate/references/model-curation.md
git commit -m "Add model-curation playbook with harvested probe checklist"
```

### Task C4: `provider-onboarding.md`

**Files:**
- Create: `.claude/skills/curate/references/provider-onboarding.md`

- [ ] **Step 1: Write the provider-onboarding playbook**

Required content (spec §6 mode 1):
- The checklist to establish & document: documentation URL; the key file under `keys/` (naming convention, e.g. `.chutes-test-key`); base characteristics (ZDR / TEE / DSGVO / jurisdiction); `/models` (or `/tags`) metadata analysis; the `usage` reporting quirk; reference to existing chatsune code if any.
- The artefacts produced: a `ProviderScanner` in `src/providers/curation/` (point to the nano-gpt reference impl `provider-scanner.ts` and explain the `listOfferings` / `probeSlugsFor` shape and the slug-zoo it tames: `:thinking` / `-thinking` / `TEE/` prefix / slug-swap reasoning); the `ProviderDefinition` registration (point to `src/providers/_register-builtins.ts`); the **Provider Curation Record** at `obsidian/providers/<id>.md`.
- A pointer to `conventions.md` for the record format and the ADR boundary.

- [ ] **Step 2: Verify references**

Run: `rg -n "provider-scanner|_register-builtins|ProviderDefinition|listOfferings" .claude/skills/curate/references/provider-onboarding.md`
Expected: names present and correct against the real files.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/curate/references/provider-onboarding.md
git commit -m "Add provider-onboarding playbook"
```

### Task C5: `verify-offering.md` + `batch-check.md` + `conversation-suite.md`

**Files:**
- Create: `.claude/skills/curate/references/verify-offering.md`
- Create: `.claude/skills/curate/references/batch-check.md`
- Create: `.claude/skills/curate/references/conversation-suite.md`

- [ ] **Step 1: Write `conversation-suite.md`**

Required content (spec §7):
- What the suite is: a versioned, deterministic, multi-turn scenario that exercises every inference capability; it GROWS with the inference-runner (CLAUDE.md §10).
- Where it lives: `packages/llm-unified/curation/conversation-suite/` — `assertions.ts`, `scenario.ts`, `scenarios/core.ts`, `runner.ts`, `report.ts`.
- How to run it live: construct a `RunnerBinding` (offering ref + `runTurn` via `streamCompletion` + adapter + key from `keys/`; `toolResultFor`), call `runSuite(coreScenario, permutations, binding)`, render with `renderSuiteReport`.
- The permutation matrix: reasoning on / off, and each effort level where steerable.
- The rule: **validation is purely technical/protocol** — never a judgement of model intelligence (the "cat lover → 3 tigers" example: memory worked mechanically, the model is just dumb — not our problem).
- How to grow it: add a `ScenarioTurn` with deterministic assertions when the runner gains a capability.

- [ ] **Step 2: Write `verify-offering.md`**

Required content (spec §6 mode 3):
- Trigger: a model behaves wrongly / users complain about a specific model on a provider.
- Flow: re-run the conversation-suite against the existing offering → read the red assertions → diagnose (e.g. the `generate_image` 400) → repair the adapter → re-run until green → update the Curation Record.
- Pointer to `conversation-suite.md`.

- [ ] **Step 3: Write `batch-check.md`**

Required content (spec §6 mode 4 + §3 D7):
- Trigger: "check these N models" — dev-only, token-heavy, explicitly started.
- Orchestration: dispatch subagents in **worktrees** (one per model, an explicit sub-selection); each runs the relevant mode; the orchestrator collects results, merges worktrees, and handles all git. Subagents never merge/push/switch branches.
- Pointer to `superpowers:dispatching-parallel-agents` and `superpowers:using-git-worktrees`.
- The scoping rule: always a sub-selection, never "all models".

- [ ] **Step 4: Verify all three files exist and links resolve**

Run: `ls .claude/skills/curate/references/ && rg -n "\]\(" .claude/skills/curate/references/verify-offering.md .claude/skills/curate/references/batch-check.md .claude/skills/curate/references/conversation-suite.md`
Expected: 7 reference files total; links resolve.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/curate/references/verify-offering.md .claude/skills/curate/references/batch-check.md .claude/skills/curate/references/conversation-suite.md
git commit -m "Add verify-offering, batch-check, and conversation-suite playbooks"
```

### Task C6: Rewrite the stale `src/curate/README.md`

**Files:**
- Modify/replace: `packages/llm-unified/src/curate/README.md` (or remove if the directory is now empty save the README)

- [ ] **Step 1: Decide the directory's fate**

Run: `ls packages/llm-unified/src/curate/`
If only `README.md` remains, replace its content with a short pointer: "The curation CLI was retired in favour of the `/curate` skill (`.claude/skills/curate/`). Hand-written provider knowledge moved to `src/providers/curation/`." Alternatively `git rm` the README and remove the empty directory. Choose removal if nothing else lives here.

- [ ] **Step 2: Apply the decision (example: remove)**

```bash
git rm packages/llm-unified/src/curate/README.md
```

- [ ] **Step 3: Verify build still clean**

Run: `cd packages/llm-unified && bun run build && bun test`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add -A packages/llm-unified
git commit -m "Remove stale curate CLI README (superseded by /curate skill)"
```

---

## Phase D — CLAUDE.md + README

### Task D1: CLAUDE.md §10 Quality Bar addition

**Files:**
- Modify: `CLAUDE.md` (§10 Quality Bar)

- [ ] **Step 1: Add the principle as a new bullet under §10**

Append this bullet to the §10 Quality Bar list:
```markdown
- **Curation fixtures grow with inference.** The curation verification harness
  (the standardised conversation-suite) grows with the capabilities of the
  inference-runner. Adapters are validated against real end-to-end protocol
  behaviour, never merely structurally, and never in CI (provider keys never
  enter CI). See `.claude/skills/curate/`.
```

- [ ] **Step 2: Verify British English + no broken section**

Run: `rg -n "Curation fixtures grow" CLAUDE.md`
Expected: the bullet appears within §10.

- [ ] **Step 3: Commit (doc-only)**

```bash
git add CLAUDE.md
git commit -m "Add curation-fixtures-grow-with-inference rule to Quality Bar [skip ci]"
```

### Task D2: README.md progressive-discovery pointer

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a short `/curate` section**

Add a concise section (a few sentences) to `README.md`: what `/curate` is (the maintainer skill to curate provider & model support), when to reach for it (onboarding a provider, integrating a model, verifying a misbehaving offering), and a pointer into `.claude/skills/curate/` for the depth. Do NOT duplicate the playbooks — link to them (progressive discovery, mirroring CLAUDE.md §15).

- [ ] **Step 2: Verify the pointer resolves**

Run: `rg -n "curate" README.md`
Expected: the section exists and points at `.claude/skills/curate/`.

- [ ] **Step 3: Commit (doc-only)**

```bash
git add README.md
git commit -m "Document the /curate skill in the README [skip ci]"
```

---

## Final Verification

- [ ] **Build + full test suite green**

Run: `cd packages/llm-unified && bun run build && bun test`
Expected: build succeeds; all unit tests pass (catalogue, providers/curation scanner + model-file, conversation-suite assertions + report).

- [ ] **No dangling references to retired code**

Run: `rg -n "src/synthesis|src/curate/(cli|build|report|write-back|synthesise)" packages/llm-unified --type ts`
Expected: no output.

- [ ] **Skill structure complete**

Run: `ls .claude/skills/curate/ .claude/skills/curate/references/`
Expected: `SKILL.md` + 7 reference files.

- [ ] **Untouched artefacts intact**

Run: `ls models/glm-5.1.yaml packages/llm-unified/fixtures/deepseek-v4-pro.fixtures.json`
Expected: both still present (not deleted).

---

## Self-Review Notes (author)

- **Spec coverage:** retire/migrate (§4) → Phase A; conversation-suite (§7) → Phase B; skill structure (§5) + modes (§6) + records/ADR (§8) → Phase C; CLAUDE.md (§11) + README (§12) → Phase D; data-model touch (§9, usage) → B1. Lineage YAGNI (D6) → documented in C2. Tool-mention mitigation (§7) → C3. All covered.
- **No live-provider CI:** the only key-dependent piece (the live runner) has no unit test and is manual-verify only; all CI tests run without keys. Consistent with D3.
- **Type consistency:** `TurnOutcome`, `Assertion`, `AssertionResult`, `NormalisedUsage`, `SuiteRun`/`PermutationRun`/`TurnRun`, `ConversationScenario`/`ScenarioTurn`/`ReasoningPermutation`, `RunnerBinding` — names are used identically across B2–B6.
- **Squash units (for integration):** Phase A → "Retire synthesis/curate and migrate scanner+model-file"; Phase B → "Add curation conversation-suite harness"; Phase C → "Add /curate skill"; Phase D folds into the relevant doc commits. Per-task commits are squashed before push (CLAUDE.md §8).
