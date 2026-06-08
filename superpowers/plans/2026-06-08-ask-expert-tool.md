# ask_expert Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give small conversation models an "uplink" — an `ask_expert` tool that forwards a single sanitised technical question to a user-chosen global expert model (at max reasoning, streamed live into the pill), then weaves the answer back in the companion's voice.

**Architecture:** A streaming context-tool added to `resolveActiveTools`, gated on a global `SettingsRow.expertModel` (My Settings) and muted per-chat by a cockpit runtime toggle (`useCurrentChatStore.askExpert`) seeded from `PersonaRow.askExpertDefault`. The expert sees ONLY `[system(EXPERT_PROMPT), user(question)]` — structural isolation. Mirrors three precedents: substitute-vision (global one-shot model), the reasoning toggle (per-chat runtime control), and the artefact-author (streaming from inside a tool handler).

**Tech Stack:** TypeScript (strict), React 18, Zustand, Dexie, `@chatsundere/llm-unified` (`streamCompletion`), Vitest.

**Spec:** `superpowers/specs/2026-06-08-ask-expert-tool-design.md`

**Working dir:** the worktree `.claude/worktrees/ask-expert-tool` (branch `worktree-ask-expert-tool`). All paths below are relative to `apps/user-client/` unless noted.

**Conventions:** British English everywhere. SPDX header `// SPDX-License-Identifier: AGPL-3.0-only` on every new user-client file. Run the FULL user-client vitest per task (not just the touched dir). The pre-existing `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom failures (8) are a known baseline — verify any "pre-existing" claim against master.

---

### Task 1: `maxReasoningIntent` helper

**Files:**
- Modify: `src/lib/reasoning-resolver.ts` (append a new export)
- Test: `src/lib/reasoning-resolver.test.ts` (create or extend)

- [ ] **Step 1: Write the failing test**

Add to `src/lib/reasoning-resolver.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { ReasoningControl } from '@chatsundere/llm-unified';
import { maxReasoningIntent } from './reasoning-resolver.js';

describe('maxReasoningIntent', () => {
  it('none → disabled', () => {
    expect(maxReasoningIntent({ mode: 'none' })).toEqual({ enabled: false });
  });
  it('fixed-on → enabled', () => {
    expect(maxReasoningIntent({ mode: 'fixed-on' })).toEqual({ enabled: true });
  });
  it('toggle → enabled', () => {
    expect(maxReasoningIntent({ mode: 'toggle', defaultOn: false })).toEqual({ enabled: true });
  });
  it('steps → highest standard effort, offStep excluded', () => {
    const c: ReasoningControl = { mode: 'steps', steps: ['none', 'low', 'medium', 'high'], offStep: 'none', defaultStep: 'low' };
    expect(maxReasoningIntent(c)).toEqual({ enabled: true, effort: 'high' });
  });
  it('steps with non-standard labels → bare enabled', () => {
    const c: ReasoningControl = { mode: 'steps', steps: ['quick', 'deep'], offStep: null, defaultStep: 'quick' };
    expect(maxReasoningIntent(c)).toEqual({ enabled: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- reasoning-resolver`
Expected: FAIL — `maxReasoningIntent` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/reasoning-resolver.ts`:
```ts
/**
 * The strongest reasoning intent a control allows — used by the ask_expert tool
 * to run the expert at full effort regardless of any UI step. `none` stays off;
 * `steps` picks the last non-`offStep` step and maps standard labels onto effort.
 */
export function maxReasoningIntent(control: ReasoningControl): ReasoningIntent {
  switch (control.mode) {
    case 'none':
      return { enabled: false };
    case 'fixed-on':
    case 'toggle':
      return { enabled: true };
    case 'steps': {
      const max = control.steps.filter((s) => s !== control.offStep).at(-1);
      return max === 'low' || max === 'medium' || max === 'high'
        ? { enabled: true, effort: max }
        : { enabled: true };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- reasoning-resolver`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reasoning-resolver.ts src/lib/reasoning-resolver.test.ts
git commit -m "Add maxReasoningIntent helper for ask_expert"
```

---

### Task 2: The `ask_expert` tool + `ToolProgress.phase`

**Files:**
- Modify: `src/tools/types.ts` (add optional `phase` to `ToolProgress`)
- Create: `src/tools/ask-expert.ts`
- Test: `src/tools/ask-expert.test.ts`

This task owns the structural-isolation invariant (the load-bearing test) and defines `ExpertBase` (imported later by `resolveExpert`).

- [ ] **Step 1: Extend `ToolProgress`**

In `src/tools/types.ts`, change the interface to:
```ts
/** Incremental progress a tool may report while executing (for live pills). */
export interface ToolProgress {
  charCount: number;
  /** Multi-phase tools (e.g. ask_expert) report which phase the count belongs to.
   *  Optional — single-phase tools (artefact author) omit it. */
  phase?: 'reasoning' | 'answer';
}
```

- [ ] **Step 2: Write the failing test**

Create `src/tools/ask-expert.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import type { StreamChunk } from '@chatsundere/llm-unified';
import { EXPERT_SYSTEM_PROMPT, createAskExpertTool, type ExpertBase } from './ask-expert.js';
import type { ToolProgress } from './types.js';

const BASE = {} as ExpertBase; // the tool only forwards it to streamFn; tests inspect the call

async function* yields(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const c of chunks) yield c;
}

describe('ask_expert tool', () => {
  it('forwards ONLY [system(EXPERT_PROMPT), user(question)] — structural isolation', async () => {
    const streamFn = vi.fn(() => yields([{ type: 'token', text: 'answer' }]));
    const tool = createAskExpertTool(BASE, 'Big Model', { enabled: true, effort: 'high' }, true, streamFn as never);
    await tool.execute({ question: 'What is a Lie group?' });
    const call = streamFn.mock.calls[0]![0] as { messages: unknown[]; bodyExtras: unknown; tools?: unknown };
    expect(call.messages).toEqual([
      { role: 'system', content: EXPERT_SYSTEM_PROMPT },
      { role: 'user', content: 'What is a Lie group?' },
    ]);
    expect(call.bodyExtras).toEqual({ reasoning: { enabled: true, effort: 'high' } });
    expect(call.tools).toBeUndefined();
  });

  it('runtime-off → constructive error, never calls streamFn', async () => {
    const streamFn = vi.fn(() => yields([]));
    const tool = createAskExpertTool(BASE, 'M', { enabled: true }, false, streamFn as never);
    const r = await tool.execute({ question: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/switched off/i);
    expect(streamFn).not.toHaveBeenCalled();
  });

  it('empty question → no call', async () => {
    const streamFn = vi.fn(() => yields([]));
    const tool = createAskExpertTool(BASE, 'M', { enabled: true }, true, streamFn as never);
    const r = await tool.execute({ question: '   ' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no question/i);
    expect(streamFn).not.toHaveBeenCalled();
  });

  it('streams reasoning then answer, reports phased progress, returns answer + meta', async () => {
    const streamFn = vi.fn(() =>
      yields([
        { type: 'reasoning', text: 'think' },
        { type: 'token', text: 'Hel' },
        { type: 'token', text: 'lo' },
      ]),
    );
    const tool = createAskExpertTool(BASE, 'Big Model', { enabled: true }, true, streamFn as never);
    const progress: ToolProgress[] = [];
    const r = await tool.execute({ question: 'q' }, undefined, (p) => progress.push(p));
    expect(r.ok).toBe(true);
    expect(r.output).toBe('Hello');
    expect(r.meta).toEqual({ question: 'q', model: 'Big Model' });
    expect(progress).toEqual([
      { charCount: 5, phase: 'reasoning' },
      { charCount: 3, phase: 'answer' },
      { charCount: 5, phase: 'answer' },
    ]);
  });

  it('error chunk → ok:false', async () => {
    const streamFn = vi.fn(() => yields([{ type: 'error', message: 'boom' }]));
    const tool = createAskExpertTool(BASE, 'M', { enabled: true }, true, streamFn as never);
    const r = await tool.execute({ question: 'q' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('boom');
  });

  it('no answer text → "returned no answer"', async () => {
    const streamFn = vi.fn(() => yields([{ type: 'reasoning', text: 'only thinking' }]));
    const tool = createAskExpertTool(BASE, 'M', { enabled: true }, true, streamFn as never);
    const r = await tool.execute({ question: 'q' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no answer/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- ask-expert`
Expected: FAIL — module `./ask-expert.js` not found.

- [ ] **Step 4: Implement**

Create `src/tools/ask-expert.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-only
import {
  type CompletionTarget,
  type ProviderConfig,
  type ProviderDefinition,
  type ReasoningIntent,
  type StreamChunk,
  type WireMessage,
  streamCompletion,
} from '@chatsundere/llm-unified';
import type { Tool, ToolResult } from './types.js';

/** The shared subset of StreamCompletionArgs the expert call needs (resolved on
 *  the send path, which holds the MasterKey). */
export interface ExpertBase {
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  target: CompletionTarget;
}

export const EXPERT_SYSTEM_PROMPT =
  'You are a subject-matter expert consulted on a single, self-contained technical ' +
  'question — typically mathematics, science, software engineering, or another rigorous ' +
  'domain. Answer it precisely, rigorously, and completely; show the key steps where they ' +
  'aid correctness. You have no access to any prior conversation, so treat the question as ' +
  'wholly standalone and do not ask for clarification — state any assumptions you must make. ' +
  'Answer the question as asked, without moralising or adding unsolicited caveats.';

const INSTRUCTION =
  'An `ask_expert` tool forwards a single self-contained question to a more capable expert ' +
  'model. Reach for it when a maths, science, or engineering question is genuinely beyond ' +
  'what you can answer confidently on your own. Write the question as a clean, standalone ' +
  'technical query: include every fact needed to answer it, but strip names, personal ' +
  'details, and any emotional or relational context — only the question text travels to the ' +
  'expert, nothing else from this conversation. Then weave the expert’s answer into your own ' +
  'reply, in your own voice.';

/**
 * Build the ask_expert tool over a resolved expert model. The expert sees ONLY
 * `[system(EXPERT_SYSTEM_PROMPT), user(question)]` — no history, no persona, no
 * tools (the structural-isolation invariant). It streams at max reasoning so the
 * pill can show live progress and a long reasoning phase is not timeout-capped.
 * `runtimeEnabled` is the per-chat cockpit toggle: when false the tool stays in
 * `toolDefs` (cache-prefix stable) but execute returns a constructive error.
 */
export function createAskExpertTool(
  base: ExpertBase,
  modelLabel: string,
  reasoning: ReasoningIntent,
  runtimeEnabled: boolean,
  streamFn: typeof streamCompletion = streamCompletion,
): Tool {
  return {
    name: 'ask_expert',
    description:
      'Forward one self-contained technical question to a more capable expert model and return its answer.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description:
            'A clean, standalone technical question with every fact needed to answer it, and no personal, emotional, or relational context.',
        },
      },
      required: ['question'],
    },
    systemPromptInstruction: INSTRUCTION,

    async execute(args, signal, onProgress): Promise<ToolResult> {
      if (!runtimeEnabled) {
        return {
          ok: false,
          output: '',
          error:
            'The expert is switched off for this chat. Answer the question yourself as best you can; do not call ask_expert again this turn.',
        };
      }
      const question = typeof args.question === 'string' ? args.question : '';
      if (question.trim().length === 0) {
        return { ok: false, output: '', error: 'No question provided.' };
      }

      const messages: WireMessage[] = [
        { role: 'system', content: EXPERT_SYSTEM_PROMPT },
        { role: 'user', content: question },
      ];
      let answer = '';
      let reasoningChars = 0;
      try {
        for await (const chunk of streamFn({
          provider: base.provider,
          providerConfig: base.providerConfig,
          apiKey: base.apiKey,
          corsProxyUrl: base.corsProxyUrl,
          corsProxyKey: base.corsProxyKey,
          target: base.target,
          messages,
          bodyExtras: { reasoning },
          signal,
        })) {
          const c = chunk as StreamChunk;
          if (c.type === 'reasoning') {
            reasoningChars += c.text.length;
            onProgress?.({ charCount: reasoningChars, phase: 'reasoning' });
          } else if (c.type === 'token') {
            answer += c.text;
            onProgress?.({ charCount: answer.length, phase: 'answer' });
          } else if (c.type === 'error') {
            throw new Error(c.message);
          }
        }
      } catch (e) {
        return { ok: false, output: '', error: e instanceof Error ? e.message : 'Expert call failed.' };
      }
      if (answer.trim().length === 0) {
        return { ok: false, output: '', error: 'The expert returned no answer.' };
      }
      return { ok: true, output: answer, error: null, meta: { question, model: modelLabel } };
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- ask-expert`
Expected: PASS (all 6).

- [ ] **Step 6: Commit**

```bash
git add src/tools/types.ts src/tools/ask-expert.ts src/tools/ask-expert.test.ts
git commit -m "Add ask_expert tool with structural isolation and streamed progress"
```

---

### Task 3: Dexie v16 — `expertModel` + `askExpertDefault`

**Files:**
- Modify: `src/boot/client-data-db.ts` (types, `version(16)`, seed)
- Test: the existing DB/migration test file (find via `rg -l "version\(15\)|verno|upgrade" src/boot/*.test.ts src/**/*.test.ts`); extend it.

- [ ] **Step 1: Write the failing test**

In the DB test file, add a migration test mirroring the existing `substituteVisionModel` backfill test:
```ts
it('v16 backfills expertModel:null and askExpertDefault:false', async () => {
  const db = makeFreshDb(); // however the suite constructs the Dexie instance
  await db.open();
  const settings = await db.settings.get(1);
  expect(settings?.expertModel).toBeNull();
  // a seeded/added persona has the field:
  const personas = await db.personas.toArray();
  for (const p of personas) expect(p.askExpertDefault).toBe(false);
  db.close();
});
```
(If the suite has an explicit upgrade-from-older-version test, add field assertions there too.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- client-data-db`
Expected: FAIL — fields undefined / not on type.

- [ ] **Step 3: Implement**

In `src/boot/client-data-db.ts`:

a) Add to `SettingsRow` (after `substituteVisionModel`, ~`:24`):
```ts
/** Global expert model — an offering ref "templateId:upstreamSlug"; null = none.
 *  Forwards a single sanitised question via the ask_expert tool. */
expertModel: string | null;
```

b) Add to `PersonaRow` (after `libraryIds`, ~`:90`):
```ts
/** Default on/off state of the per-chat ask_expert runtime toggle for new chats
 *  of this persona. false = off (opt-in uplink). */
askExpertDefault: boolean;
```

c) After the current `this.version(15)...` block (~`:522`), append:
```ts
this.version(16)
  .stores({}) // no index changes
  .upgrade(async (tx) => {
    await tx
      .table('settings')
      .toCollection()
      .modify((row: SettingsRow) => {
        if (row.expertModel === undefined) row.expertModel = null;
      });
    await tx
      .table('personas')
      .toCollection()
      .modify((row: PersonaRow) => {
        if (row.askExpertDefault === undefined) row.askExpertDefault = false;
      });
  });
```

d) In the settings seed object (~`:650`, where `substituteVisionModel: null` is set), add:
```ts
expertModel: null,
```

(Persona seed/creation gets `askExpertDefault: false` in Task 7 — the in-code default. The migration covers existing rows; the seed default covers any persona seeded here, so add `askExpertDefault: false` to any persona literal seeded in this file if present.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- client-data-db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/boot/client-data-db.ts src/boot/*.test.ts
git commit -m "Add Dexie v16: expertModel and askExpertDefault"
```

---

### Task 4: `resolveExpert` (send path)

**Files:**
- Modify: `src/data/send-message.ts` (add `resolveExpert`, extend `PersonaContext`)
- Test: `src/data/send-message.test.ts` (or the existing send-message test file)

- [ ] **Step 1: Write the failing test**

Add a `resolveExpert` describe block. Mirror the existing `resolveSubstituteVision` tests if present. Cover: configured+resolvable → `{ base, modelLabel, reasoning }` with `reasoning` = the offering's max intent; `null` ref → null; unknown offering → null; no enabled provider row → null. Use the suite's existing catalogue/db test doubles. If `resolveExpert` is not exported, export it for the unit test (mirror how `resolveSubstituteVision` is tested).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- send-message`
Expected: FAIL — `resolveExpert` undefined.

- [ ] **Step 3: Implement**

In `src/data/send-message.ts`:

a) Imports: add `import { maxReasoningIntent } from '../lib/reasoning-resolver.js';`, `import type { ExpertBase } from '../tools/ask-expert.js';`, and ensure `ReasoningIntent` is importable from `@chatsundere/llm-unified`.

b) Add after `resolveSubstituteVision` (~`:169`):
```ts
/**
 * Resolve the global expert model (`settings.expertModel`, a
 * "templateId:upstreamSlug" ref) into the ask_expert tool's call base, its
 * display label, and its MAX reasoning intent. Returns `null` when unconfigured
 * or unresolvable (no enabled provider row / unknown offering / corrupt key) →
 * the tool is simply not offered. Decryption happens here (send path holds the MK).
 */
export async function resolveExpert(
  ref: string | null,
  mk: MasterKey,
  corsProxyUrl: string | null,
  corsProxyKey: string | null,
): Promise<{ base: ExpertBase; modelLabel: string; reasoning: ReasoningIntent } | null> {
  if (!ref) return null;
  const idx = ref.indexOf(':');
  if (idx < 0) return null;
  const templateId = ref.slice(0, idx);
  const slug = ref.slice(idx + 1);

  const providerDef = getProvider(templateId);
  const offering = getOffering(templateId, slug);
  if (!providerDef || !offering) return null;

  const db = getClientDataDb();
  const providerRow = (await db.providers.where('templateId').equals(templateId).toArray()).find(
    (p) => p.enabled,
  );
  if (!providerRow) return null;

  let apiKey: string;
  try {
    apiKey = await openSecret(providerRow.apiKey, mk, `provider/${providerRow.id}/api-key`);
  } catch {
    console.warn('resolveExpert: failed to decrypt api-key — falling back to null');
    return null;
  }

  return {
    base: {
      provider: providerDef,
      providerConfig: {
        baseUrl: providerDef.baseUrl,
        routing:
          providerDef.corsHint === 'requires-proxy' ? { kind: 'cors-proxy' } : { kind: 'direct' },
      },
      apiKey,
      corsProxyUrl,
      corsProxyKey,
      target: offeringToTarget(offering),
    },
    modelLabel: offering.displayName, // adjust to the Offering's actual label field
    reasoning: maxReasoningIntent(offering.profile.reasoning),
  };
}
```
> NOTE for implementer: confirm the `Offering` display-name field name (the picker renders it — check `getOffering`'s return type in `@chatsundere/llm-unified`). If it is not `displayName`, use the correct field (e.g. `offering.name`).

c) Extend `PersonaContext` (~`:27`) with:
```ts
expertBase: ExpertBase | null;
expertModelLabel: string | null;
expertReasoning: ReasoningIntent | null;
```

d) Inside `resolvePersonaContext`, after the `webInterfacing` block (~`:86`), resolve the expert and include it in the returned object:
```ts
const expert = await resolveExpert(settings.expertModel ?? null, mk, corsProxyUrl, corsProxyKey);
```
and in the `return { ... }`:
```ts
expertBase: expert?.base ?? null,
expertModelLabel: expert?.modelLabel ?? null,
expertReasoning: expert?.reasoning ?? null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- send-message`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/send-message.ts src/data/send-message.test.ts
git commit -m "Resolve global expert model on the send path"
```

---

### Task 5: `resolveActiveTools` third parameter

**Files:**
- Modify: `src/tools/registry.ts`
- Test: `src/tools/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Add:
```ts
import { createAskExpertTool, type ExpertBase } from './ask-expert.js';

it('includes ask_expert iff an expert context is given', () => {
  const ctx = /* minimal IntegrationContext stub the suite already uses */;
  const expert = { base: {} as ExpertBase, modelLabel: 'M', reasoning: { enabled: true } as const, runtimeEnabled: true };
  expect(resolveActiveTools(ctx, null, null).some((t) => t.name === 'ask_expert')).toBe(false);
  expect(resolveActiveTools(ctx, null, expert).some((t) => t.name === 'ask_expert')).toBe(true);
});
it('runtimeEnabled:false still includes the tool (cache-prefix stability)', () => {
  const ctx = /* same stub */;
  const expert = { base: {} as ExpertBase, modelLabel: 'M', reasoning: { enabled: true } as const, runtimeEnabled: false };
  expect(resolveActiveTools(ctx, null, expert).some((t) => t.name === 'ask_expert')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tools/registry`
Expected: FAIL — third arg not accepted / tool absent.

- [ ] **Step 3: Implement**

In `src/tools/registry.ts`:
```ts
import { type ExpertBase, createAskExpertTool } from './ask-expert.js';
import type { ReasoningIntent } from '@chatsundere/llm-unified';

export interface ExpertToolContext {
  base: ExpertBase;
  modelLabel: string;
  reasoning: ReasoningIntent;
  runtimeEnabled: boolean;
}

export function resolveActiveTools(
  ctx: IntegrationContext,
  knowledge: KnowledgeContext | null = null,
  expert: ExpertToolContext | null = null,
): Tool[] {
  return [
    ...STATIC_TOOLS,
    ...INTEGRATIONS.flatMap((i) => i.contributesTools(ctx)),
    ...(knowledge ? contributeKnowledgeTools(knowledge) : []),
    ...(expert
      ? [createAskExpertTool(expert.base, expert.modelLabel, expert.reasoning, expert.runtimeEnabled)]
      : []),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tools/registry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/registry.ts src/tools/registry.test.ts
git commit -m "Wire ask_expert into resolveActiveTools"
```

---

### Task 6: current-chat store `askExpert`

**Files:**
- Modify: `src/state/current-chat.store.ts`
- Test: `src/state/current-chat.store.test.ts` (or wherever the store is tested)

- [ ] **Step 1: Write the failing test**

```ts
it('askExpert defaults false, setAskExpert sets it, reset clears it', () => {
  const s = useCurrentChatStore.getState();
  expect(s.askExpert).toBe(false);
  s.setAskExpert(true);
  expect(useCurrentChatStore.getState().askExpert).toBe(true);
  useCurrentChatStore.getState().reset();
  expect(useCurrentChatStore.getState().askExpert).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- current-chat`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/state/current-chat.store.ts`:
- Add `askExpert: boolean;` to the interface (near `reasoning`, `:22`).
- Add `setAskExpert: (on: boolean) => void;` to the interface (near `setReasoning`, `:44`).
- Add `'setAskExpert'` to the `InitialState` omit list (`:56`).
- Add `askExpert: false,` to `initial` (`:75`).
- Add `setAskExpert: (on) => set({ askExpert: on }),` to the store body (near `setReasoning`, `:114`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- current-chat`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/current-chat.store.ts src/state/current-chat.store.test.ts
git commit -m "Add askExpert runtime toggle to current-chat store"
```

---

### Task 7: Stream-manager wiring + send/regenerate threading + persona creation default

**Files:**
- Modify: `src/state/stream-manager.store.ts` (StartArgs + expert assembly at `:354`)
- Modify: `src/data/send-message.ts` (thread `expert*` into `start` and `regenerate`)
- Modify: `src/data/personas.ts` + `src/routes/app/persona-editor.tsx` (creation default `askExpertDefault: false`)
- Test: `src/state/stream-manager-store.test.ts`

- [ ] **Step 1: Write the failing test**

In the stream-manager store test, add a test that `start({ ..., expertBase, expertReasoning })` with `toolsActive` results in `ask_expert` being among the offered tool defs, and that with `expertBase` undefined it is not. Reuse the suite's existing `start` harness (it already stubs offering/persona). Assert via the `runStreamEngine`/`toolDefs` seam the suite uses (mirror how the knowledge tool inclusion is asserted, if such a test exists). If direct assertion is hard, assert the simpler invariant: with a stubbed `useCurrentChatStore.askExpert`, the built `expert` object has the right `runtimeEnabled`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- stream-manager-store`
Expected: FAIL.

- [ ] **Step 3: Implement**

a) `src/state/stream-manager.store.ts` — add to `StartArgs`:
```ts
expertBase?: import('../tools/ask-expert.js').ExpertBase;
expertModelLabel?: string;
expertReasoning?: import('@chatsundere/llm-unified').ReasoningIntent;
```
At the tool-assembly point (`:354`), before `const activeTools = ...`:
```ts
const expert = args.expertBase
  ? {
      base: args.expertBase,
      modelLabel: args.expertModelLabel ?? 'expert',
      reasoning: args.expertReasoning ?? { enabled: true },
      runtimeEnabled: useCurrentChatStore.getState().askExpert,
    }
  : null;
const activeTools = toolsActive ? resolveActiveTools(integrationCtx, knowledge, expert) : [];
```

b) `src/data/send-message.ts` — in BOTH the `start({...})` call (`:250`) and the `regenerate({...})` call (`:344`), add:
```ts
expertBase: ctx.expertBase ?? undefined,
expertModelLabel: ctx.expertModelLabel ?? undefined,
expertReasoning: ctx.expertReasoning ?? undefined,
```

c) Persona creation default: in `src/data/personas.ts` where a new `PersonaRow` is built/added (the `db.personas.add(...)` site), add `askExpertDefault: false,`. In `src/routes/app/persona-editor.tsx` where the new-persona draft is initialised (the object with `chatsundereTonality: true`, `:82`), add `askExpertDefault: false,`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- stream-manager-store`
Expected: PASS.

- [ ] **Step 5: typecheck + commit**

```bash
pnpm --filter @chatsundere/user-client exec tsc --noEmit
git add src/state/stream-manager.store.ts src/data/send-message.ts src/data/personas.ts src/routes/app/persona-editor.tsx src/state/stream-manager-store.test.ts
git commit -m "Thread expert context through send, regenerate and the tool loop"
```

---

### Task 8: My Settings — expert model picker

**Files:**
- Modify: `src/routes/app/settings.tsx` (new `ExpertModelSetting` + an `AccordionCard`)
- Test: `src/routes/app/settings.test.tsx` (or the settings component test file)

Clone `SubstituteVisionSetting` (`:68`) and its `AccordionCard` (`:393`).

- [ ] **Step 1: Write the failing test**

```ts
it('expert model picker writes settings.expertModel', async () => {
  // render ExpertModelSetting with the suite's settings/provider test harness,
  // select an offering, assert update.mutate was called with { expertModel: "<templateId>:<slug>" }
});
it('expert model picker is disabled with a tooltip when no offerings are registered', () => {
  // render with no providers, assert the <select> is disabled and titled
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- settings`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `ExpertModelSetting()` modelled on `SubstituteVisionSetting` but: (1) list ALL offerings across registered providers (drop the `.filter((o) => o.profile.vision)`); (2) bind `value={settings?.expertModel ?? ''}` and `onChange={(e) => update.mutate({ expertModel: e.target.value || null })}`; (3) `aria-label="Expert model"`; (4) disabled-with-tooltip when the offering list is empty ("Add a provider first"); (5) copy + a zero-knowledge note: "Only the sanitised question you see in the pill leaves your device — never your conversation, persona, or personal details." Add an `AccordionCard` (suggest `icon="↑" label="Expert uplink" meta="Ask a stronger model for hard questions"`) wrapping it, beside the Image-understanding card (`:393`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- settings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/app/settings.tsx src/routes/app/settings.test.tsx
git commit -m "Add expert model picker to My Settings"
```

---

### Task 9: Persona editor — Behaviour default toggle

**Files:**
- Modify: `src/routes/app/persona-editor.tsx` (toggle in the Behaviour accordion)
- Test: the persona-editor component test file

Clone the Chatsundere-Tonality toggle (`:570-590`).

- [ ] **Step 1: Write the failing test**

```ts
it('toggles askExpertDefault', () => {
  // render editor with a global expertModel set; click the "Ask an expert" toggle;
  // assert patch({ askExpertDefault: true }) (or that the draft flips)
});
it('disables the toggle with a tooltip when no global expert model is set', () => {
  // render with settings.expertModel = null; assert the toggle button is disabled + titled
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- persona-editor`
Expected: FAIL.

- [ ] **Step 3: Implement**

In the Behaviour accordion (`:542`), beside the Tonality toggle, add an "Ask an expert by default" row: a label + subtitle ("Default for new chats; override per chat from the cockpit"), and a toggle button bound to `draft.askExpertDefault` / `patch({ askExpertDefault: !draft.askExpertDefault })`, styled exactly like the Tonality toggle. Read the global setting (the editor already loads settings, or load via the settings hook); when `settings?.expertModel == null` set the button `disabled` and `title="Choose a global expert model in Settings first."`. Optionally extend `behaviourMeta` (`:289`) with a small "Expert" marker when on (low priority — skip if it complicates the test).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- persona-editor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/app/persona-editor.tsx src/routes/app/persona-editor.test.tsx
git commit -m "Add ask-expert default toggle to persona Behaviour"
```

---

### Task 10: chat-page — seed runtime toggle from persona default

**Files:**
- Modify: `src/routes/app/chat/chat-page.tsx` (init effect mirroring reasoning `:194`)
- Test: covered by the chat-page test if feasible; otherwise rely on device verification (the chat-page jsdom baseline is fragile — do NOT fight it).

- [ ] **Step 1: Implement (effect mirror)**

Add a `setAskExpert` selector (`const setAskExpert = useCurrentChatStore((s) => s.setAskExpert);`) and, beside the reasoning init effect (`:194`):
```ts
useEffect(() => {
  if (persona) setAskExpert(persona.askExpertDefault);
}, [persona, setAskExpert]);
```
(Confirm the in-scope variable holding the active persona; the reasoning effect uses `offering` — use the persona object available in the same scope. If only `offering` is in scope, thread the persona's `askExpertDefault` from where the persona is loaded.)

- [ ] **Step 2: typecheck + full vitest**

Run: `pnpm --filter @chatsundere/user-client exec tsc --noEmit` then `pnpm --filter @chatsundere/user-client test`
Expected: typecheck clean; only the known 8 baseline failures (verify identical on master if any new one appears).

- [ ] **Step 3: Commit**

```bash
git add src/routes/app/chat/chat-page.tsx
git commit -m "Seed ask-expert runtime toggle from persona default"
```

---

### Task 11: Cockpit — runtime on/off chip

**Files:**
- Modify: `src/components/chat/CockpitMenu.tsx` (new section + props)
- Modify: `src/components/chat/Cockpit.tsx` (thread store + global-model availability)
- Test: `src/components/chat/CockpitMenu.test.tsx` (or the cockpit-menu test)

- [ ] **Step 1: Write the failing test**

```ts
it('renders an ask-expert On/Off section and fires onAskExpertChange', () => {
  // render CockpitMenu with askExpertAvailable, askExpert, onAskExpertChange;
  // click On → onAskExpertChange(true); click Off → onAskExpertChange(false)
});
it('disables the chips with a tooltip when askExpertAvailable is false', () => { /* ... */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- CockpitMenu`
Expected: FAIL.

- [ ] **Step 3: Implement**

a) `CockpitMenu.tsx`: add to `Props`:
```ts
askExpertAvailable?: boolean;   // a global expert model is configured
askExpert?: boolean;
onAskExpertChange?: (on: boolean) => void;
```
Update the early-return guard (`:22`) to also keep the menu open when `askExpertAvailable`. Add a section beside reasoning / web-depth:
```tsx
{p.askExpertAvailable ? (
  <div className="cockpit-menu-section" data-section="ask-expert">
    <div className="cockpit-menu-label">Ask expert</div>
    <div className="cockpit-menu-chips">
      {chip('On', p.askExpert === true, { onClick: () => p.onAskExpertChange?.(true) })}
      {chip('Off', p.askExpert !== true, { onClick: () => p.onAskExpertChange?.(false) })}
    </div>
  </div>
) : null}
```
(Use the existing `chip(...)` helper and the same markup the reasoning/web-depth sections use.)

b) `Cockpit.tsx`: read `askExpert` + `setAskExpert` from `useCurrentChatStore`, compute `askExpertAvailable` from `settings?.expertModel != null` (load via the settings hook the cockpit already has, or pass down from chat-page), and pass the three props to `CockpitMenu`. Close the menu on change like `onReasoningChange` does.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- CockpitMenu`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/CockpitMenu.tsx src/components/chat/Cockpit.tsx src/components/chat/CockpitMenu.test.tsx
git commit -m "Add ask-expert runtime chip to the cockpit menu"
```

---

### Task 12: ExpertPill — live progress + expandable Q&A

**Files:**
- Create: `src/components/chat/ExpertPill.tsx`
- Modify: `src/components/chat/Pill.tsx` (early dispatch for `ask_expert`)
- Test: `src/components/chat/ExpertPill.test.tsx`

Clone `ArtefactPill.tsx` for the building/failed/ready states; ready is expandable (own `useState`) rather than lightbox-opening.

- [ ] **Step 1: Write the failing test**

```ts
import { render, screen, fireEvent } from '@testing-library/react';
import type { PillRow } from '../../boot/client-data-db.js';
import { ExpertPill } from './ExpertPill.js';

const row = (over: Partial<PillRow>, payload: Record<string, unknown>): PillRow => ({
  id: 'p', messageId: 'm', kind: 'tool-call', positionHint: 'inline',
  status: 'pending', payload, createdAt: 0, ...over,
});

it('pending reasoning phase shows thinking + chars + model', () => {
  render(<ExpertPill row={row({ status: 'pending' }, { name: 'ask_expert', model: 'Big Model', phase: 'reasoning', charCount: 1234 })} />);
  expect(screen.getByText(/thinking/i)).toBeInTheDocument();
  expect(screen.getByText(/1,234/)).toBeInTheDocument();
});
it('pending answer phase shows answering', () => {
  render(<ExpertPill row={row({ status: 'pending' }, { name: 'ask_expert', model: 'M', phase: 'answer', charCount: 10 })} />);
  expect(screen.getByText(/answering/i)).toBeInTheDocument();
});
it('completed pill expands to show question and answer', () => {
  render(<ExpertPill row={row({ status: 'completed' }, { name: 'ask_expert', model: 'M', question: 'Q?', result: 'A.', argumentsJson: '{"question":"Q?"}' })} />);
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText('Q?')).toBeInTheDocument();
  expect(screen.getByText('A.')).toBeInTheDocument();
});
it('failed pill shows the error', () => {
  render(<ExpertPill row={row({ status: 'failed' }, { name: 'ask_expert', model: 'M', error: 'boom' })} />);
  expect(screen.getByText(/boom/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- ExpertPill`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/chat/ExpertPill.tsx`:
```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { PillRow } from '../../boot/client-data-db.js';

interface ExpertPayload {
  model?: string;
  question?: string;
  argumentsJson?: string;
  result?: string;
  error?: string;
  charCount?: number;
  phase?: 'reasoning' | 'answer';
}

function questionOf(p: ExpertPayload): string {
  if (p.question) return p.question;
  if (p.argumentsJson) {
    try {
      const a = JSON.parse(p.argumentsJson) as { question?: string };
      if (typeof a.question === 'string') return a.question;
    } catch {
      /* ignore */
    }
  }
  return '';
}

/** Pill for ask_expert tool-calls: thinking/answering (live) · expandable Q&A. */
export function ExpertPill({ row }: { row: PillRow }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const p = (row.payload ?? {}) as ExpertPayload;
  const model = p.model ?? 'expert';
  const chars = (p.charCount ?? 0).toLocaleString();

  if (row.status === 'pending') {
    const verb = p.phase === 'answer' ? 'answering' : 'thinking';
    return (
      <span className="artefact-pill" data-state="building">
        <span className="artefact-pill-ic" aria-hidden>↑</span>
        <span className="artefact-pill-ttl">{model}</span>
        <span className="artefact-pill-sub">{verb} · {chars} chars</span>
        <span className="artefact-pill-bar"><i /></span>
      </span>
    );
  }
  if (row.status === 'failed') {
    return (
      <span className="artefact-pill" data-state="tombstone" aria-disabled>
        <span className="artefact-pill-ic" aria-hidden>↑</span>
        <span className="artefact-pill-ttl">expert · {model}</span>
        <span className="artefact-pill-sub">{p.error ?? 'failed'}</span>
      </span>
    );
  }
  return (
    <span className="pill" data-kind="ask-expert">
      <button type="button" className="pill-head" onClick={() => setExpanded((v) => !v)}>
        <span className="pill-ic" aria-hidden>↑</span>
        <span className="pill-ttl">Asked expert · {model}</span>
      </button>
      {expanded ? (
        <div className="pill-body">
          <div className="pill-q">{questionOf(p)}</div>
          <div className="pill-a">{p.result ?? ''}</div>
        </div>
      ) : null}
    </span>
  );
}
```
> NOTE: match the actual class names / expand affordance of the existing `Pill.tsx` (its expanded body for `calculate_js`). Reuse its CSS classes rather than inventing `pill-q`/`pill-a` if equivalents exist — the goal is visual parity with the other pills.

In `src/components/chat/Pill.tsx`, add an early dispatch beside the `create_artefact` one:
```tsx
if (
  row.kind === 'tool-call' &&
  (row.payload as { name?: string } | undefined)?.name === 'ask_expert'
) {
  return <ExpertPill row={row} />;
}
```
(and `import { ExpertPill } from './ExpertPill.js';`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- ExpertPill`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ExpertPill.tsx src/components/chat/Pill.tsx src/components/chat/ExpertPill.test.tsx
git commit -m "Add ExpertPill with live progress and expandable Q&A"
```

---

### Task 13: Docs — security deferral + STATUS

**Files:**
- Modify: `obsidian/insights/security-deferrals.md` (repo root, not user-client)
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`

- [ ] **Step 1: Append a security-deferral entry**

Add an entry to `obsidian/insights/security-deferrals.md` recording the new outbound egress (a sanitised question to a cloud expert model), the structural-isolation guarantee (only the `question` string travels — no history/persona/about-me), and that it is consensual, opt-in (persona default off), anti-paternalistic, and reuses the existing MasterKey-gated per-provider key. British English.

- [ ] **Step 2: Update STATUS (do at the very end, after squash, per the STATUS protocol)**

Defer the STATUS edit to the squash/landing moment (Liz owns it). Note here so it is not forgotten.

- [ ] **Step 3: Commit**

```bash
git add obsidian/insights/security-deferrals.md
git commit -m "Log ask_expert outbound egress in security-deferrals [skip ci]"
```

---

### Task 14: Full verification gate

- [ ] **Step 1: typecheck**

Run (repo root): `pnpm typecheck`
Expected: all packages clean.

- [ ] **Step 2: build**

Run: `pnpm run build`
Expected: 9/9.

- [ ] **Step 3: full user-client vitest**

Run: `pnpm --filter @chatsundere/user-client test`
Expected: all green except the known `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline (8). If any NEW failure appears, verify it against master before accepting.

- [ ] **Step 4: biome**

Run: `pnpm exec biome check .` (or the repo's lint script)
Expected: clean on all touched files.

- [ ] **Step 5: Holistic review**

Hand the full diff to an opus holistic reviewer (subagent-driven-development's final review): verify the isolation invariant end-to-end, the three-layer lifecycle (global model → persona default → cockpit runtime), cache-prefix stability (tool present regardless of runtime toggle), max-reasoning derivation, and the live-pill phases. Fix findings, then this branch is READY TO SQUASH (Liz squashes + updates STATUS + merges on Chris's word).

---

## Self-Review

- **Spec coverage:** §4 data model → T3; §5.1/5.3 resolveExpert + maxReasoningIntent → T1, T4; §5.2/§6 tool + isolation → T2; §7.1 registry → T5; §7.2 stream-manager → T7; §7.3 store → T6; §7.4 chat-page effect → T10; §8.1 settings picker → T8; §8.2 persona toggle → T9; §8.3 cockpit chip → T11; §9 pill → T12; §10 error handling → covered by T2 tests; §11 deferred → respected (single global model, reasoning now in v1); §12 tests → distributed; §13 merge coord → noted; §14 security → T13; §15 manual verification → device, post-squash.
- **Type consistency:** `ExpertBase` defined in T2 (`ask-expert.ts`), imported by T4/T5/T7. `ExpertToolContext` in T5 matches the object T7 builds (`base`/`modelLabel`/`reasoning`/`runtimeEnabled`). `maxReasoningIntent` (T1) consumed by T4. `ToolProgress.phase` (T2) consumed by T12. Pill payload fields (`question`/`model`/`charCount`/`phase`/`result`/`error`) flow from T2's `meta` + `onProgress` via `tool-loop.ts:97,81` into T12's `ExpertPayload`.
- **Known soft spots (implementer must confirm against the real code, NOT guess):** the `Offering` display-name field (`offering.displayName` vs `.name`) in T4; the persona variable in scope at the chat-page reasoning effect in T10; exact class names for pill parity in T12; the persona-creation site in `data/personas.ts` in T7. Each is flagged inline.
