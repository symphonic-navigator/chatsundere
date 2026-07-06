# Artefact Expert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user nominate a dedicated "Artefact expert" model that builds artefacts (`create_artefact`) instead of the persona's own model — global slot + per-chat toggle, with an honest error path when the expert is unreachable.

**Architecture:** Reuse the existing subagent-based artefact author. Pre-resolve an `artefactExpert: OfferingRef | null` per send (mirroring how `expertBase` is resolved in `send-message.ts` and threaded to the stream-manager), copy it onto the `IntegrationContext`, and have `create_artefact`'s `execute` build with `ctx.artefactExpert ?? ctx.personaOffering`. When the chat wants the expert but it is unreachable, return a constructive error carrying a `meta.artefactExpertUnavailable` discriminant that also drives an inline cockpit note independent of the persona's relay.

**Tech Stack:** TypeScript (strict), React 18, Zustand, TanStack Query, Dexie, Vitest, `@chatsundere/llm-unified`.

## Global Constraints

- **Language:** every text artefact — code, comments, JSDoc, commit messages, user-facing copy — is **British English** (`artefact`, `colour`, `behaviour`). No mixed-language strings.
- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`. No `any` without an inline comment. Every package-public function carries a one-line JSDoc.
- **Biome bans the non-null assertion `!`** — never write `x!`. Use explicit narrowing.
- **Licence header** on every NEW source file: `// SPDX-License-Identifier: AGPL-3.0-only` (the `apps/*` licence).
- **Tests** live under `apps/user-client/tests/**` and run via Vitest (`pnpm --filter @chatsundere/user-client test`).
- **Gate before every commit:** `pnpm typecheck --force` (turbo caches typecheck; a test-only change can get a stale cached pass — always `--force`) **and** Biome (`pnpm --filter @chatsundere/user-client exec biome check src tests`), **and** the FULL user-client Vitest suite (not just the touched file). The pre-existing Vitest baseline is 8 Node-localStorage failures — expect exactly 8; a 9th is real.
- **No Dexie version bump.** `SettingsRow.artefactExpertModel` and `ChatRow.useArtefactExpertModel` already exist and are non-indexed. Do not touch the schema or `strip.ts` — `chats` is deny-list polarity, so `useArtefactExpertModel` syncs by default.
- **Commit** per task, free-form imperative subject, no `[skip ci]` (these are code changes), trailer `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.

---

## File-structure map

| File | Responsibility | Tasks |
|---|---|---|
| `apps/user-client/src/integrations/types.ts` | Add `artefactExpert` to `IntegrationContext` | 1 |
| `apps/user-client/src/integrations/build-context.ts` | Thread `artefactExpert` through `ArtefactTarget` → context | 1 |
| `apps/user-client/src/integrations/artefact/artefact-integration.ts` | Build with expert vs persona; constructive-error discriminant | 2 |
| `apps/user-client/src/lib/resolve-artefact-expert.ts` *(new)* | Pure gate: ref + chat opt-out → `OfferingRef \| null` | 3 |
| `apps/user-client/src/data/send-message.ts` | Resolve `artefactExpert` at send time, add to context | 3 |
| `apps/user-client/src/state/stream-manager.store.ts` | Pass `artefactExpert` in; drive inline note from tool `meta`; clear on send | 3, 6 |
| `apps/user-client/src/routes/app/settings/expert.tsx` | The global "Artefact expert" slot | 4 |
| `apps/user-client/src/components/chat/CockpitMenu.tsx` | Per-chat toggle section + micro-sublabels | 5 |
| `apps/user-client/src/components/chat/Cockpit.tsx` | Availability, read/write chat toggle, render inline note | 5, 6 |
| `apps/user-client/src/state/current-chat.store.ts` | Transient `artefactExpertError` for the inline note | 6 |
| `apps/user-client/src/index.css` | `.cockpit-menu-sublabel`, `.cockpit-artefact-note` | 5, 6 |

Dependency order: 1 → 2 → 3 (core), then 4, 5, 6 (UI; 6 consumes Task 2's `meta`).

---

## Task 1: IntegrationContext seam for the artefact expert

**Files:**
- Modify: `apps/user-client/src/integrations/types.ts` (interface `IntegrationContext`)
- Modify: `apps/user-client/src/integrations/build-context.ts` (`ArtefactTarget`, `buildIntegrationContext`)
- Test: `apps/user-client/tests/integrations/build-context.test.ts`

**Interfaces:**
- Produces: `IntegrationContext.artefactExpert: OfferingRef | null`; `ArtefactTarget.artefactExpert: OfferingRef | null`.

- [ ] **Step 1: Write the failing test** — append to `apps/user-client/tests/integrations/build-context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildIntegrationContext } from '../../src/integrations/build-context.js';

describe('buildIntegrationContext — artefactExpert', () => {
  const persona = { adultPersona: false };
  const web = { search: null, fetch: null };
  const route = { useProxy: false, webSearchTierId: null };
  const personaOffering = { providerId: 'p', upstreamSlug: 'm' };

  it('copies a provided artefactExpert onto the context', () => {
    const expert = { providerId: 'anthropic', upstreamSlug: 'opus-4-8' };
    const ctx = buildIntegrationContext(persona, web, null, route, {
      chatId: 'c1',
      personaId: 'per1',
      personaOffering,
      artefactExpert: expert,
    });
    expect(ctx.artefactExpert).toEqual(expert);
  });

  it('is null when none is configured', () => {
    const ctx = buildIntegrationContext(persona, web, null, route, {
      chatId: 'c1',
      personaId: 'per1',
      personaOffering,
      artefactExpert: null,
    });
    expect(ctx.artefactExpert).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test build-context`
Expected: FAIL — TS error / `artefactExpert` missing from `ArtefactTarget` and context.

- [ ] **Step 3: Add the field to `IntegrationContext`** in `types.ts`, immediately after the `personaOffering` field (currently line 36):

```ts
  /** The persona's LLM offering — the model the author subagent runs. */
  personaOffering: OfferingRef;
  /** The artefact-expert offering to build artefacts with, or null to use the
   *  persona model. Pre-resolved per send: set when a global artefact expert is
   *  configured AND this chat has not opted out; null otherwise. */
  artefactExpert: OfferingRef | null;
```

- [ ] **Step 4: Thread it through `build-context.ts`** — add to the `ArtefactTarget` interface (after `personaOffering: OfferingRef;`). It is **optional** so the existing stream-manager call site keeps compiling until Task 3 fills it in — every task commits typecheck-clean:

```ts
export interface ArtefactTarget {
  chatId: string;
  personaId: string;
  personaOffering: OfferingRef;
  /** Pre-resolved artefact-expert offering, or null/absent to use the persona
   *  model. Optional at the boundary; the context always carries an explicit
   *  `OfferingRef | null` (defaulted below). */
  artefactExpert?: OfferingRef | null;
}
```

and copy it in the returned object of `buildIntegrationContext`, next to `personaOffering: artefact.personaOffering,` (defaulting absent → null so the context field is always explicit):

```ts
    personaOffering: artefact.personaOffering,
    artefactExpert: artefact.artefactExpert ?? null,
    getKey: (id) => (mk ? getKeyFn(id, mk) : Promise.resolve(null)),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test build-context`
Expected: PASS. The existing `stream-manager.store.ts:808` call site still compiles (the field is optional), so no other code breaks yet — Task 3 supplies the real value.

- [ ] **Step 6: Gate**

Run: `pnpm typecheck --force`
Expected: PASS (clean — nothing else broken).

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/integrations/types.ts apps/user-client/src/integrations/build-context.ts apps/user-client/tests/integrations/build-context.test.ts
git commit -m "Add artefactExpert seam to the integration context

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 2: Build artefacts with the expert; constructive error on unavailability

**Files:**
- Modify: `apps/user-client/src/integrations/artefact/artefact-integration.ts`
- Test: `apps/user-client/tests/unit/artefact-integration.test.ts`

**Interfaces:**
- Consumes: `IntegrationContext.artefactExpert` (Task 1).
- Produces: a `create_artefact` `ToolResult` that, on expert-unavailability, has `ok: false` and `meta: { artefactExpertUnavailable: true }`. Task 6 consumes that discriminant.

- [ ] **Step 1: Write the failing tests** — append to `apps/user-client/tests/unit/artefact-integration.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { makeArtefactTool } from '../../src/integrations/artefact/artefact-integration.js';
import type { IntegrationContext } from '../../src/integrations/types.js';

function baseCtx(over: Partial<IntegrationContext> = {}): IntegrationContext {
  return {
    nsfwAllowed: false,
    location: null,
    webSearch: null,
    webFetch: null,
    useProxy: false,
    webSearchTierId: null,
    getKey: vi.fn(async () => 'k'),
    chatId: 'c1',
    personaId: 'per1',
    personaOffering: { providerId: 'persona-prov', upstreamSlug: 'persona-model' },
    artefactExpert: null,
    ...over,
  };
}

const stubResolve = () => ({
  base: {
    provider: { id: 'x', baseUrl: 'https://x' },
    providerConfig: { baseUrl: 'https://x', routing: { kind: 'direct' } },
    apiKey: '',
    target: {},
  },
  reasoning: { enabled: false },
}) as never;

describe('create_artefact — expert selection', () => {
  it('fetches the key for the expert provider when an expert is set', async () => {
    const getKey = vi.fn(async () => 'expert-key');
    const author = vi.fn(async () => '<html></html>');
    const ctx = baseCtx({
      getKey,
      artefactExpert: { providerId: 'anthropic', upstreamSlug: 'opus-4-8' },
    });
    const tool = makeArtefactTool(ctx, { author, resolveBase: stubResolve });
    // addGeneratedArtefact writes to Dexie; in this unit env it may throw — we
    // only assert the provider chosen for the key fetch, which happens first.
    await tool.execute({ title: 'T', brief: 'B' }, undefined, undefined).catch(() => undefined);
    expect(getKey).toHaveBeenCalledWith('anthropic');
    expect(author).toHaveBeenCalled();
  });

  it('fetches the persona key when no expert is set', async () => {
    const getKey = vi.fn(async () => 'persona-key');
    const author = vi.fn(async () => '<html></html>');
    const ctx = baseCtx({ getKey, artefactExpert: null });
    const tool = makeArtefactTool(ctx, { author, resolveBase: stubResolve });
    await tool.execute({ title: 'T', brief: 'B' }, undefined, undefined).catch(() => undefined);
    expect(getKey).toHaveBeenCalledWith('persona-prov');
  });

  it('returns the discriminant error (no fallback) when the expert key is missing', async () => {
    const ctx = baseCtx({
      getKey: vi.fn(async () => null),
      artefactExpert: { providerId: 'anthropic', upstreamSlug: 'opus-4-8' },
    });
    const author = vi.fn(async () => '<html></html>');
    const tool = makeArtefactTool(ctx, { author, resolveBase: stubResolve });
    const r = await tool.execute({ title: 'T', brief: 'B' }, undefined, undefined);
    expect(r.ok).toBe(false);
    expect(r.meta?.artefactExpertUnavailable).toBe(true);
    expect(author).not.toHaveBeenCalled();
  });

  it('gives a plain error (no discriminant) when the persona key is missing', async () => {
    const ctx = baseCtx({ getKey: vi.fn(async () => null), artefactExpert: null });
    const tool = makeArtefactTool(ctx, { resolveBase: stubResolve });
    const r = await tool.execute({ title: 'T', brief: 'B' }, undefined, undefined);
    expect(r.ok).toBe(false);
    expect(r.meta?.artefactExpertUnavailable).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test artefact-integration`
Expected: FAIL — key is fetched for `personaOffering` regardless of `artefactExpert`; no discriminant.

- [ ] **Step 3: Rework `defaultResolveBase` to use the target offering** — in `artefact-integration.ts`, change the first three lines of `defaultResolveBase` from `ctx.personaOffering` to the resolved target:

```ts
function defaultResolveBase(ctx: IntegrationContext): {
  base: SubagentBase;
  reasoning: ReasoningIntent;
} {
  const ref = ctx.artefactExpert ?? ctx.personaOffering;
  const providerDef = getProvider(ref.providerId);
  const offering = getOffering(ref.providerId, ref.upstreamSlug);
  if (!providerDef || !offering) throw new Error('Artefact author: model not resolvable');
```

(the rest of the function is unchanged — it already reads `offering`.)

- [ ] **Step 4: Add the constructive-error helper** — above `makeArtefactTool`:

```ts
/** The constructive "artefact expert unreachable" result. Carries the
 *  `artefactExpertUnavailable` discriminant so the stream-manager can raise an
 *  inline note independent of the persona's relay (spec §3.4). Names the model
 *  when the offering still resolves (e.g. a locked key), else stays generic. */
function artefactExpertUnavailableResult(ctx: IntegrationContext): ToolResult {
  const ref = ctx.artefactExpert;
  const offering = ref ? getOffering(ref.providerId, ref.upstreamSlug) : null;
  const name = offering ? `Your artefact expert (${offering.upstreamSlug})` : 'Your artefact expert';
  return {
    ok: false,
    output: '',
    error:
      `${name} isn't reachable right now — unlock its key, or pick a different ` +
      'model under My Settings › "Ask an Expert".',
    meta: { artefactExpertUnavailable: true },
  };
}
```

- [ ] **Step 5: Rework `execute` to branch on the expert** — replace the body from the `key` fetch down to the `author(...)` call (currently lines 90–101) with:

```ts
        const usingExpert = ctx.artefactExpert != null;
        let resolved: { base: SubagentBase; reasoning: ReasoningIntent };
        try {
          resolved = resolveBase(ctx);
        } catch {
          if (usingExpert) return artefactExpertUnavailableResult(ctx);
          return { ok: false, output: '', error: 'Artefact author: model not resolvable.' };
        }
        const providerId = (ctx.artefactExpert ?? ctx.personaOffering).providerId;
        const key = await ctx.getKey(providerId);
        if (!key) {
          if (usingExpert) return artefactExpertUnavailableResult(ctx);
          return { ok: false, output: '', error: 'No API key for the artefact author model.' };
        }
        const base = { ...resolved.base, apiKey: key };
        const content = await author({
          base,
          brief,
          reasoning: resolved.reasoning,
          signal,
          onProgress: (n) => onProgress?.({ charCount: n }),
        });
```

Delete the old `const resolved = resolveBase(ctx);` line further down (it is now above). The surrounding `try { … } catch (e)` that wraps `addGeneratedArtefact` stays — an author/network failure remains a plain error (no discriminant), which is correct: the discriminant is pre-flight only (locked key / removed offering), per spec §3.4.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client test artefact-integration`
Expected: PASS (4 new cases).

- [ ] **Step 7: Gate + commit**

```bash
pnpm typecheck --force
pnpm --filter @chatsundere/user-client exec biome check src tests
pnpm --filter @chatsundere/user-client test
git add apps/user-client/src/integrations/artefact/artefact-integration.ts apps/user-client/tests/unit/artefact-integration.test.ts
git commit -m "Build artefacts with the artefact expert, error honestly when unreachable

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 3: Resolve and thread the artefact expert per send

**Files:**
- Create: `apps/user-client/src/lib/resolve-artefact-expert.ts`
- Modify: `apps/user-client/src/data/send-message.ts`
- Modify: `apps/user-client/src/state/stream-manager.store.ts` (`StartArgs` type; `buildIntegrationContext` call)
- Test: `apps/user-client/tests/unit/resolve-artefact-expert.test.ts` *(new)*

**Interfaces:**
- Produces: `resolveArtefactExpert(ref: string | null | undefined, chat: { useArtefactExpertModel?: boolean }): OfferingRef | null`.
- Consumes: Task 1's `ArtefactTarget.artefactExpert`.

- [ ] **Step 1: Write the failing test** — create `apps/user-client/tests/unit/resolve-artefact-expert.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveArtefactExpert } from '../../src/lib/resolve-artefact-expert.js';

describe('resolveArtefactExpert', () => {
  it('returns null when no global expert is set', () => {
    expect(resolveArtefactExpert(null, {})).toBeNull();
    expect(resolveArtefactExpert(undefined, {})).toBeNull();
  });

  it('parses a "templateId:slug" ref into an OfferingRef', () => {
    expect(resolveArtefactExpert('anthropic:opus-4-8', {})).toEqual({
      providerId: 'anthropic',
      upstreamSlug: 'opus-4-8',
    });
  });

  it('splits only on the first colon', () => {
    expect(resolveArtefactExpert('prov:a:b', {})).toEqual({
      providerId: 'prov',
      upstreamSlug: 'a:b',
    });
  });

  it('honours the per-chat opt-out (absent ⇒ on)', () => {
    const ref = 'anthropic:opus-4-8';
    expect(resolveArtefactExpert(ref, {})).not.toBeNull();
    expect(resolveArtefactExpert(ref, { useArtefactExpertModel: true })).not.toBeNull();
    expect(resolveArtefactExpert(ref, { useArtefactExpertModel: false })).toBeNull();
  });

  it('returns null for a malformed ref', () => {
    expect(resolveArtefactExpert('nocolon', {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test resolve-artefact-expert`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the pure helper** — create `apps/user-client/src/lib/resolve-artefact-expert.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { OfferingRef } from '../integrations/types.js';

/**
 * Resolve the artefact-expert offering for a send, or null to use the persona
 * model. `ref` is the global `settings.artefactExpertModel`
 * (`"providerTemplateId:upstreamSlug"`, or null/absent = none); the chat opts
 * out with `useArtefactExpertModel === false` (absent ⇒ the expert is used).
 * A malformed ref resolves to null (no expert), never a throw.
 */
export function resolveArtefactExpert(
  ref: string | null | undefined,
  chat: { useArtefactExpertModel?: boolean },
): OfferingRef | null {
  if (!ref) return null;
  if (chat.useArtefactExpertModel === false) return null;
  const idx = ref.indexOf(':');
  if (idx < 0) return null;
  return { providerId: ref.slice(0, idx), upstreamSlug: ref.slice(idx + 1) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test resolve-artefact-expert`
Expected: PASS.

- [ ] **Step 5: Resolve it at send time** in `send-message.ts`. Add the import near the top (with the other `../lib` imports):

```ts
import { resolveArtefactExpert } from '../lib/resolve-artefact-expert.js';
```

Then in the object returned by the send-context builder (currently line 184–206, the object with `expertBase`/`webInterfacing`), add — next to `expertBase: expert?.base ?? null,`:

```ts
    expertBase: expert?.base ?? null,
    artefactExpert: resolveArtefactExpert(settings.artefactExpertModel ?? null, chat),
```

(`settings` is the row read at line 138; `chat` is read at line 129 — both already in scope.)

- [ ] **Step 6: Extend `StartArgs` and pass it in** — in `stream-manager.store.ts`, add to the `StartArgs` type block (near `substituteVisionModel?` at line 94):

```ts
  /** Pre-resolved artefact-expert offering (from settings + per-chat opt-out),
   *  or null to build artefacts with the persona model. */
  artefactExpert?: OfferingRef | null;
```

Then in the `buildIntegrationContext` call (line 808), add `artefactExpert` to the `ArtefactTarget` object (the one with `chatId`/`personaId`/`personaOffering`):

```ts
    {
      chatId: args.chatId,
      personaId: args.persona.id,
      personaOffering: {
        providerId: args.offering.providerId,
        upstreamSlug: args.offering.upstreamSlug,
      },
      artefactExpert: args.artefactExpert ?? null,
    },
```

- [ ] **Step 7: Gate — the Task 1 call-site break is now resolved**

Run: `pnpm typecheck --force`
Expected: PASS (the stream-manager `ArtefactTarget` now supplies `artefactExpert`).

- [ ] **Step 8: Run the full suite + Biome, then commit**

```bash
pnpm --filter @chatsundere/user-client exec biome check src tests
pnpm --filter @chatsundere/user-client test
git add apps/user-client/src/lib/resolve-artefact-expert.ts apps/user-client/src/data/send-message.ts apps/user-client/src/state/stream-manager.store.ts apps/user-client/tests/unit/resolve-artefact-expert.test.ts
git commit -m "Resolve and thread the artefact expert per send

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 4: The global "Artefact expert" settings slot

**Files:**
- Modify: `apps/user-client/src/routes/app/settings/expert.tsx`
- Test: `apps/user-client/tests/component/settings-expert.test.tsx`

**Interfaces:**
- Consumes: `settings.artefactExpertModel` (existing field), `useUpdateSettings`, `ModelSlotPicker` (all already imported in this file).

- [ ] **Step 1: Write the failing test** — append to `apps/user-client/tests/component/settings-expert.test.tsx` a case asserting the new slot renders. Match the existing render helper in that file (it already mounts `SettingsExpertPage` with a QueryClient); add:

```ts
it('shows the Artefact expert slot', async () => {
  renderExpertPage(); // reuse the file's existing helper
  expect(await screen.findByText('Artefact expert')).toBeInTheDocument();
});
```

If the file has no reusable helper, mirror the setup of the existing first test in the file verbatim.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test settings-expert`
Expected: FAIL — no "Artefact expert" text yet.

- [ ] **Step 3: Add the parsed-ref value + the slot** — in `expert.tsx`, after `const current = parseModelRef(settings?.expertModel);` (line 40) add:

```ts
  const currentArtefact = parseModelRef(settings?.artefactExpertModel);
```

Then add a new `<section>` **after** the "Expert web access" section (after line 139, before the closing `</div>`):

```tsx
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-sm text-paper">Artefact expert</h2>
          <p className="text-[11px] text-paper-soft">
            This model builds your artefacts — interactive pages, widgets, demos — instead of your
            persona&apos;s own model. One global choice, applied across all personas; each chat can
            opt out.
          </p>
          <p className="text-[11px] text-paper-soft">
            Unlike &quot;Ask an expert&quot;, building an artefact sends a brief written by your
            persona, which can include detail drawn from your conversation. Choose a model you&apos;re
            comfortable sharing that with.
          </p>
          <ModelSlotPicker
            label="Artefact expert"
            emptyLabel="None — pick an artefact-expert model"
            filter="all"
            providers={rows}
            configuredTemplateIds={configuredTemplateIds}
            current={currentArtefact}
            onSelect={(sel) =>
              update.mutate({ artefactExpertModel: `${sel.providerTemplateId}:${sel.upstreamSlug}` })
            }
            onClear={() => update.mutate({ artefactExpertModel: null })}
          />
        </section>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test settings-expert`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck --force
pnpm --filter @chatsundere/user-client exec biome check src tests
pnpm --filter @chatsundere/user-client test
git add apps/user-client/src/routes/app/settings/expert.tsx apps/user-client/tests/component/settings-expert.test.tsx
git commit -m "Add the global artefact-expert slot to the expert settings page

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 5: Per-chat cockpit toggle + micro-sublabels

**Files:**
- Modify: `apps/user-client/src/components/chat/CockpitMenu.tsx`
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx`
- Modify: `apps/user-client/src/index.css`
- Test: `apps/user-client/tests/components/chat/CockpitMenu.test.tsx`

**Interfaces:**
- Consumes: `settings.artefactExpertModel`, `useChat`, `useUpdateChat`.
- `CockpitMenu` gains props: `artefactExpertAvailable?: boolean`, `artefactExpertOn?: boolean`, `onArtefactExpertChange?: (on: boolean) => void`.

- [ ] **Step 1: Write the failing test** — append to `apps/user-client/tests/components/chat/CockpitMenu.test.tsx` (the file already renders `CockpitMenu` with a `control`; reuse its pattern):

```ts
it('shows the Artefact expert section with a per-chat sublabel when available', () => {
  render(
    <CockpitMenu
      control={{ mode: 'none' }}
      reasoning={{ kind: 'off' }}
      onReasoningChange={() => {}}
      onClose={() => {}}
      artefactExpertAvailable
      artefactExpertOn
      onArtefactExpertChange={() => {}}
    />,
  );
  expect(screen.getByText('Artefact expert')).toBeInTheDocument();
  expect(screen.getByText('for this chat')).toBeInTheDocument();
});

it('hides the Artefact expert section when unavailable', () => {
  const { container } = render(
    <CockpitMenu
      control={{ mode: 'none' }}
      reasoning={{ kind: 'off' }}
      onReasoningChange={() => {}}
      onClose={() => {}}
    />,
  );
  expect(container.querySelector('[data-section="artefact-expert"]')).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test CockpitMenu`
Expected: FAIL — props and section do not exist.

- [ ] **Step 3: Extend `CockpitMenu` props + render** — in `CockpitMenu.tsx`, add to the `Props` interface (after `onAskExpertChange`):

```ts
  artefactExpertAvailable?: boolean;
  artefactExpertOn?: boolean;
  onArtefactExpertChange?: (on: boolean) => void;
```

Update the early-return guard (line 25) so the menu still renders when only the artefact toggle is available:

```ts
  if (!hasReasoning && !hasDepth && !p.askExpertAvailable && !p.artefactExpertAvailable) return null;
```

Add a `cockpit-menu-sublabel` to the existing **Ask expert** section (so both toggles read their scope), and append the new **Artefact expert** section right after it:

```tsx
      {p.askExpertAvailable ? (
        <div className="cockpit-menu-section" data-section="ask-expert">
          <div className="cockpit-menu-label">Ask expert</div>
          <div className="cockpit-menu-sublabel">for this turn</div>
          <div className="cockpit-menu-chips">
            {chip('On', p.askExpert === true, { onClick: () => p.onAskExpertChange?.(true) })}
            {chip('Off', p.askExpert !== true, { onClick: () => p.onAskExpertChange?.(false) })}
          </div>
        </div>
      ) : null}
      {p.artefactExpertAvailable ? (
        <div className="cockpit-menu-section" data-section="artefact-expert">
          <div className="cockpit-menu-label">Artefact expert</div>
          <div className="cockpit-menu-sublabel">for this chat</div>
          <div className="cockpit-menu-chips">
            {chip('On', p.artefactExpertOn !== false, {
              onClick: () => p.onArtefactExpertChange?.(true),
            })}
            {chip('Off', p.artefactExpertOn === false, {
              onClick: () => p.onArtefactExpertChange?.(false),
            })}
          </div>
        </div>
      ) : null}
```

- [ ] **Step 4: Add the sublabel style** — in `apps/user-client/src/index.css`, immediately after the `.cockpit-menu-label { … }` block (ends line 1670):

```css
.cockpit-menu-sublabel {
  font-size: 0.62rem;
  font-family: var(--font-mono);
  opacity: 0.35;
  margin-top: -0.25rem;
  margin-bottom: 0.4rem;
}
```

- [ ] **Step 5: Run the CockpitMenu test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test CockpitMenu`
Expected: PASS.

- [ ] **Step 6: Wire `Cockpit.tsx`** — add imports (with the other `../../data` imports):

```ts
import { useChat, useUpdateChat } from '../../data/chats.js';
```

In the `Cockpit` component body, near the existing `askExpertAvailable` (line 182), add:

```ts
  const chatQuery = useChat(p.chatId);
  const updateChat = useUpdateChat();
  const artefactExpertAvailable = settings.data?.artefactExpertModel != null;
  const artefactExpertOn = chatQuery.data?.chat.useArtefactExpertModel !== false;
  const onArtefactExpertChange = (on: boolean): void => {
    // Persisted per-chat preference (standing, unlike the transient askExpert):
    // a synced Class-2 chat patch, exactly like a title rename.
    void updateChat.mutateAsync({ id: p.chatId, patch: { useArtefactExpertModel: on } });
    setMenuOpen(false);
  };
```

Pass the three props into `<CockpitMenu …>` (after `onAskExpertChange={onAskExpertChange}`, line 408):

```tsx
              artefactExpertAvailable={artefactExpertAvailable}
              artefactExpertOn={artefactExpertOn}
              onArtefactExpertChange={onArtefactExpertChange}
```

> Edge case (note, no extra code): for a not-yet-persisted lazy chat, `useChat` returns null → `artefactExpertOn` defaults to `true` (on) and the `updateChat` write updates zero rows until the chat is persisted. This is acceptable — an un-persisted chat has no stored opt-out and correctly uses the expert.

- [ ] **Step 7: Gate + commit**

```bash
pnpm typecheck --force
pnpm --filter @chatsundere/user-client exec biome check src tests
pnpm --filter @chatsundere/user-client test
git add apps/user-client/src/components/chat/CockpitMenu.tsx apps/user-client/src/components/chat/Cockpit.tsx apps/user-client/src/index.css apps/user-client/tests/components/chat/CockpitMenu.test.tsx
git commit -m "Add the per-chat artefact-expert toggle with scope sublabels

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 6: Persona-independent inline failure surface

**Files:**
- Modify: `apps/user-client/src/state/current-chat.store.ts`
- Modify: `apps/user-client/src/state/stream-manager.store.ts` (dispatch wrapper + clear-on-send)
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx` (render the note)
- Modify: `apps/user-client/src/index.css`
- Test: `apps/user-client/tests/state/current-chat.store.test.ts`

**Interfaces:**
- Consumes: Task 2's `meta.artefactExpertUnavailable` on the `create_artefact` result.
- Produces: `useCurrentChatStore` state `artefactExpertError: string | null`, `setArtefactExpertError(msg: string | null)`.

- [ ] **Step 1: Write the failing test** — append to `apps/user-client/tests/state/current-chat.store.test.ts`:

```ts
it('holds and clears the artefact-expert error note', () => {
  const s = useCurrentChatStore.getState();
  s.setArtefactExpertError('nope');
  expect(useCurrentChatStore.getState().artefactExpertError).toBe('nope');
  s.setArtefactExpertError(null);
  expect(useCurrentChatStore.getState().artefactExpertError).toBeNull();
  s.setArtefactExpertError('again');
  useCurrentChatStore.getState().reset();
  expect(useCurrentChatStore.getState().artefactExpertError).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test current-chat.store`
Expected: FAIL — field/setter missing.

- [ ] **Step 3: Add the store field** — in `current-chat.store.ts`:

Interface (after `askExpert: boolean;`, line 35):
```ts
  /** Constructive message shown inline when a configured artefact expert was
   *  unreachable for the last artefact attempt; null = no note. Surfaced
   *  independent of the persona's own relay (spec §3.4). */
  artefactExpertError: string | null;
```
Setter in the interface (after `setAskExpert`):
```ts
  setArtefactExpertError: (message: string | null) => void;
```
Add `'setArtefactExpertError'` to the `InitialState` `Omit<…>` union.
Initial value (in `const initial`, after `askExpert: false,`):
```ts
  artefactExpertError: null,
```
Implementation (in the store body, after `setAskExpert`):
```ts
  setArtefactExpertError: (message) => set({ artefactExpertError: message }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test current-chat.store`
Expected: PASS.

- [ ] **Step 5: Set the note from the tool outcome** — in `stream-manager.store.ts`, wrap the `dispatch` callback (line 898) so it raises the note when the artefact tool reports the discriminant:

```ts
    dispatch: async (name, toolArgs, signal, onProgress) => {
      const r = await dispatchTool(activeTools, name, toolArgs, signal, onProgress);
      if (name === 'create_artefact' && r.meta?.artefactExpertUnavailable === true) {
        useCurrentChatStore.getState().setArtefactExpertError(r.error ?? 'Artefact expert unavailable.');
      }
      return r;
    },
```

(`useCurrentChatStore` is already imported here — it is used at lines 814/831.)

- [ ] **Step 6: Clear the note when a fresh send starts** — in `runIntoDraft`, right after the handle is set into the streams map (immediately after the `set((s) => { … m.set(args.chatId, handle); … })` block ending line 737):

```ts
  // A new attempt supersedes any prior artefact-expert failure note.
  useCurrentChatStore.getState().setArtefactExpertError(null);
```

- [ ] **Step 7: Render the note in the cockpit** — in `Cockpit.tsx`, read the state near the other store reads (after line 118):

```ts
  const artefactExpertError = useCurrentChatStore((s) => s.artefactExpertError);
  const setArtefactExpertError = useCurrentChatStore((s) => s.setArtefactExpertError);
```

Render it beside the dictation note — immediately after the dictation-note block (which ends around line 559, after the mic-error branches). Add:

```tsx
      {artefactExpertError ? (
        <div className="cockpit-artefact-note" role="alert">
          <span>{artefactExpertError}</span>
          <button type="button" onClick={() => navigate('/app/settings/expert')}>
            Settings
          </button>
          <button type="button" onClick={() => setArtefactExpertError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
```

(`navigate` is already in scope, line 108.)

- [ ] **Step 8: Add the note style** — in `index.css`, after the `.cockpit-dictation-note button:hover { … }` block (ends line 1655/3355 region — place it right after the dictation-note rules):

```css
.cockpit-artefact-note {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 11px;
  font-family: var(--font-mono);
  color: rgba(232, 230, 245, 0.65);
  padding: 0.2rem 0.4rem;
}
.cockpit-artefact-note button {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--color-aurora-500);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.cockpit-artefact-note button:hover {
  color: color-mix(in oklab, var(--color-aurora-500) 75%, white);
}
```

- [ ] **Step 9: Gate + full suite + commit**

```bash
pnpm typecheck --force
pnpm --filter @chatsundere/user-client exec biome check src tests
pnpm --filter @chatsundere/user-client test
git add apps/user-client/src/state/current-chat.store.ts apps/user-client/src/state/stream-manager.store.ts apps/user-client/src/components/chat/Cockpit.tsx apps/user-client/src/index.css apps/user-client/tests/state/current-chat.store.test.ts
git commit -m "Surface artefact-expert unavailability inline, independent of the persona relay

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Manual verification (Chris, on device)

After Task 6, restart the dev stack (`./dev.sh` — a catalogue/settings change needs a fresh Vite; `pnpm dev` alone omits `--env-file=.env.dev`), then:

1. **No expert set** → cockpit `⋯` shows no Artefact-expert section; artefacts build with the persona model (unchanged).
2. **Set an artefact expert** in My Settings › "Ask an Expert" → the cockpit Artefact-expert section appears, On by default, sublabelled "for this chat"; ask for an artefact → it is built by the expert model.
3. **Toggle Off** in one chat → that chat builds with the persona model; a different chat still uses the expert (per-chat, persisted, survives reload).
4. **Lock the master key** (or remove the expert provider's key) → ask for an artefact → an inline cockpit note shows the constructive next-step with a **Settings** link, *independent of whatever the persona says*; no artefact produced, no silent downgrade.
5. **"Use none"** clears the global expert → the cockpit section disappears again.

---

## Self-review (completed against the spec)

- **Spec §3.1 (global slot):** Task 4. Copy matches the spec's honest privacy note. ✓
- **Spec §3.2 (per-chat toggle + sublabels):** Task 5 (toggle, availability gate, persisted write) + micro-sublabels on both sections. ✓
- **Spec §3.3 (dispatch/resolution):** Task 1 (context seam) + Task 3 (resolve + thread) + Task 2 (`ctx.artefactExpert ?? ctx.personaOffering`, expert's own reasoning). ✓
- **Spec §3.4 (error + inline surface):** Task 2 (discriminant, no fallback) + Task 6 (persona-independent note with settings route + dismiss). ✓
- **Spec §3.5 (YAGNI):** no persona default, no artefact-expert web, `create_artefact` only, no Dexie/strip change. ✓
- **Type consistency:** `artefactExpert: OfferingRef | null` used identically across `types.ts`, `build-context.ts`, `StartArgs`, and `resolveArtefactExpert`'s return; `meta.artefactExpertUnavailable` set in Task 2 and read verbatim in Task 6. ✓
- **Placeholder scan:** none. ✓
