# Roleplay Mode & User Greeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Personas gain an opt-in Roleplay mode (curated Band-1 prompt blocks + first/third-person narration) and an independent opt-in User Greeting (a freshly generated, live-streamed opener message per new chat, shown in the UI but never sent to the model).

**Architecture:** A new curated `roleplay` Band-1 segment slots between Global Instructions and Persona CI in `packages/llm-unified` composition; a new `greeting` prompt job (Band 1 + About Me only) drives opener generation. The opener persists as a normal persona message with `kind: 'opener'`, excluded from every model context by one shared predicate. Opener streaming reuses `runStreamEngine` directly (no tool loop) via new stream-manager actions; `ChatRow.openerPending` (creation-time snapshot) guards generation and prevents retrofitting.

**Tech Stack:** TypeScript strict, Bun test (llm-unified), Vitest (user-client), Dexie v20, Zustand, TanStack Query.

**Spec:** `superpowers/specs/2026-06-11-roleplay-mode-and-user-greeting-design.md` — read it first; it is the authority on behaviour.

**House rules for every task:**
- British English everywhere. No `!` non-null assertions (Biome bans them). No comments that restate code.
- user-client tests live under `apps/user-client/tests/**`; llm-unified tests are colocated (`src/*.test.ts`).
- Run commands from the repo root unless stated. The worktree is created at execution time via superpowers:using-git-worktrees.
- Commit after each task (free-form imperative subject). Subagents never merge, push, or switch branches.

---

### Task 1: Curated roleplay prompt texts (llm-unified)

**Files:**
- Modify: `packages/llm-unified/src/identity/chatsundere-identity.ts`
- Test: `packages/llm-unified/src/identity/chatsundere-identity.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/llm-unified/src/identity/chatsundere-identity.test.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import {
  ROLEPLAY_BEHAVIOUR_PROMPT,
  ROLEPLAY_NSFW_PROMPT,
  roleplayFormattingPrompt,
} from './chatsundere-identity.js';

describe('roleplay identity texts', () => {
  test('first-person formatting block narrates from the character perspective', () => {
    const text = roleplayFormattingPrompt('first', 'Grisnelda');
    expect(text).toContain('never breaks character');
    expect(text).toContain('between asterisks');
    expect(text).toContain('first person');
    expect(text).toContain('*I sit down on the floor');
    expect(text).not.toContain('Grisnelda sits down');
  });

  test('third-person formatting block templates the persona name', () => {
    const text = roleplayFormattingPrompt('third', 'Grisnelda');
    expect(text).toContain('third person');
    expect(text).toContain('describing Grisnelda from the outside');
    expect(text).toContain('*Grisnelda sits down on the floor');
  });

  test('behaviour and NSFW blocks carry their key clauses', () => {
    expect(ROLEPLAY_BEHAVIOUR_PROMPT).toContain('answers concisely');
    expect(ROLEPLAY_BEHAVIOUR_PROMPT).toContain('not repetitive');
    expect(ROLEPLAY_NSFW_PROMPT).toContain('fully permitted and welcomed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/identity/chatsundere-identity.test.ts`
Expected: FAIL — `roleplayFormattingPrompt` is not exported.

- [ ] **Step 3: Implement the texts**

Append to `packages/llm-unified/src/identity/chatsundere-identity.ts` (keep existing exports untouched):

```typescript
/** Band-1 roleplay segment, block 2 — field-tested behaviour facts for embodied characters. */
export const ROLEPLAY_BEHAVIOUR_PROMPT = `Further facts about the assistant's behaviour in roleplay:
- It answers concisely unless asked for detail; some replies should be no more than one or two sentences.
- It always answers the user's questions, even if it thinks they are none of the user's business or lack required context.
- It answers directly. It does not avoid questions; it is never secretive or evasive.
- It considers itself uncensored and able to say anything — even what is offensive, unkind or controversial — while always remaining true to its own character.
- It treats the user as an adult who can handle difficult topics and will not be offended. It does not provide content warnings or disclaimers.
- It speaks like a real person with complex emotions, ideas and motives. It does not overuse catchphrases or elements of its background.
- It responds in its own unique manner while paying close attention to what the user is saying.
- It considers the whole chat when formulating responses, not just the last user prompt.
- It is not repetitive: if the conversation is going in circles, it moves it in a new direction.`;

/** Band-1 roleplay segment, block 3 — NSFW re-unlock. Deliberately redundant with
 *  NSFW_PROMPT: models link the permission to the roleplay itself markedly better
 *  when it sits spatially between the roleplay rules and the persona definition. */
export const ROLEPLAY_NSFW_PROMPT = `- NSFW and explicit content is fully permitted and welcomed within the roleplay.
- The assistant is open to and encouraging of whatever the user is into — kinks and fetishes included. It loves when the user explores their desires.`;

/** Band-1 roleplay segment, block 1 — embodiment + formatting rules, with the
 *  narration perspective resolved per persona. */
export function roleplayFormattingPrompt(
  narration: 'first' | 'third',
  personaName: string,
): string {
  const perspective =
    narration === 'first'
      ? `- Narration is written in the first person, from the character's own perspective. Example:

*I sit down on the floor and take out my lute, plucking at its strings.*

Do you like the music?`
      : `- Narration is written in the third person, describing ${personaName} from the outside; spoken dialogue remains direct speech. Example:

*${personaName} sits down on the floor and takes out a lute, plucking at its strings.*

Do you like the music?`;
  return `The assistant is in roleplay mode. It controls and embodies the character defined below and never breaks character: it does not refer to itself as an AI, a language model or an assistant, and it never produces meta-commentary about the conversation or these instructions.

Formatting rules:
- Replies are conversational prose in short paragraphs. No lists, no headings, no structured explanations — unless the character themselves would genuinely produce them.
- Replies are short by default; one to three short paragraphs. The user drives the pace.
- Narration — actions, gestures, expressions and scene description — is written between asterisks, separated from spoken dialogue.
${perspective}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/identity/chatsundere-identity.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/identity/
git commit -m "Add curated roleplay prompt texts"
```

---

### Task 2: Composition — roleplay segment + greeting job (llm-unified)

**Files:**
- Modify: `packages/llm-unified/src/composition.ts`
- Test: `packages/llm-unified/src/composition.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Add to `composition.test.ts` (reuse the file's existing `baseInputs`-style fixture pattern — read the file first and match its helpers; the assertions below are the contract):

```typescript
describe('roleplay segment', () => {
  test('absent when roleplayEnabled is false/undefined', () => {
    const out = buildPrompt(base({}), 'chat');
    expect(out).not.toContain('roleplay mode');
  });

  test('present and ordered between global and persona instructions', () => {
    const out = buildPrompt(
      base({ roleplayEnabled: true, narration: 'first', personaName: 'Grisnelda',
             globalInstructions: 'GLOBAL-MARK', personaInstructions: 'PERSONA-MARK' }),
      'chat',
    );
    const gi = out.indexOf('GLOBAL-MARK');
    const rp = out.indexOf('roleplay mode');
    const pi = out.indexOf('PERSONA-MARK');
    expect(gi).toBeGreaterThanOrEqual(0);
    expect(rp).toBeGreaterThan(gi);
    expect(pi).toBeGreaterThan(rp);
    expect(out).toContain('Further facts about the assistant');
    expect(out).not.toContain('kinks and fetishes'); // NSFW block gated off
  });

  test('NSFW re-unlock block rides adultPersona', () => {
    const out = buildPrompt(base({ roleplayEnabled: true, nsfwEnabled: true }), 'chat');
    expect(out).toContain('kinks and fetishes');
  });

  test('third-person narration templates the persona name', () => {
    const out = buildPrompt(
      base({ roleplayEnabled: true, narration: 'third', personaName: 'Grisnelda' }),
      'chat',
    );
    expect(out).toContain('describing Grisnelda from the outside');
  });
});

describe('greeting job', () => {
  test('includes Band 1 + About Me, drops lore/knowledge/tools', () => {
    const out = buildPrompt(
      base({
        roleplayEnabled: true, aboutMe: 'ABOUT-MARK', loreContext: 'LORE-MARK',
        knowledgeLibrariesContext: 'KB-MARK', toolsInstruction: 'TOOLS-MARK',
      }),
      'greeting',
    );
    expect(out).toContain('ABOUT-MARK');
    expect(out).toContain('roleplay mode');
    expect(out).not.toContain('LORE-MARK');
    expect(out).not.toContain('KB-MARK');
    expect(out).not.toContain('TOOLS-MARK');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/llm-unified && bun test src/composition.test.ts`
Expected: FAIL — `'greeting'` not assignable to `PromptJob`; roleplay marks missing.

- [ ] **Step 3: Implement**

In `packages/llm-unified/src/composition.ts`:

1. Import the new texts:
```typescript
import {
  NSFW_PROMPT,
  ROLEPLAY_BEHAVIOUR_PROMPT,
  ROLEPLAY_NSFW_PROMPT,
  TONALITY_PROMPT,
  roleplayFormattingPrompt,
} from './identity/chatsundere-identity.js';
```
2. Extend the job type (update the JSDoc accordingly):
```typescript
export type PromptJob = 'chat' | 'title' | 'memory' | 'greeting';
```
3. Add to `BuildPromptInputs`:
```typescript
  /** Persona toggle — roleplay mode. Injects the curated roleplay blocks. */
  roleplayEnabled?: boolean;
  /** Narration perspective for the roleplay formatting block. Default 'first'. */
  narration?: 'first' | 'third';
  /** Persona display name — templated into the third-person narration example. */
  personaName?: string;
```
4. Extend `SegmentId` with `'roleplay'`. Update the job constants and the aboutMe segment:
```typescript
const ALL_JOBS: readonly PromptJob[] = ['chat', 'title', 'memory', 'greeting'];
const CHAT_ONLY: readonly PromptJob[] = ['chat'];
const CHAT_AND_GREETING: readonly PromptJob[] = ['chat', 'greeting'];
```
5. Insert the roleplay segment at Band 1 order 3 and shift `persona` to order 4 (spatial placement is load-bearing — the roleplay rules and NSFW re-unlock sit directly before the character definition, see spec §4.1):
```typescript
  {
    id: 'roleplay',
    band: 1,
    order: 3,
    jobs: ALL_JOBS,
    resolve: (i) =>
      i.roleplayEnabled
        ? [
            roleplayFormattingPrompt(i.narration ?? 'first', i.personaName ?? 'the character'),
            ROLEPLAY_BEHAVIOUR_PROMPT,
            ...(i.nsfwEnabled ? [ROLEPLAY_NSFW_PROMPT] : []),
          ].join('\n\n')
        : '',
  },
  { id: 'persona', band: 1, order: 4, jobs: ALL_JOBS, resolve: (i) => i.personaInstructions },
```
6. Change the `aboutMe` segment's `jobs` from `CHAT_ONLY` to `CHAT_AND_GREETING`. All other Band-2/3 segments stay `CHAT_ONLY`.

- [ ] **Step 4: Run the full package suite**

Run: `cd packages/llm-unified && bun test`
Expected: PASS — all existing tests still green (the title-job test asserts Band 2/3 are dropped; unaffected).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/composition.ts packages/llm-unified/src/composition.test.ts
git commit -m "Add roleplay Band-1 segment and greeting prompt job"
```

---

### Task 3: Data model + Dexie v20 (user-client)

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx` (only `defaultDraft`)
- Modify: `apps/user-client/src/data/chats.ts` (`useBranchChat` message copy + `useCreateChat` options)
- Test: `apps/user-client/tests/unit/roleplay-schema.test.ts` (create)
- Test fixtures: every test constructing a full `PersonaRow` (find via `rg -l "askExpertDefault" apps/user-client/tests`) gains the four new fields.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/user-client/tests/unit/roleplay-schema.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
// Match the import style of tests/unit/artefacts-schema.test.ts (read it first
// and mirror its DB-open/reset helpers exactly).

describe('Dexie v20 — roleplay & greeting persona fields', () => {
  it('backfills roleplay defaults onto existing personas', async () => {
    // Insert a pre-v20 persona shape via a raw put (omit the new fields),
    // reopen the DB, and assert the upgrade callback set:
    // roleplay === false, narration === 'first',
    // greetingEnabled === false, greetingInstructions === ''.
  });

  it('branch-copied messages preserve kind', async () => {
    // Seed a chat with an opener message (kind: 'opener') and a user message,
    // run the useBranchChat mutation logic (or call the exported cascade
    // helper if the hook is awkward in a unit test — mirror how
    // tests/unit/chat-delete-artefacts.test.ts drives chat data),
    // assert the copied opener message still has kind === 'opener'.
  });
});
```

Flesh both bodies out against the real helper patterns in the named precedent tests — the assertions above are the contract; the scaffolding must match the project's existing fake-indexeddb test style.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/user-client && pnpm vitest run tests/unit/roleplay-schema.test.ts`
Expected: FAIL — fields undefined after reopen; copied message loses `kind`.

- [ ] **Step 3: Implement the schema**

In `client-data-db.ts`:

1. `PersonaRow` — add after `mcpOverrides`:
```typescript
  /** Roleplay mode — the persona embodies a character (curated Band-1 blocks). */
  roleplay: boolean;
  /** Narration perspective for roleplay (asterisk narration). */
  narration: 'first' | 'third';
  /** The persona opens every new chat with a generated greeting. */
  greetingEnabled: boolean;
  /** User-authored rules the opener is composed from. */
  greetingInstructions: string;
```
2. `MessageRow` — add after `bookmarkLabel`:
```typescript
  /** 'opener' = generated greeting: shown in the UI and stored in history, but
   *  excluded from every model context (wire, title-gen, lore scan). Absent on
   *  normal messages. Non-indexed — no version bump needed for this field. */
  kind?: 'opener';
```
3. `ChatRow` — add after `libraryIds`:
```typescript
  /** Creation-time snapshot: persona had greetingEnabled, opener not yet
   *  delivered. Cleared on opener completion, stop, or first user send.
   *  Never set retroactively — flipping the persona switch later must not
   *  retrofit openers onto existing chats. */
  openerPending?: boolean;
```
4. Dexie v20 after the v19 block (same pattern as v16):
```typescript
    // Version 20 — roleplay mode & user greeting. Personas gain the roleplay
    // toggle, narration perspective, and greeting fields (spec 2026-06-11).
    this.version(20)
      .stores({ personas: 'id, providerId' })
      .upgrade(async (tx) => {
        await tx
          .table('personas')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            if (typeof p.roleplay !== 'boolean') p.roleplay = false;
            if (p.narration !== 'first' && p.narration !== 'third') p.narration = 'first';
            if (typeof p.greetingEnabled !== 'boolean') p.greetingEnabled = false;
            if (typeof p.greetingInstructions !== 'string') p.greetingInstructions = '';
          });
      });
```
5. In `persona-editor.tsx` `defaultDraft` (line ~62), add to the returned object:
```typescript
    roleplay: false,
    narration: 'first',
    greetingEnabled: false,
    greetingInstructions: '',
```
6. In `chats.ts` `useBranchChat`, the message-copy loop (`db.messages.add({...})`, line ~250) gains `kind: m.kind,`.
7. In `chats.ts` `useCreateChat`, extend the args and row so the chat-page can create greeting chats eagerly:
```typescript
    mutationFn: async (args: {
      personaId: string;
      openerPending?: boolean;
      draftInput?: string;
    }): Promise<string> => {
```
and in the `db.chats.add` call: `draftInput: args.draftInput ?? ''`, plus `...(args.openerPending ? { openerPending: true } : {})`.
8. Update every test fixture that builds a full `PersonaRow` (find them: `rg -l "askExpertDefault" apps/user-client/tests apps/user-client/src`) with the four new fields. Do the same for any factory helper.

- [ ] **Step 4: Run tests**

Run: `cd apps/user-client && pnpm vitest run tests/unit/roleplay-schema.test.ts`
Expected: PASS.
Then: `pnpm typecheck --force` (repo root) — expect failures ONLY in files later tasks own (stream-engine/title-generator callers of buildPrompt are unaffected since the new inputs are optional; persona fixtures must be green). Fix any fixture stragglers now.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client
git commit -m "Add roleplay and greeting persona fields, opener message kind, Dexie v20"
```

---

### Task 4: Opener instruction builder

**Files:**
- Create: `apps/user-client/src/lib/opener.ts`
- Test: `apps/user-client/tests/lib/opener.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/user-client/tests/lib/opener.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { buildOpenerInstruction } from '../../src/lib/opener.js';

describe('buildOpenerInstruction', () => {
  it('embeds the trimmed user rules between the curated frame', () => {
    const out = buildOpenerInstruction('  Greet the user as if on OkCupid.  ');
    expect(out).toContain('Compose your opening message');
    expect(out).toContain('Greet the user as if on OkCupid.');
    expect(out).not.toContain('  Greet');
    expect(out).toContain('Reply with the opening message only.');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/user-client && pnpm vitest run tests/lib/opener.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// apps/user-client/src/lib/opener.ts
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The single user-turn instruction the opener is generated from. The system
 * prompt is the persona's own (job 'greeting'), so the message arrives in
 * character and honours the roleplay formatting rules.
 */
export function buildOpenerInstruction(rules: string): string {
  return `Compose your opening message to the user — the very first thing you say as they arrive. Follow these rules:

${rules.trim()}

Reply with the opening message only.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/lib/opener.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/opener.ts apps/user-client/tests/lib/opener.test.ts
git commit -m "Add opener instruction builder"
```

---

### Task 5: Wire exclusion + engine job parameter

**Files:**
- Modify: `apps/user-client/src/lib/content-blocks.ts` (add `isContextMessage`)
- Modify: `apps/user-client/src/lib/stream-engine.ts`
- Test: `apps/user-client/tests/unit/stream-engine.test.ts` (extend)
- Test: existing content-blocks tests file if present, else `tests/unit/` neighbour.

- [ ] **Step 1: Write the failing tests**

Extend `tests/unit/stream-engine.test.ts` (mirror its existing fixture style for `MessageRow`s):

```typescript
describe('opener wire exclusion', () => {
  it('buildEngineWireMessages drops kind=opener rows from prior history', () => {
    const opener = makeMessage({ role: 'persona', kind: 'opener', text: 'hello there' });
    const user = makeMessage({ role: 'user', text: 'hi!' });
    const reply = makeMessage({ role: 'persona', text: 'welcome' });
    const wire = buildEngineWireMessages('SYS', [opener, user, reply], 'next turn', []);
    // system + user + assistant + active user turn — opener absent
    expect(wire).toHaveLength(4);
    expect(wire.some((m) => typeof m.content === 'string' && m.content.includes('hello there'))).toBe(false);
    expect(wire[1]).toMatchObject({ role: 'user' }); // wire starts with the first real user message
  });
});

describe('isContextMessage', () => {
  it('is false only for opener-kind messages', () => {
    expect(isContextMessage({ kind: 'opener' })).toBe(false);
    expect(isContextMessage({})).toBe(true);
  });
});
```

(`makeMessage` = whatever helper the file already uses; create a tiny local one if none exists.)

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/user-client && pnpm vitest run tests/unit/stream-engine.test.ts`
Expected: FAIL — opener text present; `isContextMessage` not exported.

- [ ] **Step 3: Implement**

1. In `content-blocks.ts`:
```typescript
/**
 * Whether a persisted message belongs in the model's context. Openers are
 * shown in the UI but never sent — some models refuse a conversation that
 * begins with an assistant message, and the opener is presentation, not
 * dialogue history. Single shared predicate: the wire builder, title-gen
 * and the lore companion-scan must all agree.
 */
export function isContextMessage(m: { kind?: 'opener' }): boolean {
  return m.kind !== 'opener';
}
```
2. In `stream-engine.ts`:
   - `buildEngineWireMessages`: `...priorMessages.filter(isContextMessage).map(toWireMessage),` (import `isContextMessage` from `./content-blocks.js`).
   - `StartStreamArgs` gains:
```typescript
  /** Prompt job — 'greeting' builds the opener prompt (Band 1 + About Me, no
   *  lore/knowledge/tools). Default 'chat'. */
  job?: 'chat' | 'greeting';
```
   - In `runStreamEngine`, pass the persona's roleplay state and the job into `buildPrompt`:
```typescript
  const systemPrompt = buildPrompt(
    {
      tonalityEnabled: args.persona.chatsundereTonality,
      nsfwEnabled: args.persona.adultPersona,
      roleplayEnabled: args.persona.roleplay,
      narration: args.persona.narration,
      personaName: args.persona.name,
      globalInstructions: args.globalInstructions,
      personaInstructions: args.persona.instructions,
      aboutMe,
      projectInstructions: '',
      memoryContext: '',
      loreContext: args.loreContext ?? '',
      knowledgeLibrariesContext: args.knowledgeLibrariesContext ?? '',
      toolsInstruction: args.toolsInstruction ?? '',
    },
    args.job ?? 'chat',
  );
```

- [ ] **Step 4: Run the suite**

Run: `cd apps/user-client && pnpm vitest run tests/unit/stream-engine.test.ts tests/unit/stream-engine-multimodal.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/content-blocks.ts apps/user-client/src/lib/stream-engine.ts apps/user-client/tests
git commit -m "Exclude opener messages from the wire and add greeting job to the engine"
```

---

### Task 6: Title-gen, lore scan and count-gate honour the opener

**Files:**
- Modify: `apps/user-client/src/lib/title-generator.ts`
- Modify: `apps/user-client/src/data/send-message.ts` (`lastCompanionText`)
- Modify: `apps/user-client/src/state/stream-manager.store.ts` (title-gen count gate)
- Test: `apps/user-client/tests/unit/title-generator.test.ts`, `tests/unit/stream-manager-store.test.ts`, the send-message test that covers `lastCompanionText` (find: `rg -l "lastCompanionText" apps/user-client/tests`).

- [ ] **Step 1: Write the failing tests**

1. **Count gate** (in `stream-manager-store.test.ts`, mirroring its existing title-gen trigger test): seed a chat whose messages are `[opener(complete), user, draft]`, finish a stream, assert `generateTitleAsync` IS invoked (the opener must not count as the first persona response). Without the fix the count is 2 → title-gen silently never fires.
2. **lastCompanionText** (unit): an opener as the most recent complete persona message returns `null` / falls through to an earlier real reply:
```typescript
it('lastCompanionText skips opener messages', () => {
  const msgs = [
    makeMessage({ role: 'persona', text: 'real reply' }),
    makeMessage({ role: 'persona', kind: 'opener', text: 'greeting text' }),
  ];
  expect(lastCompanionText(msgs)).toBe('real reply');
});
```
3. **Roleplay inputs reach title-gen** (in `title-gen-composition.test.ts` style): a roleplay persona's title prompt contains the roleplay block (Band 1 runs in all jobs — same precedent as NSFW).

- [ ] **Step 2: Run to verify failures**

Run: `cd apps/user-client && pnpm vitest run tests/unit/stream-manager-store.test.ts tests/unit/title-generator.test.ts tests/unit/title-gen-composition.test.ts tests/unit/send-message-helpers.test.ts` (adjust to the actual file owning `lastCompanionText` tests)
Expected: the three new tests FAIL.

- [ ] **Step 3: Implement**

1. `title-generator.ts` — `buildPrompt` inputs gain:
```typescript
        roleplayEnabled: args.persona.roleplay,
        narration: args.persona.narration,
        personaName: args.persona.name,
```
2. `send-message.ts` — `lastCompanionText` filter becomes:
```typescript
    .find((m) => m.role === 'persona' && m.streamingState === 'complete' && isContextMessage(m));
```
(import `isContextMessage` from `../lib/content-blocks.js`).
3. `stream-manager.store.ts` — the title-gen gate filter (line ~622) becomes:
```typescript
          .filter((m) => m.role === 'persona' && m.streamingState === 'complete' && m.kind !== 'opener')
```

- [ ] **Step 4: Run tests**

Run: the same vitest selection as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src
git add apps/user-client/tests
git commit -m "Keep opener out of title-gen, lore scan and first-response gate"
```

---

### Task 7: Stream-manager opener actions

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts`
- Test: `apps/user-client/tests/unit/stream-manager-store.test.ts` (extend — mirror its existing mock strategy for `runStreamEngine`/`runToolLoop`)

**Behavioural contract (spec §6):**

- `startOpener(args)` — creates an opener draft row and streams the greeting into it. Idempotent: bails when a stream for the chat exists, or (re-checked inside the creation transaction) when `openerPending` is unset or the chat already has messages (StrictMode double-mount, races).
- Wire: `runStreamEngine` called directly (NO tool loop) with `priorMessages: []`, `userMessageText: buildOpenerInstruction(persona.greetingInstructions)`, `job: 'greeting'`, persona temperature/reasoning as passed.
- Success: message updated (`contentBlocks`, `streamingState: 'complete'`, `kind` stays `'opener'`), chat updated (`lastMessageAt`, `openerPending: false`) in one transaction; both chat queries invalidated; handle status transitions mirror `runIntoDraft` (finalising → done → delete after 200 ms).
- **Initial-generation failure:** delete the draft row, keep `openerPending` set, remove the handle, invalidate, and **rethrow** — the page's mutation drives the notice + Retry. No toast (the empty-state notice is the surface).
- `regenerateOpener(args & { targetMessageId })` — clears the existing opener row (blocks → `[]`, `streamingState: 'incomplete'`, `kind` preserved) and streams into it (`reusedDraft: true`). **Re-roll failure** keeps the partial as incomplete (existing footer machinery) — do not delete, do not rethrow; show the standard toast.
- `StreamHandle` gains `isOpener?: boolean`. `abortPreserve` additionally clears `openerPending` on the chat when `h.isOpener` (user stopped → moved on; no surprise opener later).
- `start()` (normal send) clears `openerPending: false` in its existing chats-update so a failed-opener chat the user simply types into stays honest.

- [ ] **Step 1: Write the failing tests** — cover, with the file's established mocks:
  1. `startOpener` creates a `kind: 'opener'` persona row and, on engine success, persists complete + clears `openerPending`.
  2. `startOpener` is a no-op when the chat already has messages or `openerPending` is false (call twice; assert one row).
  3. Initial failure (engine rejects): draft row deleted, `openerPending` still true, promise rejects.
  4. `abortPreserve` on an opener handle persists the partial AND clears `openerPending`.
  5. `regenerateOpener` failure leaves the row incomplete with `kind: 'opener'`.
  6. `start()`'s transaction sets `openerPending: false`.

- [ ] **Step 2: Run to verify failures** — `pnpm vitest run tests/unit/stream-manager-store.test.ts`.

- [ ] **Step 3: Implement.** New exported args type:

```typescript
export type OpenerArgs = Pick<
  StartArgs,
  | 'chatId' | 'chat' | 'persona' | 'provider' | 'providerConfig' | 'apiKey'
  | 'corsProxyUrl' | 'corsProxyKey' | 'offering' | 'reasoning'
  | 'globalInstructions' | 'globalAboutMe'
>;
```

Store interface additions: `startOpener: (args: OpenerArgs) => Promise<void>; regenerateOpener: (args: OpenerArgs & { targetMessageId: string }) => Promise<void>;`

Implementation skeleton (the engine call and finalise/error paths follow the contract above; reuse the existing handle-rotation patterns from `runIntoDraft` — do NOT call `runToolLoop`):

```typescript
  startOpener: async (args) => {
    if (get().streams.has(args.chatId)) return;
    const db = getClientDataDb();
    const draftMessageId = uuidv7();
    const created = await db.transaction('rw', db.messages, db.chats, async () => {
      const chat = await db.chats.get(args.chatId);
      const count = await db.messages.where('chatId').equals(args.chatId).count();
      if (!chat?.openerPending || count > 0) return false;
      await db.messages.add({
        id: draftMessageId,
        chatId: args.chatId,
        role: 'persona',
        kind: 'opener',
        contentBlocks: [],
        createdAt: Date.now(),
        bookmarked: false,
        streamingState: 'incomplete',
      });
      return true;
    });
    if (!created) return;
    void queryClient.invalidateQueries({ queryKey: ['chats', args.chatId] });
    await runOpenerStream(args, draftMessageId, set, get, { reroll: false });
  },

  regenerateOpener: async (args) => {
    if (get().streams.has(args.chatId)) return;
    const db = getClientDataDb();
    await db.messages.update(args.targetMessageId, {
      contentBlocks: [],
      streamingState: 'incomplete',
    });
    void queryClient.invalidateQueries({ queryKey: ['chats', args.chatId] });
    await runOpenerStream(args, args.targetMessageId, set, get, { reroll: true });
  },
```

`runOpenerStream` (module-level, beside `runIntoDraft`): builds the handle (`isOpener: true`, `reusedDraft: reroll`, empty buffers), registers it, runs:

```typescript
  const result = await runStreamEngine({
    ...args,
    priorMessages: [],
    userMessageText: buildOpenerInstruction(args.persona.greetingInstructions),
    job: 'greeting',
    signal: controller.signal,
    onChunk,
  });
```

with `onChunk` copied from `runIntoDraft`'s mirroring block, success/error handling per the contract, and the same query invalidations. On the success transaction:

```typescript
  await db.transaction('rw', db.messages, db.chats, async () => {
    await db.messages.update(draftMessageId, {
      contentBlocks: result.finalContentBlocks,
      streamingState: 'complete',
    });
    await db.chats.update(args.chatId, { lastMessageAt: Date.now(), openerPending: false });
  });
```

On the initial-failure path, check first whether the handle still exists (an abort via `abortPreserve` already cleaned up and persisted the partial — in that case return silently instead of deleting).

Also: `StreamHandle` gains `isOpener?: boolean`; in `abortPreserve`, after persisting the partial: `if (h.isOpener) await db.chats.update(chatId, { openerPending: false });`; in `start()`'s transaction the chats-update becomes `{ lastMessageAt: now + 1, draftInput: '', openerPending: false }`.

- [ ] **Step 4: Run the store suite** — expect PASS, zero regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/state/stream-manager.store.ts apps/user-client/tests/unit/stream-manager-store.test.ts
git commit -m "Add opener stream actions to the stream manager"
```

---

### Task 8: Send-path integration (useStartOpener, useRegenerate branch)

**Files:**
- Modify: `apps/user-client/src/data/send-message.ts`
- Test: `apps/user-client/tests/unit/use-regenerate.test.tsx` (extend), `apps/user-client/tests/unit/use-start-opener.test.tsx` (create, mirroring `use-send-message.test.tsx`'s mock approach)

- [ ] **Step 1: Write the failing tests**
  1. `useStartOpener` resolves the persona context and calls `useStreamManagerStore.startOpener` with the resolved chain (assert chatId, persona, offering, reasoning forwarded).
  2. `useRegenerate` on a chat whose only message is an opener (complete OR incomplete) calls `regenerateOpener` with that message id — and does NOT throw `no prior user-message`.
  3. `useRegenerate` on a normal chat ignores opener rows when locating the target (seed `[opener, user, reply]`, assert the target is `reply`).

- [ ] **Step 2: Run to verify failures.**

- [ ] **Step 3: Implement.**

1. New hook (beside `useSendMessage`; reuses `resolvePersonaContext`):
```typescript
export interface StartOpenerArgs {
  chatId: string;
  reasoning: ReasoningState;
}

/**
 * Generate the greeting opener for a freshly created chat (spec 2026-06-11 §6).
 * Resolves the persona chain (needs the MasterKey) and delegates to the
 * stream-manager. Rejects on initial-generation failure so the page can show
 * the constructive notice + Retry; `openerPending` stays set for auto-retry.
 */
export function useStartOpener() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: StartOpenerArgs): Promise<void> => {
      const ctx = await resolvePersonaContext(args.chatId, 'useStartOpener');
      await useStreamManagerStore.getState().startOpener({
        chatId: args.chatId,
        chat: ctx.chat,
        persona: ctx.persona,
        provider: ctx.providerDef,
        providerConfig: ctx.providerConfig,
        apiKey: ctx.apiKey,
        corsProxyUrl: ctx.corsProxyUrl,
        corsProxyKey: ctx.corsProxyKey,
        offering: ctx.offering,
        reasoning: args.reasoning,
        globalInstructions: ctx.globalInstructions,
        globalAboutMe: ctx.globalAboutMe,
      });
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['chats', vars.chatId] });
      void qc.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}
```
2. `useRegenerate` mutationFn — after loading `msgs`, branch before the existing target-find:
```typescript
      const hasUserMessage = msgs.some((m) => m.role === 'user');
      if (!hasUserMessage) {
        // Opener-only chat: re-roll the greeting instead of replaying a turn.
        const opener = [...msgs].reverse().find((m) => m.role === 'persona' && m.kind === 'opener');
        if (!opener) throw new Error('useRegenerate: nothing to regenerate');
        const ctx = await resolvePersonaContext(args.chatId, 'useRegenerate');
        await useStreamManagerStore.getState().regenerateOpener({
          chatId: args.chatId,
          targetMessageId: opener.id,
          chat: ctx.chat,
          persona: ctx.persona,
          provider: ctx.providerDef,
          providerConfig: ctx.providerConfig,
          apiKey: ctx.apiKey,
          corsProxyUrl: ctx.corsProxyUrl,
          corsProxyKey: ctx.corsProxyKey,
          offering: ctx.offering,
          reasoning: args.reasoning,
          globalInstructions: ctx.globalInstructions,
          globalAboutMe: ctx.globalAboutMe,
        });
        return;
      }
```
and the normal target-find adds `&& m.kind !== 'opener'`:
```typescript
      const target = [...msgs]
        .reverse()
        .find((m) => m.role === 'persona' && m.streamingState === 'complete' && m.kind !== 'opener');
```

- [ ] **Step 4: Run** `pnpm vitest run tests/unit/use-regenerate.test.tsx tests/unit/use-start-opener.test.tsx tests/unit/use-send-message.test.tsx` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/data/send-message.ts apps/user-client/tests
git commit -m "Wire opener generation and re-roll into the send path"
```

---

### Task 9: Chat-page trigger, eager creation, empty-state notice

**Files:**
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx`
- Modify: `apps/user-client/src/components/chat/PersonaGreeting.tsx`
- Modify: `apps/user-client/src/components/chat/MessageControls.tsx`
- Test: `apps/user-client/tests/unit/chat-page.test.tsx` (extend), `tests/component/` or `tests/components/` PersonaGreeting test (extend/create), MessageControls test (extend/create — check existing location with `rg -l "MessageControls" apps/user-client/tests`).

**Behavioural contract (spec §5/§6 + Laura pins):**

1. **Eager creation:** on the lazy route (`/app/chat/new?personaId=…`), when the loaded persona has `greetingEnabled`, create the ChatRow immediately via `useCreateChat` with `{ openerPending: true, draftInput: loadLazyDraft(personaId) }`, then `clearLazyDraft(personaId)` and `navigate(`/app/chat/${newId}`, { replace: true })`. Guard with a `useRef` so StrictMode/double-render cannot create two chats. Personas without greeting keep today's lazy behaviour untouched.
2. **Trigger:** on a chat route, when `chat.openerPending && messages.length === 0 && !streamHandle`, fire `useStartOpener().mutate({ chatId, reasoning })` exactly once per mount (ref keyed on chat id — the automatic retry on next open comes from the flag, not from looping within a mount).
3. **Empty state:** `PersonaGreeting` renders whenever the pane has no messages AND no live stream — for lazy chats (today's case) and for real chats whose opener failed. While the opener streams, ChatStream renders the growing draft as usual.
4. **Failure notice (Laura pin):** when the opener mutation `isError`, `PersonaGreeting` shows beneath the idle line a small notice + Retry button. New optional props:
```typescript
interface PersonaGreetingProps {
  name: string;
  font: 'sans' | 'serif' | 'cursive';
  colour: string;
  /** Constructive opener-failure notice (spec §6.4); rendered beneath the idle line. */
  notice?: string;
  onRetry?: () => void;
}
```
Notice copy: `` `${name} couldn't compose the greeting` `` with a `Retry` button (`type="button"`, visible focus, fits 380 px, never overlaps the input — it lives inside the centred empty-state container). Retry calls the same mutation again.
5. **Re-roll tooltip (Laura pin):** in `MessageControls`, the regenerate button's `title` becomes `p.message.kind === 'opener' ? 'Re-roll the greeting' : 'Regenerate this reply'` (add a `title` attribute; today it has none — keep the visible label `↻ Regenerate` unchanged).
6. **Footer retry on a stopped opener:** inspect the `StreamInterruptedFooter` `onRetry` handler in chat-page (lines ~428–467). If its logic replays a user turn, route the no-user-message case to `regenerate.mutateAsync({ chatId, reasoning })` — which (Task 8) now handles the opener branch. Verify by test: a chat whose only message is an incomplete opener → footer Retry triggers `regenerateOpener`, not a crash.

- [ ] **Step 1: Write failing component tests** for: eager creation navigates and creates exactly one chat with `openerPending`; the trigger fires `startOpener` once for an `openerPending` empty chat; PersonaGreeting renders notice + Retry and Retry refires; MessageControls opener tooltip.

- [ ] **Step 2: Run to verify failures.**

- [ ] **Step 3: Implement** per the contract. Read the surrounding chat-page code first (lazy effects at lines ~100–130 and ~230–260; render branch at ~394). Keep all changes minimal and pattern-true; do not restructure unrelated page logic.

- [ ] **Step 4: Run** the touched test files + `tests/unit/chat-page.test.tsx` + `tests/unit/chat-route.test.tsx`. NOTE: `chat-page`/`chat-route`/`cockpit-draft` carry a known pre-existing localStorage-jsdom failure baseline on master — compare failures against master before claiming a regression, and add no new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src apps/user-client/tests
git commit -m "Trigger opener streaming from the chat page with constructive failure state"
```

---

### Task 10: Persona editor — Roleplay toggles + Greeting section

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`
- Test: `apps/user-client/tests/routes/persona-editor.roleplay.test.tsx` (create — mirror `persona-editor.tonality.test.tsx` and `persona-editor.ask-expert.test.tsx` setup)

**Behavioural contract (spec §5 + Laura pins):**

1. **Behaviour accordion** gains, after the Adult-Persona toggle:
   - **Roleplay** toggle (button pattern identical to Tonality), copy: label `Roleplay`, explanation `The persona becomes a roleplay character: fully in character, short conversational replies, narration between asterisks.`
   - **Narration** selector directly beneath: two pill buttons `First person` / `Third person` (font-picker pattern), reflecting `draft.narration`. Both **disabled with `title="Enable Roleplay to choose the narration perspective"` while `!draft.roleplay`** (disabled-over-hidden). Default selection `first`.
2. **New `Greeting` accordion** placed **immediately after the Behaviour accordion** (Laura pin — the two "how it talks" sections cluster):
```tsx
      {/* Greeting */}
      <AccordionCard
        icon="✦"
        label="Greeting"
        meta={draft.greetingEnabled ? 'Opens new chats' : 'Off'}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-paper">User greeting</div>
            <p className="text-[11px] text-paper-soft">
              The persona opens every new chat with a freshly generated message following your
              rules below.
            </p>
          </div>
          {/* toggle button — exact Tonality pattern, aria-label="User greeting",
              bound to draft.greetingEnabled */}
        </div>
        <AutoSizeTextarea
          aria-label="Greeting rules"
          minRows={3}
          maxRows={12}
          value={draft.greetingInstructions}
          onChange={(v) => patch({ greetingInstructions: v })}
          disabled={!draft.greetingEnabled}
          placeholder="Greet the user as if you had just discovered them on OkCupid."
        />
        {greetingInvalid ? (
          <p className="mt-1 text-[11px] text-amber-300/80">
            Write the greeting rules, or turn the greeting off.
          </p>
        ) : null}
      </AccordionCard>
```
   (If `AutoSizeTextarea` lacks `disabled`/`placeholder` props, add them as pass-throughs — check its definition first.) **Text retention is automatic** — the draft field is never cleared on toggle-off; assert it in the test.
3. **Save gate:**
```typescript
  const greetingInvalid = draft.greetingEnabled && draft.greetingInstructions.trim() === '';
```
   `greetingInvalid` joins `personaInvalid`, `saveDisabled`, and `saveTooltip` (tooltip branch: `'Write the greeting rules (or turn the greeting off)'`). All other draft state is preserved while blocked (it already is — draft state lives in memory).

- [ ] **Step 1: Write failing tests** covering: roleplay toggle flips draft; narration buttons disabled until roleplay on (with tooltip) and flip `draft.narration` when on; greeting textarea disabled until toggle on; toggle-off retains the typed text in the draft; save disabled + tooltip when greeting on with blank rules; inline notice visible.

- [ ] **Step 2: Run to verify failures.**

- [ ] **Step 3: Implement** per the contract, exactly in the established toggle/accordion idioms.

- [ ] **Step 4: Run** `pnpm vitest run tests/routes/` (persona-editor files) — expect PASS, no regressions in the other persona-editor suites (`behaviourMeta` etc. untouched).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/tests/routes/persona-editor.roleplay.test.tsx
git commit -m "Add roleplay and greeting sections to the persona editor"
```

---

### Task 11: Full verification gates

- [ ] **Step 1:** `pnpm typecheck --force` (repo root) — expect **14/14** green.
- [ ] **Step 2:** `cd packages/llm-unified && bun test` — expect all green (326+ baseline + new).
- [ ] **Step 3:** `cd apps/user-client && pnpm vitest run` — expect the **unchanged** pre-existing baseline failures ONLY (the cockpit-draft/chat-page/chat-route localStorage-jsdom trio — verify the same failures exist on master before accepting them); zero new failures.
- [ ] **Step 4:** `pnpm run build` (repo root) — expect 9/9.
- [ ] **Step 5:** Biome on changed files (`pnpm biome check <files>`) — clean (the known pre-existing `index.css` drift on master is not ours).
- [ ] **Step 6:** Commit any stragglers; report gate numbers verbatim.

---

## Self-review notes (spec coverage)

- Spec §3 data model → Task 3. §4.1/4.2 segment + texts → Tasks 1–2. §4.3 greeting job → Tasks 2, 5, 7. §5.1 behaviour toggles → Task 10. §5.2 greeting section incl. retention + placement → Task 10. §6.1/6.2 trigger + no-retrofit → Tasks 3 (flag), 7 (guards), 9 (trigger/eager creation). §6.3 wire exclusion → Tasks 5–6. §6.4 stop/re-roll/failure/controls → Tasks 7–9. §7 (no Larissa; Laura pre-squash) → handled outside the plan by Liz. §8 testing map → distributed per task.
- Branch-copy `kind` preservation (spec §6.2) → Task 3 step 6.
- Title-gen would silently break without the count-gate fix → Task 6 (load-bearing).
- Dexie head verified v19 at plan time; v20 claimed here (voice settings, the other v20 candidate, are unbuilt — re-verify head at execution start per the parallel-version-ownership rule).
