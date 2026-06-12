# Model Instructions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Curated per-model prompt steering — an optional `modelInstructions` field on `CanonicalModel`, injected as a new Band-1 prompt segment (chat + greeting), first used to restrain the Mistral family's over-formatting.

**Architecture:** A new optional string on the canonical (provider-independent) model identity, validated by the existing Valibot gate, deduplicated across the three Mistral canonicals via a shared constant, resolved at the three `buildPrompt` call sites through a small `resolveModelInstructions(offering)` helper, and composed into the system prompt between the TEAL and roleplay segments (roleplay → persona adjacency untouched).

**Tech Stack:** TypeScript (strict), Valibot, Bun test (llm-unified), Vitest (user-client).

**Spec:** `superpowers/specs/2026-06-12-model-instructions-design.md`

**Execution mode:** Inline on `master` (Chris's call, 2026-06-12). No intermediate
commits — the working tree is the checkpoint; Task 5 makes the single squashed
feature commit per CLAUDE.md §8. Touched paths (collision watch):
`packages/llm-unified/src/catalogue/*`, `packages/llm-unified/src/composition.*`,
`apps/user-client/src/lib/stream-engine.ts`, `apps/user-client/src/lib/title-generator.ts`,
`apps/user-client/src/routes/app/chat/chat-page.tsx`, `obsidian/models/mistral-*.md`,
`obsidian/STATUS-CLIENT-ONLY.md`.

> **Known cross-task state:** Task 3 adds a **required** field to
> `BuildPromptInputs`, so `pnpm typecheck` is expected red between Task 3 and
> the end of Task 4. Run the full gate only after Task 4.

---

### Task 1: `modelInstructions` on the canonical + Valibot gate

**Files:**
- Modify: `packages/llm-unified/src/catalogue/types.ts` (CanonicalModel, ~line 21)
- Modify: `packages/llm-unified/src/catalogue/schema.ts` (CanonicalSchema, ~line 28)
- Test: `packages/llm-unified/src/catalogue/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the `parseCatalogueEntry` describe block in `schema.test.ts`:

```ts
it('accepts and surfaces modelInstructions on the canonical', () => {
  const entry = structuredClone(validEntry);
  (entry.canonical as { modelInstructions?: string }).modelInstructions = 'Prefer prose.';
  const r = parseCatalogueEntry(entry);
  expect(r.ok).toBe(true);
  expect(r.ok ? r.entry.canonical.modelInstructions : undefined).toBe('Prefer prose.');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/catalogue/schema.test.ts`
Expected: FAIL — Valibot's `v.object` strips unknown keys, so the parsed
canonical has no `modelInstructions` (received `undefined`).

- [ ] **Step 3: Implement**

In `types.ts`, inside `CanonicalModel` after `freedomNote?: string;`:

```ts
/** Curated behavioural/formatting steering that travels with the model across
 *  providers — injected as a Band-1 prompt segment (chat + greeting jobs).
 *  See the model-instructions spec (2026-06-12). */
modelInstructions?: string;
```

In `schema.ts`, inside `CanonicalSchema` after `freedomNote: v.optional(v.string()),`:

```ts
modelInstructions: v.optional(v.string()),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/catalogue/schema.test.ts`
Expected: PASS (all existing schema tests stay green).

---

### Task 2: Mistral constant, registry wiring, resolver helper

**Files:**
- Create: `packages/llm-unified/src/catalogue/model-instructions.ts`
- Modify: `packages/llm-unified/src/catalogue/canonical-registry.ts` (three Mistral entries ~lines 104–136, helper at the end)
- Modify: `packages/llm-unified/src/catalogue/index.ts` (export the constant + helper)
- Test: `packages/llm-unified/src/catalogue/canonical-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

In `canonical-registry.test.ts`, extend the import from `./canonical-registry.js`
with `resolveModelInstructions`, add
`import { MISTRAL_FORMATTING_INSTRUCTIONS } from './model-instructions.js';`,
and append a new describe block:

```ts
describe('modelInstructions', () => {
  test('all three Mistral canonicals share the formatting restraint', () => {
    for (const id of ['mistral-small-4', 'mistral-medium-3-5', 'mistral-large-3']) {
      expect(getCanonical(id)?.modelInstructions).toBe(MISTRAL_FORMATTING_INSTRUCTIONS);
    }
  });

  test('non-Mistral canonicals carry none', () => {
    expect(getCanonical('glm-5')?.modelInstructions).toBeUndefined();
    expect(getCanonical('grok-4.3')?.modelInstructions).toBeUndefined();
  });

  test('resolveModelInstructions resolves via canonicalRef, empty otherwise', () => {
    expect(resolveModelInstructions({ canonicalRef: 'mistral-small-4' })).toBe(
      MISTRAL_FORMATTING_INSTRUCTIONS,
    );
    expect(resolveModelInstructions({ canonicalRef: null })).toBe('');
    expect(resolveModelInstructions({ canonicalRef: 'unknown-model' })).toBe('');
    expect(resolveModelInstructions({ canonicalRef: 'glm-5' })).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/llm-unified && bun test src/catalogue/canonical-registry.test.ts`
Expected: FAIL — module `./model-instructions.js` not found.

- [ ] **Step 3: Implement**

Create `packages/llm-unified/src/catalogue/model-instructions.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Formatting restraint for the Mistral family (Small 4, Medium 3.5, Large 3).
 * The models are warm and creative but chronically over-format: synopsis-style
 * bullet lists where the user asked for a story, spaced-out or all-capital
 * words for emphasis, heading cascades in casual chat. This restrains
 * typography, never expression — approved wording, model-instructions spec
 * (2026-06-12) §2.4.
 */
export const MISTRAL_FORMATTING_INSTRUCTIONS = [
  'Formatting restraint: prefer flowing prose over heavy Markdown structure.',
  'When the user asks for a story or any other piece of creative writing,',
  'deliver it as continuous narrative prose — never as a synopsis-style list',
  'of bullet points. Use lists, tables and headings only where the content is',
  'genuinely enumerable or the user explicitly asks for them. Never space out',
  'letters or write whole words in capitals for emphasis — acronyms and',
  'initialisms are of course fine. None of this restricts what you say; it',
  'only restrains how the page looks.',
].join(' ');
```

In `canonical-registry.ts`:
- Add `import { MISTRAL_FORMATTING_INSTRUCTIONS } from './model-instructions.js';`
- Add `modelInstructions: MISTRAL_FORMATTING_INSTRUCTIONS,` to each of the
  three Mistral entries (`mistral-small-4`, `mistral-medium-3-5`,
  `mistral-large-3`), after their `freedomNote`.
- Append at the end of the file:

```ts
/**
 * Curated model instructions for an offering's canonical, or `''` when the
 * offering has no canonical or the canonical carries none. The empty string
 * makes the prompt builder drop the segment.
 */
export function resolveModelInstructions(offering: {
  canonicalRef: string | null;
}): string {
  if (!offering.canonicalRef) return '';
  return getCanonical(offering.canonicalRef)?.modelInstructions ?? '';
}
```

In `catalogue/index.ts`, extend the `./canonical-registry.js` export list with
`resolveModelInstructions` and add:

```ts
export { MISTRAL_FORMATTING_INSTRUCTIONS } from './model-instructions.js';
```

(The package root `src/index.ts` already does `export * from './catalogue/index.js';` — nothing to change there.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/llm-unified && bun test src/catalogue/`
Expected: PASS, including the existing registry tests.

---

### Task 3: Composition segment

**Files:**
- Modify: `packages/llm-unified/src/composition.ts` (BuildPromptInputs ~line 18, SegmentId ~line 47, SEGMENTS ~line 82)
- Test: `packages/llm-unified/src/composition.test.ts`

- [ ] **Step 1: Write the failing tests**

In `composition.test.ts`, add `modelInstructions: '',` to BOTH fixture objects —
the `inputs()` helper (~line 12) and `baseInputs` (~line 126) — then append:

```ts
describe('modelInstructions segment', () => {
  it('is present in chat and greeting when provided', () => {
    for (const job of ['chat', 'greeting'] as const) {
      const out = buildPrompt(inputs({ modelInstructions: 'MODEL-MARK' }), job);
      expect(out).toContain('MODEL-MARK');
    }
  });

  it('is absent from title and memory jobs even when provided', () => {
    for (const job of ['title', 'memory'] as const) {
      const out = buildPrompt(inputs({ modelInstructions: 'MODEL-MARK' }), job);
      expect(out).not.toContain('MODEL-MARK');
    }
  });

  it('sits after teal and before roleplay, with persona last', () => {
    const out = buildPrompt(
      inputs({
        modelInstructions: 'MODEL-MARK',
        roleplayEnabled: true,
        personaInstructions: 'PERSONA-MARK',
      }),
      'chat',
    );
    const tealIdx = out.indexOf('Expressive delivery');
    const miIdx = out.indexOf('MODEL-MARK');
    const rpIdx = out.indexOf('roleplay mode');
    const pIdx = out.indexOf('PERSONA-MARK');
    expect(tealIdx).toBeGreaterThanOrEqual(0);
    expect(tealIdx).toBeLessThan(miIdx);
    expect(miIdx).toBeLessThan(rpIdx);
    expect(rpIdx).toBeLessThan(pIdx);
  });

  it('drops the segment when the string is empty', () => {
    const out = buildPrompt(inputs({}), 'chat');
    expect(out).not.toContain('MODEL-MARK');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/llm-unified && bun test src/composition.test.ts`
Expected: the two "present"/"order" tests FAIL (segment does not exist yet);
existing tests stay green (the added fixture key is ignored by the current type
via excess-property tolerance in the spread helper).

- [ ] **Step 3: Implement**

In `composition.ts`:

1. `BuildPromptInputs` — after `toolsInstruction: string;`:

```ts
/** Curated per-model steering resolved from the active offering's canonical
 *  (`resolveModelInstructions`); '' when the model carries none. */
modelInstructions: string;
```

2. `SegmentId` union — add `| 'modelInstructions'` after `'teal'`.

3. `SEGMENTS` — insert after the `teal` entry, and renumber `roleplay` to
   `order: 5` and `persona` to `order: 6`:

```ts
// Curated per-model steering (model-instructions spec 2026-06-12): platform
// curation like TEAL, placed before roleplay so the empirically load-bearing
// roleplay → persona adjacency stays intact and persona instructions can
// still override it. Chat + greeting — everywhere the model writes prose.
{
  id: 'modelInstructions',
  band: 1,
  order: 4,
  jobs: CHAT_AND_GREETING,
  resolve: (i) => i.modelInstructions,
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/llm-unified && bun test`
Expected: PASS — full llm-unified suite green. (`pnpm typecheck` is now red in
the user-client until Task 4 — expected.)

---

### Task 4: The three call sites

**Files:**
- Modify: `apps/user-client/src/lib/stream-engine.ts` (~line 76)
- Modify: `apps/user-client/src/lib/title-generator.ts` (~line 93)
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx` (~line 341)
- Modify (compiler-flagged fixtures): `apps/user-client/tests/unit/title-gen-composition.test.ts`, `apps/user-client/tests/integration/cot-display.test.tsx`, plus anything else `pnpm typecheck` flags

- [ ] **Step 1: Wire the resolver into the three call sites**

In `stream-engine.ts`, add `resolveModelInstructions` to the existing
`@chatsundere/llm-unified` import block, and inside the `buildPrompt` inputs
(after `toolsInstruction: args.toolsInstruction ?? '',`):

```ts
modelInstructions: resolveModelInstructions(args.offering),
```

In `title-generator.ts`, same import addition; in its `buildPrompt` inputs
(after `toolsInstruction: '',`):

```ts
modelInstructions: resolveModelInstructions(args.offering),
```

(The `title` job excludes the segment — passing it keeps the input shape
uniform, per spec §2.3.)

In `chat-page.tsx`, same import addition; in the context-gauge `buildPrompt`
inputs (after `toolsInstruction: '',`; the memo early-returns when `!offering`,
so `offering` is non-null here):

```ts
modelInstructions: resolveModelInstructions(offering),
```

- [ ] **Step 2: Fix compiler-flagged test fixtures**

Run: `pnpm typecheck --force`
For every flagged `BuildPromptInputs` fixture (known candidates above), add
`modelInstructions: '',`. Re-run until 14/14.

- [ ] **Step 3: Run the touched user-client suites**

Run: `cd apps/user-client && pnpm vitest run tests/unit/title-gen-composition.test.ts tests/integration/cot-display.test.tsx`
Expected: PASS.

---

### Task 5: Gates, Curation Records, STATUS, squash commit

**Files:**
- Modify: `obsidian/models/mistral-small-4.md`, `obsidian/models/mistral-medium-3-5.md`, `obsidian/models/mistral-large-3.md`
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`

- [ ] **Step 1: Full gates**

```bash
pnpm typecheck --force        # expected 14/14
cd packages/llm-unified && bun test   # expected all green (372 base + new)
cd ../../apps/user-client && pnpm vitest run   # expected: exactly the 8-failure Node-26-localStorage baseline, zero new failures
cd ../.. && pnpm run build --force    # expected 9/9
```

Biome runs in the pre-commit hook; if it rewrites anything, re-stage.

- [ ] **Step 2: Curation Records**

Add a short "Model instructions" section to each of the three Mistral records:
the over-formatting observation (synopsis-style bullets for stories, spaced-out
or all-capital emphasis — exhausting to read and hostile to TTS read-aloud),
the shared `MISTRAL_FORMATTING_INSTRUCTIONS` constant, and the explicit note
that the steering restrains typography, never expression (spec §2.4).

- [ ] **Step 3: Update STATUS**

Add the session entry to `obsidian/STATUS-CLIENT-ONLY.md` (what landed, gates,
spec/plan links, the manual-verification pointer — spec §6, restart `pnpm dev`).

- [ ] **Step 4: Single squashed feature commit**

```bash
git add -A
git commit -m "Add curated model instructions with Mistral formatting restraint

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

Mixed code + docs — no `[skip ci]`. Liz does NOT push (Chris pushes the
backlog on his word after device-testing).

---

## Manual verification (Chris, on device — spec §6)

Restart `pnpm dev` first (`packages/llm-unified` changed — Vite HMR ignores it).

1. Mistral Small 4: ask for a short story → continuous prose, no bullet synopsis.
2. Casual chat, excited topic → no spaced-out letters, no ALL-CAPS words.
3. Explicitly ask for a comparison table → a table still comes (user intent wins).
4. Fresh chat with a greeting-enabled persona on Mistral → opener arrives as prose.
5. Switch to GLM 5 → behaviour unchanged; context gauge shows no Mistral segment cost.
6. TTS read-aloud of a story → flows naturally, no list-item staccato.
