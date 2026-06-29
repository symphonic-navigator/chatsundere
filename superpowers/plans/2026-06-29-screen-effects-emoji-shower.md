# Screen Effects (Emoji Shower) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a first-class Integrations subsystem and re-deliver the beloved "emoji shower" as its first integration — a persona emits `[sfx:emoji-shower 🔥🦊💖]`, which renders inline as soft-glowing text and plays a brief full-screen shower, replayable during read-aloud.

**Architecture:** A shared, pure subsystem in `packages/llm-unified` (tag grammar, registry, the emoji-shower integration, the prompt segment) feeds a client rendering/effects layer in `apps/user-client` (display weiche on the existing TEAL streaming detector, a glow render path reusing TEAL's PUA-sentinel mechanism, a global overlay, and two trigger sources). The canonical stored message text keeps the literal tag; display is a pure render transform; the effect is a side-effect derivable from that text.

**Tech Stack:** TypeScript (strict), Bun test (packages), Vitest + Testing Library (user-client), React 18, Zustand, Dexie, Tailwind v4.

**Spec:** `superpowers/specs/2026-06-29-screen-effects-emoji-shower-design.md` — read it first.

## Global Constraints

- **British English** in every artefact — code, comments, copy, tests, commit messages. No mixing.
- **TypeScript strict**: `noUncheckedIndexedAccess` is on. No `any` without an inline justification. No non-null `!` (Biome bans it — the pre-commit gate runs Biome).
- **Licence headers**: `packages/llm-unified` files → `// SPDX-License-Identifier: LGPL-3.0-only`. `apps/user-client` files → `// SPDX-License-Identifier: AGPL-3.0-only`.
- **Gate before every commit** (the pre-commit hook runs Biome only, *not* tsc): run `pnpm typecheck --force` (Turbo caches it — `--force` is mandatory on type/schema-touching tasks) and `pnpm biome check` yourself. Backend tests `bun test`; frontend tests `vitest run`.
- **Package-public functions** carry at least a one-line JSDoc.
- **Canonical-text rule** (spec §4.1): the stored assistant text keeps the literal `[sfx:…]` tag; never persist the transformed display.
- **Effect triggers** fire only from the two sources (live-stream, read-aloud). A bare re-render/mount of a persisted message does **not** auto-play the overlay (resolves a spec §4.3/§10 ambiguity — the inline glow is the persistent artefact). See Task D2/D3.
- **No backend, no crypto, no auth** touched → no Larissa gate. A **Laura pre-squash pass** applies before the final squash (Task E).

---

## Task 0: Pre-flight — re-verify docking points (no code)

This plan was written against `origin/master` while a parallel session worked `feat/chatsundere-transfer`. Execution is deferred until that work merges, so the codebase will have drifted. **Confirm these before writing any code; adjust paths/line numbers/version numbers inline as you go.**

- [ ] **Dexie version ownership.** Open `apps/user-client/src/boot/client-data-db.ts`, find the highest `.version(N)` call. The plan assumes the new version is **v31** (latest seen: v30). If the merged tree already has v31+ (the transfer work may have bumped it), use the next free integer and update Task B1 accordingly. Memory: parallel features must not both claim the same Dexie version.
- [ ] **TEAL render layer intact.** Confirm these still exist and match the shapes the plan cites: `apps/user-client/src/lib/teal/teal-streaming.ts` (`transformTealStream`, `INLINE_RX`, the `ch === '['` branch), `…/preprocess-teal.ts` (`preprocessTeal`, `TEAL_MARK_START/END`), `…/rehype-teal.ts` (`transformText`, `resolveTealWrap` use), `…/teal-render-map.ts`, and `apps/user-client/src/lib/markdown/preprocess-for-display.ts` (`preprocessForDisplay`).
- [ ] **Composition shape.** Confirm `packages/llm-unified/src/composition.ts` still has `BuildPromptInputs`, `SegmentSpec`, `SEGMENTS`, `buildPrompt`, and that the `buildPrompt` call-site (the stream engine) can pass a new input.
- [ ] **Voice selectors.** Confirm `apps/user-client/src/lib/voice/voice-machine.ts` exports `selectCurrentSegmentId` / `selectCurrentMessageId`, that `use-voice-playback.ts` exposes `currentSegmentId` / `currentMessageId`, and that `segmentation.ts`'s `SpeechSegment` still carries `charRange: [number, number]` and `blockIndex`.
- [ ] **Settings + tile.** Confirm `SettingsRow` in `client-data-db.ts`, `useSettings`/`useUpdateSettings` in `data/settings.ts`, the spectrum toggle pattern in `components/voice/VoiceSection.tsx`, and the Voice tile in `routes/app/settings.tsx` (`meta="read-aloud & dictation"`).

Write a one-paragraph note in the PR/commit description recording anything that drifted. No commit for this task.

---

## Phase A — Shared subsystem (`packages/llm-unified`)

### Task A1: Integration tag grammar & parser

**Files:**
- Create: `packages/llm-unified/src/integrations/types.ts`
- Create: `packages/llm-unified/src/integrations/parse.ts`
- Test: `packages/llm-unified/src/integrations/parse.test.ts`

**Interfaces:**
- Produces: `interface EffectTrigger { kind: string }`; `interface IntegrationResult { display: string; effect?: EffectTrigger }`; `interface Integration { prefix: string; handle(command: string, rawArgs: string): IntegrationResult | null; systemPrompt: string }`; `interface ParsedIntegrationTag { prefix: string; command: string; rawArgs: string; raw: string; index: number }`; `function parseIntegrationTag(content: string): Omit<ParsedIntegrationTag, 'raw' | 'index'> | null`; `function findIntegrationTags(text: string): ParsedIntegrationTag[]`; `const INTEGRATION_TAG_RX: RegExp` (sticky-free, global for find); `const MAX_INTEGRATION_TAG_LENGTH = 160`.

**Design notes:**
- Grammar `[<prefix>:<command> <rawArgs>]`. `prefix` = `[a-z][a-z0-9-]*`, `command` = `[a-z][a-z0-9-]*`, then **one** space, then `rawArgs` = everything up to the next `]` (no nested `]`). `rawArgs` is the raw remainder — **not** tokenised (spec decision A).
- The detection regex must tolerate emoji and `:` (TEAL's `INLINE_RX` deliberately does not — that is why integration tags need their own pattern): `` /\[([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)[ ]([^\]]*)\]/g ``. Cap overall match length at `MAX_INTEGRATION_TAG_LENGTH` in `findIntegrationTags` (skip longer — a stray `[` … `]` across a huge span is not a tag).
- `parseIntegrationTag(content)` parses bracket *content* (without the `[ ]`), used by the streaming detector which already isolates the bracket. `findIntegrationTags(text)` scans full text and returns each occurrence with its `index` (start of `[`) and `raw` (full matched `[...]`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/llm-unified/src/integrations/parse.test.ts
import { describe, expect, it } from 'bun:test';
import { findIntegrationTags, parseIntegrationTag } from './parse.js';

describe('parseIntegrationTag', () => {
  it('extracts prefix, command and raw args verbatim', () => {
    expect(parseIntegrationTag('sfx:emoji-shower 🔥🦊💖')).toEqual({
      prefix: 'sfx',
      command: 'emoji-shower',
      rawArgs: '🔥🦊💖',
    });
  });

  it('does not tokenise rawArgs (keeps spaces verbatim)', () => {
    expect(parseIntegrationTag('sfx:emoji-shower 🔥 🦊 💖')?.rawArgs).toBe('🔥 🦊 💖');
  });

  it('returns null when there is no prefix:command head', () => {
    expect(parseIntegrationTag('laugh')).toBeNull();
    expect(parseIntegrationTag('sfx:emoji-shower')).toBeNull(); // no space + args
  });
});

describe('findIntegrationTags', () => {
  it('locates each tag with its start index and raw match', () => {
    const tags = findIntegrationTags('hey [sfx:emoji-shower 🔥] there [sfx:emoji-shower 💖]');
    expect(tags.map((t) => t.index)).toEqual([4, 31]);
    expect(tags[0]?.raw).toBe('[sfx:emoji-shower 🔥]');
    expect(tags[1]?.command).toBe('emoji-shower');
  });

  it('ignores TEAL-style and ordinary brackets', () => {
    expect(findIntegrationTags('a [laugh] b [link](url) c')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/integrations/parse.test.ts`
Expected: FAIL — module `./parse.js` not found.

- [ ] **Step 3: Write `types.ts` then `parse.ts`**

```ts
// packages/llm-unified/src/integrations/types.ts
// SPDX-License-Identifier: LGPL-3.0-only

/** A side-effect an integration asks the client to play. `kind` selects the renderer. */
export interface EffectTrigger {
  kind: string;
}

/** What an integration returns for a matched tag. */
export interface IntegrationResult {
  /** Inline text to render (soft-glowing). '' renders nothing inline. */
  display: string;
  /** Optional side-effect dispatched to the overlay; absent = display only. */
  effect?: EffectTrigger;
}

/** A first-party integration: a registered tag prefix plus a pure handler. */
export interface Integration {
  /** Registered namespace, e.g. 'sfx'. Unique across integrations. */
  readonly prefix: string;
  /** Resolve a matched tag. Returns null for an unknown command (tag left literal). */
  handle(command: string, rawArgs: string): IntegrationResult | null;
  /** Prompt fragment, injected by the composition layer only when the feature is enabled. */
  readonly systemPrompt: string;
}

/** A located integration tag occurrence in some text. */
export interface ParsedIntegrationTag {
  prefix: string;
  command: string;
  rawArgs: string;
  /** The full matched text including brackets, e.g. '[sfx:emoji-shower 🔥]'. */
  raw: string;
  /** Index of the opening '[' in the source text. */
  index: number;
}
```

```ts
// packages/llm-unified/src/integrations/parse.ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { ParsedIntegrationTag } from './types.js';

/** Longest tag we accept; guards against a stray '[' … ']' spanning a huge range. */
export const MAX_INTEGRATION_TAG_LENGTH = 160;

const HEAD = '[a-z][a-z0-9-]*';
/** Global matcher for full `[prefix:command args]` occurrences. */
export const INTEGRATION_TAG_RX = new RegExp(`\\[(${HEAD}):(${HEAD}) ([^\\]]*)\\]`, 'g');
/** Anchored matcher for bracket *content* (no surrounding brackets). */
const CONTENT_RX = new RegExp(`^(${HEAD}):(${HEAD}) ([^\\]]*)$`);

/** Parse bracket content `prefix:command args` (no brackets). Null if it is not an integration tag. */
export function parseIntegrationTag(
  content: string,
): Pick<ParsedIntegrationTag, 'prefix' | 'command' | 'rawArgs'> | null {
  const m = CONTENT_RX.exec(content);
  if (m === null) return null;
  const [, prefix, command, rawArgs] = m;
  if (prefix === undefined || command === undefined || rawArgs === undefined) return null;
  if (rawArgs.length === 0) return null;
  return { prefix, command, rawArgs };
}

/** Locate every integration tag in `text`, in order, with positions. */
export function findIntegrationTags(text: string): ParsedIntegrationTag[] {
  const out: ParsedIntegrationTag[] = [];
  INTEGRATION_TAG_RX.lastIndex = 0;
  for (let m = INTEGRATION_TAG_RX.exec(text); m !== null; m = INTEGRATION_TAG_RX.exec(text)) {
    const raw = m[0];
    const prefix = m[1];
    const command = m[2];
    const rawArgs = m[3];
    if (prefix === undefined || command === undefined || rawArgs === undefined) continue;
    if (raw.length > MAX_INTEGRATION_TAG_LENGTH || rawArgs.length === 0) continue;
    out.push({ prefix, command, rawArgs, raw, index: m.index });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/integrations/parse.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/integrations/types.ts packages/llm-unified/src/integrations/parse.ts packages/llm-unified/src/integrations/parse.test.ts
git commit -m "Add integration tag grammar and parser"
```

---

### Task A2: emoji-shower integration & registry

**Files:**
- Create: `packages/llm-unified/src/integrations/screen-effects/emoji-shower.ts`
- Create: `packages/llm-unified/src/integrations/registry.ts`
- Create: `packages/llm-unified/src/integrations/index.ts`
- Test: `packages/llm-unified/src/integrations/screen-effects/emoji-shower.test.ts`

**Interfaces:**
- Consumes: `Integration`, `IntegrationResult`, `EffectTrigger` (A1).
- Produces: `interface EmojiShowerEffect extends EffectTrigger { kind: 'emoji-shower'; emoji: string[] }`; `const emojiShowerIntegration: Integration`; `function getIntegration(prefix: string): Integration | null`; `const INTEGRATION_PREFIXES: ReadonlySet<string>`; `const MAX_SHOWER_EMOJI = 5`.

**Design notes:**
- `handle('emoji-shower', rawArgs)`: segment `rawArgs` into graphemes via `Intl.Segmenter` (ZWJ/skin-tone safe), keep only emoji graphemes (filter via `/\p{Extended_Pictographic}/u`), drop whitespace. 0 emoji → return `null` (tag left literal). 1–5 → keep; >5 → first 5.
- `display = '🚿' + kept.join('') + '🚿'` (shower-heads are indicators only, spec §8).
- `effect = { kind: 'emoji-shower', emoji: kept }` — overlay rains only `kept`, not the shower-heads.
- Unknown command (not `emoji-shower`) → `null`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/llm-unified/src/integrations/screen-effects/emoji-shower.test.ts
import { describe, expect, it } from 'bun:test';
import { emojiShowerIntegration } from './emoji-shower.js';
import { getIntegration } from '../registry.js';

describe('emojiShowerIntegration', () => {
  it('wraps display in shower-heads and rains only the chosen emoji', () => {
    const r = emojiShowerIntegration.handle('emoji-shower', '🔥🦊💖');
    expect(r?.display).toBe('🚿🔥🦊💖🚿');
    expect(r?.effect).toEqual({ kind: 'emoji-shower', emoji: ['🔥', '🦊', '💖'] });
  });

  it('keeps ZWJ / skin-tone emoji as single graphemes', () => {
    const r = emojiShowerIntegration.handle('emoji-shower', '👍🏽👩‍🚀');
    expect(r?.effect).toEqual({ kind: 'emoji-shower', emoji: ['👍🏽', '👩‍🚀'] });
  });

  it('caps at five emoji', () => {
    const r = emojiShowerIntegration.handle('emoji-shower', '🔥🦊💖✨🎉🌟💫');
    expect((r?.effect as { emoji: string[] }).emoji).toHaveLength(5);
  });

  it('returns null when there are no emoji (tag stays literal)', () => {
    expect(emojiShowerIntegration.handle('emoji-shower', 'hello world')).toBeNull();
  });

  it('returns null for an unknown command', () => {
    expect(emojiShowerIntegration.handle('confetti', '🎉')).toBeNull();
  });
});

describe('registry', () => {
  it('resolves the sfx prefix to the screen-effects integration', () => {
    expect(getIntegration('sfx')).toBe(emojiShowerIntegration);
    expect(getIntegration('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/integrations/screen-effects/emoji-shower.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `emoji-shower.ts`, `registry.ts`, `index.ts`**

```ts
// packages/llm-unified/src/integrations/screen-effects/emoji-shower.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { SCREEN_EFFECTS_PROMPT } from './prompt.js';
import type { EffectTrigger, Integration, IntegrationResult } from '../types.js';

/** Overlay payload for the emoji shower. */
export interface EmojiShowerEffect extends EffectTrigger {
  kind: 'emoji-shower';
  emoji: string[];
}

export const MAX_SHOWER_EMOJI = 5;

const EMOJI_RX = /\p{Extended_Pictographic}/u;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Split into emoji graphemes, dropping whitespace and non-emoji, capped at MAX_SHOWER_EMOJI. */
function extractEmoji(rawArgs: string): string[] {
  const out: string[] = [];
  for (const { segment } of segmenter.segment(rawArgs)) {
    if (EMOJI_RX.test(segment)) out.push(segment);
    if (out.length === MAX_SHOWER_EMOJI) break;
  }
  return out;
}

/** Screen-effects integration (prefix `sfx`). First inhabitant of the Integrations subsystem. */
export const emojiShowerIntegration: Integration = {
  prefix: 'sfx',
  systemPrompt: SCREEN_EFFECTS_PROMPT,
  handle(command: string, rawArgs: string): IntegrationResult | null {
    if (command !== 'emoji-shower') return null;
    const emoji = extractEmoji(rawArgs);
    if (emoji.length === 0) return null;
    const effect: EmojiShowerEffect = { kind: 'emoji-shower', emoji };
    return { display: `🚿${emoji.join('')}🚿`, effect };
  },
};
```

```ts
// packages/llm-unified/src/integrations/registry.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { emojiShowerIntegration } from './screen-effects/emoji-shower.js';
import type { Integration } from './types.js';

const REGISTRY: ReadonlyMap<string, Integration> = new Map([
  [emojiShowerIntegration.prefix, emojiShowerIntegration],
]);

/** Set of registered prefixes — the streaming detector's weiche checks membership cheaply. */
export const INTEGRATION_PREFIXES: ReadonlySet<string> = new Set(REGISTRY.keys());

/** Resolve a prefix to its integration, or null when unregistered. */
export function getIntegration(prefix: string): Integration | null {
  return REGISTRY.get(prefix) ?? null;
}
```

```ts
// packages/llm-unified/src/integrations/index.ts
// SPDX-License-Identifier: LGPL-3.0-only
export * from './types.js';
export * from './parse.js';
export * from './registry.js';
export { emojiShowerIntegration, MAX_SHOWER_EMOJI } from './screen-effects/emoji-shower.js';
export type { EmojiShowerEffect } from './screen-effects/emoji-shower.js';
export { SCREEN_EFFECTS_PROMPT } from './screen-effects/prompt.js';
```

Note: `prompt.js` is created in Task A3. To keep this task green on its own, create a temporary stub `export const SCREEN_EFFECTS_PROMPT = '';` in `screen-effects/prompt.ts` now and fill it in A3. (Ordering by import dependency — a stub avoids a broken import while A2's tests run.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/integrations/screen-effects/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/integrations/
git commit -m "Add emoji-shower integration and prefix registry"
```

---

### Task A3: Screen-effects prompt segment & composition wiring

**Files:**
- Create: `packages/llm-unified/src/integrations/screen-effects/prompt.ts` (replace the A2 stub)
- Modify: `packages/llm-unified/src/composition.ts`
- Modify: `packages/llm-unified/src/composition.test.ts`
- Export: ensure `packages/llm-unified/src/index.ts` re-exports `./integrations/index.js` (check the package's public barrel; add `export * from './integrations/index.js';` if absent).

**Interfaces:**
- Consumes: `BuildPromptInputs`, `SegmentSpec`, `buildPrompt` (composition.ts).
- Produces: `const SCREEN_EFFECTS_PROMPT: string`; `BuildPromptInputs.screenEffectsEnabled: boolean`; a new Band-1 segment id `'screenEffects'`.

**Design notes:**
- Segment is Band 1, jobs `CHAT_AND_GREETING` (wherever the model writes prose to the user — a celebratory greeting may shower too). Gated: `resolve: (i) => (i.screenEffectsEnabled ? SCREEN_EFFECTS_PROMPT : '')`.
- Place it **after `teal` (order 3) and before `modelInstructions`**. Renumber to keep the load-bearing `roleplay → persona` adjacency: `teal`=3, **`screenEffects`=4**, `modelInstructions`=5, `roleplay`=6, `persona`=7. (Only these orders change; bands are unchanged.)

- [ ] **Step 1: Write the failing test** (append to `composition.test.ts`)

```ts
import { describe, expect, it } from 'bun:test';
import { buildPrompt } from './composition.js';
import { SCREEN_EFFECTS_PROMPT } from './integrations/index.js';

const base = {
  tonalityEnabled: false, nsfwEnabled: false, globalInstructions: '',
  personaInstructions: 'You are Fable.', aboutMe: '', projectInstructions: '',
  memoryContext: '', toolsInstruction: '', modelInstructions: '',
  screenEffectsEnabled: false,
};

describe('screen-effects prompt segment', () => {
  it('is injected for chat when enabled', () => {
    const out = buildPrompt({ ...base, screenEffectsEnabled: true }, 'chat');
    expect(out).toContain(SCREEN_EFFECTS_PROMPT);
  });

  it('is omitted when disabled (gated on the toggle)', () => {
    const out = buildPrompt({ ...base, screenEffectsEnabled: false }, 'chat');
    expect(out).not.toContain('emoji-shower');
  });

  it('is omitted for title and memory jobs even when enabled', () => {
    expect(buildPrompt({ ...base, screenEffectsEnabled: true }, 'title')).not.toContain('emoji-shower');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/composition.test.ts`
Expected: FAIL — `screenEffectsEnabled` not on inputs / segment missing.

- [ ] **Step 3: Write the prompt and wire the segment**

```ts
// packages/llm-unified/src/integrations/screen-effects/prompt.ts
// SPDX-License-Identifier: LGPL-3.0-only

/** Band-1 screen-effects segment. Gated on the global toggle by the composition layer. */
export const SCREEN_EFFECTS_PROMPT = `## Screen effects

You may emit a small, silent visual flourish inline using:

  [sfx:emoji-shower 🔥🦊💖]

- \`emoji-shower\` rains 1–5 emoji gently down the screen. Pass between one and five emoji, no spaces needed.
- Use it **sparingly** — at most once per reply, and only when the moment genuinely carries it: a celebration, a flirt, a punchline.
- The effect is **silent and carries no meaning**. Your words still do the talking; never rely on it to say something.`;
```

In `composition.ts`:

```ts
// add to imports
import { SCREEN_EFFECTS_PROMPT } from './integrations/index.js';

// add to BuildPromptInputs (after modelInstructions field)
  /** Global toggle — `screenEffectsEnabled`. Injects the screen-effects guidance. */
  screenEffectsEnabled: boolean;

// add 'screenEffects' to the SegmentId union (next to 'modelInstructions')
  | 'screenEffects'

// in SEGMENTS: insert after the `teal` entry and renumber the three that follow
  { id: 'teal', band: 1, order: 3, jobs: CHAT_AND_GREETING, resolve: () => TEAL_EXPRESSION_PROMPT },
  {
    id: 'screenEffects',
    band: 1,
    order: 4,
    jobs: CHAT_AND_GREETING,
    resolve: (i) => (i.screenEffectsEnabled ? SCREEN_EFFECTS_PROMPT : ''),
  },
  { id: 'modelInstructions', band: 1, order: 5, jobs: CHAT_AND_GREETING, resolve: (i) => i.modelInstructions },
  // roleplay → order 6, persona → order 7 (renumber the existing entries)
```

Update the `buildPrompt` call-site (the stream engine) to pass `screenEffectsEnabled` resolved from `SettingsRow.screenEffectsEnabled` — done in Task D5 (it also needs the settings row at that layer). For now, fix any other `BuildPromptInputs` constructors the typechecker flags by adding `screenEffectsEnabled: false` (background jobs that pass the full inputs object). Run `pnpm typecheck --force` and resolve each error.

- [ ] **Step 4: Run tests + typecheck**

Run: `cd packages/llm-unified && bun test` then from repo root `pnpm typecheck --force`
Expected: composition tests PASS; typecheck PASS (after filling in any new required `screenEffectsEnabled` fields).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/
git commit -m "Add gated screen-effects prompt segment to composition"
```

---

## Phase B — Settings field & UI (`apps/user-client`)

### Task B1: `screenEffectsEnabled` on SettingsRow + Dexie version

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (interface, new `.version(31)`, seed default)
- Modify: any test asserting `db.verno` (sweep — see note)
- Test: `apps/user-client/tests/...` (a focused Dexie test, mirror an existing settings/db test location)

**Design notes:**
- Add `screenEffectsEnabled: boolean;` to `SettingsRow` (near `spectrumEnabled`).
- Add `screenEffectsEnabled: true` to the seed object (id=1).
- Add a new Dexie version (assume **31**; confirm in Task 0). The settings store stays the same schema string (no new index — it is a field on the singleton), so the version bump is for the **upgrade backfill**:

```ts
db.version(31)
  .stores({ /* repeat the v30 stores object verbatim — Dexie requires the full schema */ })
  .upgrade(async (tx) => {
    await tx.table('settings').toCollection().modify((row) => {
      if (typeof (row as { screenEffectsEnabled?: boolean }).screenEffectsEnabled !== 'boolean') {
        (row as { screenEffectsEnabled: boolean }).screenEffectsEnabled = true;
      }
    });
  });
```

- **Verno sweep** (memory: a bump breaks hard-coded `expect(db.verno).toBe(N)` assertions). Run `rg "verno).toBe\(|\.version\(" apps/user-client` and bump every literal from 30→31 (or whatever Task 0 fixed it to). There is no central constant; do them all in this task or the gate fails.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/db/screen-effects-default.test.ts (mirror an existing db test's harness/imports)
import { describe, expect, it } from 'vitest';
import { getClientDataDb } from '../../src/boot/client-data-db.js';

describe('screenEffectsEnabled default', () => {
  it('seeds true for a fresh settings row', async () => {
    const db = getClientDataDb();
    const row = await db.settings.get(1);
    expect(row?.screenEffectsEnabled).toBe(true);
  });
});
```

(If the existing db tests use a different fresh-db harness, follow that pattern exactly — the point is: a freshly seeded settings row has `screenEffectsEnabled === true`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/user-client && vitest run tests/db/screen-effects-default.test.ts`
Expected: FAIL — property missing / typecheck error.

- [ ] **Step 3: Implement the field, version, seed, and verno sweep**

Add the interface field, the `.version(31)` block above, the seed default, and bump every `verno` literal found by the `rg` sweep.

- [ ] **Step 4: Run test + full db tests + typecheck**

Run: `cd apps/user-client && vitest run tests/db/ && cd ../.. && pnpm typecheck --force`
Expected: PASS, including the previously-failing verno assertions now at the new number.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/tests/
git commit -m "Add screenEffectsEnabled setting with Dexie backfill"
```

---

### Task B2: Voice settings toggle + tile meta

**Files:**
- Modify: `apps/user-client/src/components/voice/VoiceSection.tsx` (append a toggle at the bottom)
- Modify: `apps/user-client/src/routes/app/settings.tsx` (Voice tile meta → add "FX")
- Test: `apps/user-client/tests/component/screen-effects-toggle.test.tsx`

**Design notes:**
- Mirror the spectrum toggle exactly (the agent-extracted pattern): a `<button aria-pressed>` calling `update.mutate({ screenEffectsEnabled: !screenEffectsEnabled })`, plus a `<p>` description. Read `screenEffectsEnabled` from `useSettings().data` (the section already reads settings; reuse the same `update` mutation it already has).
- Copy (British English): button "Show screen effects"; description "Brief emoji showers your Circle can sprinkle into a reply — a celebration, a flirt, a punchline."
- Tile meta in `settings.tsx`: `meta="read-aloud, dictation & FX"`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/component/screen-effects-toggle.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VoiceSection } from '../../src/components/voice/VoiceSection.js';
// Reuse the test harness/providers an existing VoiceSection or settings test uses
// (QueryClientProvider + seeded settings). Mirror that file's setup verbatim.

describe('VoiceSection screen-effects toggle', () => {
  it('renders a pressable screen-effects toggle', async () => {
    render(<VoiceSection />); // wrap in the same providers the sibling test uses
    const btn = await screen.findByRole('button', { name: /screen effects/i });
    expect(btn).toHaveAttribute('aria-pressed');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/user-client && vitest run tests/component/screen-effects-toggle.test.tsx`
Expected: FAIL — no such button.

- [ ] **Step 3: Implement the toggle and tile meta**

Append after the last block in `VoiceSection.tsx` (the agent located the bottom ~line 393), reading `screenEffectsEnabled` from the same settings data the section already holds:

```tsx
{/* Screen effects */}
<div className="mb-3">
  <button
    type="button"
    aria-pressed={screenEffectsEnabled}
    onClick={() => update.mutate({ screenEffectsEnabled: !screenEffectsEnabled })}
    className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
      screenEffectsEnabled
        ? 'border-paper bg-white/5 text-paper'
        : 'border-white/5 text-paper-soft hover:border-paper-soft/50'
    }`}
  >
    Show screen effects
  </button>
  <p className="mt-1.5 text-[11px] text-paper-soft">
    Brief emoji showers your Circle can sprinkle into a reply — a celebration, a flirt, a punchline.
  </p>
</div>
```

Derive `screenEffectsEnabled` next to the existing `spectrumEnabled` read (e.g. `const screenEffectsEnabled = settings?.screenEffectsEnabled ?? true;`). In `settings.tsx`, change the Voice tile `meta` to `"read-aloud, dictation & FX"`.

- [ ] **Step 4: Run test + typecheck + biome**

Run: `cd apps/user-client && vitest run tests/component/screen-effects-toggle.test.tsx && cd ../.. && pnpm typecheck --force && pnpm biome check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/voice/VoiceSection.tsx apps/user-client/src/routes/app/settings.tsx apps/user-client/tests/
git commit -m "Surface screen-effects toggle in Voice settings"
```

---

## Phase C — Display rendering (`apps/user-client`)

### Task C1: Integration display preprocess + rehype glow + CSS

**Files:**
- Create: `apps/user-client/src/lib/integrations/preprocess-integrations.ts`
- Create: `apps/user-client/src/lib/integrations/display.ts` (the `sfx-glow` class resolver)
- Modify: `apps/user-client/src/lib/markdown/preprocess-for-display.ts` (compose the integration pass)
- Modify: `apps/user-client/src/lib/teal/rehype-teal.ts` (resolve the glow marker too)
- Modify: the message text CSS file (where `.teal-whisper` etc. live — find with `rg "teal-whisper" apps/user-client/src --type css`) to add `.sfx-glow`
- Test: `apps/user-client/src/lib/integrations/preprocess-integrations.test.ts`

**Design notes:**
- `preprocessIntegrations(src)`: mask code regions (`maskCodeRegions` from `../markdown/code-mask.js`, as `preprocessTeal` does), replace each integration tag with `TEAL_MARK_START + 'sfx-glow' + TEAL_MARK_END + display + TEAL_MARK_START + '/sfx-glow' + TEAL_MARK_END` (reusing TEAL's PUA sentinels so the markers survive Markdown). Unknown command / null result → leave the tag literal. Restore code regions.
- Compose into `preprocessForDisplay`: `preprocessMath(preprocessTeal(preprocessIntegrations(text)))` — integrations first so the bracket-free display text flows cleanly through TEAL and math.
- `rehype-teal.ts`: the marker regex already captures `sfx-glow` (it is `[a-z-]+`), but `resolveTealWrap('sfx-glow')` returns null and the marker would vanish. Fix by resolving the class via TEAL **or** the integration display resolver:

```ts
// display.ts
// SPDX-License-Identifier: AGPL-3.0-only
/** Marker names the integration layer uses for soft-glow display spans. */
const GLOW_CLASS = 'sfx-glow';
export function resolveDisplayGlow(name: string): string | null {
  return name === GLOW_CLASS ? GLOW_CLASS : null;
}
```

In `rehype-teal.ts`, change the resolution so a non-TEAL but known display class still produces a wrap:

```ts
import { resolveDisplayGlow } from '../integrations/display.js';
// ... inside transformText, replace the resolveTealWrap-only block:
const tealAction = resolveTealWrap(name);
const className =
  tealAction !== null && tealAction.kind === 'wrap' ? tealAction.className : resolveDisplayGlow(name);
if (className === null) continue; // unknown or silent: marker vanishes
if (closing) {
  const idx = active.lastIndexOf(className);
  if (idx >= 0) active.splice(idx, 1);
} else {
  active.push(className);
}
```

- CSS `.sfx-glow` (mirror the spectrum glow aesthetic; the mindspace accent is already on `--mindspace-accent`):

```css
.sfx-glow {
  color: var(--mindspace-accent, #8c76d7);
  text-shadow: 0 0 6px color-mix(in srgb, var(--mindspace-accent, #8c76d7) 60%, transparent);
}
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/src/lib/integrations/preprocess-integrations.test.ts
import { describe, expect, it } from 'vitest';
import { preprocessIntegrations } from './preprocess-integrations.js';
import { TEAL_MARK_END, TEAL_MARK_START } from '../teal/preprocess-teal.js';

describe('preprocessIntegrations', () => {
  it('replaces a shower tag with marked glow display', () => {
    const out = preprocessIntegrations('yay [sfx:emoji-shower 🔥🦊💖]');
    expect(out).toBe(`yay ${TEAL_MARK_START}sfx-glow${TEAL_MARK_END}🚿🔥🦊💖🚿${TEAL_MARK_START}/sfx-glow${TEAL_MARK_END}`);
  });

  it('leaves an unknown command literal', () => {
    expect(preprocessIntegrations('[sfx:confetti 🎉]')).toBe('[sfx:confetti 🎉]');
  });

  it('does not touch tags inside code spans', () => {
    expect(preprocessIntegrations('`[sfx:emoji-shower 🔥]`')).toBe('`[sfx:emoji-shower 🔥]`');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/user-client && vitest run src/lib/integrations/preprocess-integrations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement preprocess, display resolver, compose, rehype, CSS**

```ts
// apps/user-client/src/lib/integrations/preprocess-integrations.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { getIntegration, INTEGRATION_TAG_RX } from '@chatsundere/llm-unified';
import { maskCodeRegions } from '../markdown/code-mask.js';
import { TEAL_MARK_END, TEAL_MARK_START } from '../teal/preprocess-teal.js';

/** Replace each known integration tag with a soft-glow display span (PUA-marked); unknown stays literal. */
export function preprocessIntegrations(src: string): string {
  const { masked, restore } = maskCodeRegions(src);
  const out = masked.replace(INTEGRATION_TAG_RX, (raw, prefix: string, command: string, rawArgs: string) => {
    const integration = getIntegration(prefix);
    const result = integration?.handle(command, rawArgs) ?? null;
    if (result === null) return raw;
    return `${TEAL_MARK_START}sfx-glow${TEAL_MARK_END}${result.display}${TEAL_MARK_START}/sfx-glow${TEAL_MARK_END}`;
  });
  return restore(out);
}
```

(`INTEGRATION_TAG_RX` is global; `String.replace` resets its `lastIndex`, so it is safe here.) Then add `display.ts`, edit `preprocess-for-display.ts`, edit `rehype-teal.ts`, add `.sfx-glow` CSS.

- [ ] **Step 4: Run tests + the existing TEAL/markdown tests (regression) + typecheck**

Run: `cd apps/user-client && vitest run src/lib/integrations/ src/lib/teal/ src/lib/markdown/ && cd ../.. && pnpm typecheck --force`
Expected: PASS — and the existing TEAL + voice-anchor tests still green (verify `rehypeVoiceAnchor` pairing is unaffected; if a voice-anchor test fails, the integration markers shifted paragraph structure — keep the integration replacement marker-symmetric like TEAL wraps, which it is).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/integrations/ apps/user-client/src/lib/markdown/preprocess-for-display.ts apps/user-client/src/lib/teal/rehype-teal.ts apps/user-client/src/**/*.css
git commit -m "Render integration tags as soft-glow display in finalised messages"
```

---

### Task C2: Streaming-path display weiche

**Files:**
- Modify: `apps/user-client/src/lib/teal/teal-streaming.ts`
- Test: `apps/user-client/src/lib/teal/teal-streaming.test.ts` (append; create if absent)

**Design notes:**
- In the `ch === '['` branch, **before** trying `INLINE_RX`, try an integration match. Integration tags carry `:` and emoji, which `INLINE_RX` rejects, so they never collide with TEAL.
- Add `const INTEGRATION_RX = /^\[([a-z][a-z0-9-]*):([a-z][a-z0-9-]*) ([^\]]*)\]/;` and a partial matcher `const INTEGRATION_PARTIAL_RX = /^\[[a-z][a-z0-9-]*(:([a-z0-9-]*( [^\]]*)?)?)?$/;` and a larger candidate cap `const MAX_INTEGRATION_CANDIDATE = 160;` (emoji blow past TEAL's 38).
- On a complete integration match: `const result = getIntegration(prefix)?.handle(command, rawArgs)`. If non-null, `append(result.display)` **with** the glow class — i.e. push it as its own span carrying `'sfx-glow'`. Easiest within the existing `append`/`active` model: temporarily push `'sfx-glow'` to `active`, `append(display)`, then pop it, so the display becomes a `stream-tok sfx-glow` span and following text is unstyled. If null, `append(raw)` (literal).
- Partial handling: if no complete integration or TEAL match but the rest looks like a growing integration tag (`INTEGRATION_PARTIAL_RX`, `rest.length <= MAX_INTEGRATION_CANDIDATE`), carry it (non-last chunk) or suppress at the tip (last chunk) — exactly as TEAL does, so no raw `[sfx:emoji-sho…` flashes mid-stream.
- **No effect dispatch here.** `transformTealStream` stays a pure display function. The effect is fired by Task D3 from the assembled draft text.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/src/lib/teal/teal-streaming.test.ts
import { describe, expect, it } from 'vitest';
import { transformTealStream } from './teal-streaming.js';

const flat = (chunks: string[]) =>
  transformTealStream(chunks).flat().map((s) => ({ t: s.text, c: s.classNames }));

describe('transformTealStream — integration tags', () => {
  it('renders a complete shower tag as a glowing display span', () => {
    const spans = flat(['nice [sfx:emoji-shower 🔥🦊💖] day']);
    const glow = spans.find((s) => s.c.includes('sfx-glow'));
    expect(glow?.t).toBe('🚿🔥🦊💖🚿');
    expect(spans.map((s) => s.t).join('')).toBe('nice 🚿🔥🦊💖🚿 day');
  });

  it('does not flash a half-typed integration tag at the stream tip', () => {
    const spans = flat(['celebrate [sfx:emoji-sho']);
    expect(spans.map((s) => s.t).join('')).toBe('celebrate ');
  });

  it('completes a tag split across chunks', () => {
    const spans = flat(['[sfx:emoji-shower 🔥', '🦊💖]']);
    expect(spans.find((s) => s.c.includes('sfx-glow'))?.t).toBe('🚿🔥🦊💖🚿');
  });

  it('leaves a normal TEAL tag working alongside', () => {
    const spans = flat(['[laugh] ok']);
    expect(spans.map((s) => s.t).join('')).toBe('😄 ok');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/user-client && vitest run src/lib/teal/teal-streaming.test.ts`
Expected: FAIL — integration tags pass through literally / flash.

- [ ] **Step 3: Implement the weiche** (add the import and the integration branch described above; keep the existing TEAL path untouched below it).

- [ ] **Step 4: Run tests (incl. existing TEAL streaming regression) + typecheck**

Run: `cd apps/user-client && vitest run src/lib/teal/ && cd ../.. && pnpm typecheck --force`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/teal/teal-streaming.ts apps/user-client/src/lib/teal/teal-streaming.test.ts
git commit -m "Detect integration tags in the streaming display path"
```

---

## Phase D — Overlay & trigger sources (`apps/user-client`)

### Task D1: Screen-effects dispatch store

**Files:**
- Create: `apps/user-client/src/lib/integrations/screen-effects-store.ts`
- Test: `apps/user-client/src/lib/integrations/screen-effects-store.test.ts`

**Design notes:**
- A tiny Zustand store holding a queue of active effect instances, each with a unique id (so the overlay can key and remove them). Mirrors the codebase's Zustand usage (e.g. the mindspace store).
- `trigger(effect)` pushes `{ id, effect, reducedMotion }`, capturing `prefers-reduced-motion` **at trigger time** (spec §4.3). `remove(id)` drops a finished instance.
- Generate ids without `Math.random`/`Date.now` (forbidden in some shared contexts; fine in the client, but use a monotonic counter for determinism in tests): module-level `let seq = 0; const nextId = () => `fx-${++seq}``.

**Interfaces:**
- Produces: `interface ActiveEffect { id: string; effect: EffectTrigger; reducedMotion: boolean }`; `useScreenEffectsStore` with `{ active: ActiveEffect[]; trigger(effect: EffectTrigger): void; remove(id: string): void }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/src/lib/integrations/screen-effects-store.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { useScreenEffectsStore } from './screen-effects-store.js';

describe('screen-effects store', () => {
  beforeEach(() => useScreenEffectsStore.setState({ active: [] }));

  it('enqueues a triggered effect with a unique id', () => {
    useScreenEffectsStore.getState().trigger({ kind: 'emoji-shower', emoji: ['🔥'] });
    const { active } = useScreenEffectsStore.getState();
    expect(active).toHaveLength(1);
    expect(active[0]?.effect).toEqual({ kind: 'emoji-shower', emoji: ['🔥'] });
  });

  it('removes a finished effect by id', () => {
    const s = useScreenEffectsStore.getState();
    s.trigger({ kind: 'emoji-shower', emoji: ['💖'] });
    const id = useScreenEffectsStore.getState().active[0]?.id ?? '';
    useScreenEffectsStore.getState().remove(id);
    expect(useScreenEffectsStore.getState().active).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/user-client && vitest run src/lib/integrations/screen-effects-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

```ts
// apps/user-client/src/lib/integrations/screen-effects-store.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';
import type { EffectTrigger } from '@chatsundere/llm-unified';

export interface ActiveEffect {
  id: string;
  effect: EffectTrigger;
  reducedMotion: boolean;
}

let seq = 0;
const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface ScreenEffectsState {
  active: ActiveEffect[];
  trigger: (effect: EffectTrigger) => void;
  remove: (id: string) => void;
}

export const useScreenEffectsStore = create<ScreenEffectsState>((set) => ({
  active: [],
  trigger: (effect) =>
    set((s) => ({
      active: [...s.active, { id: `fx-${++seq}`, effect, reducedMotion: prefersReducedMotion() }],
    })),
  remove: (id) => set((s) => ({ active: s.active.filter((e) => e.id !== id) })),
}));
```

- [ ] **Step 4: Run + typecheck**

Run: `cd apps/user-client && vitest run src/lib/integrations/screen-effects-store.test.ts && cd ../.. && pnpm typecheck --force`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/integrations/screen-effects-store.ts apps/user-client/src/lib/integrations/screen-effects-store.test.ts
git commit -m "Add screen-effects dispatch store"
```

---

### Task D2: Overlay + emoji-shower renderer + CSS

**Files:**
- Create: `apps/user-client/src/components/effects/ScreenEffectsOverlay.tsx`
- Create: `apps/user-client/src/components/effects/EmojiShowerEffect.tsx`
- Create/extend a CSS file for the rise keyframes (co-locate with other effect CSS; find where `voice-glow-active` is defined with `rg "voice-glow-active" apps/user-client/src --type css`)
- Test: `apps/user-client/tests/component/emoji-shower-effect.test.tsx`

**Design notes (port chatsune's `RisingEmojisEffect`, adapted):**
- `ScreenEffectsOverlay`: subscribes to `useScreenEffectsStore`, renders a fixed full-viewport, `pointer-events-none` container (z-index above content, below modals — chatsune used 90), maps each `ActiveEffect` whose `effect.kind === 'emoji-shower'` to `<EmojiShowerEffect>`, calls `remove(id)` via `onDone`.
- `EmojiShowerEffect`: picks `PROFILE_REDUCED` when `reducedMotion`, else `PROFILE_FULL`. Spawns N particle `<span>`s with **per-particle randomisation computed once at mount** (start X, drift, size, start/end rotation, duration), via CSS custom properties feeding a `screenEffectsRise` keyframe. Calls `onDone` on the last particle's `animationend`, with a `setTimeout(spawnMs + maxRiseMs + 500)` safety fallback (jsdom/backgrounded-tab — `animationend` may never fire).
- Randomisation: derive per-particle values from an index-seeded deterministic function (avoid `Math.random` so tests are stable and re-renders are equivalent-not-frozen, spec §4.3). E.g. a small hash of `(instanceSeq, particleIndex)`.

```
PROFILE_FULL   = { count: 40, spawnMs: 2800, sizeMin: 22, sizeMax: 38, drift: 30, riseMsMin: 2850, riseMsMax: 3750 }
PROFILE_REDUCED= { count: 4,  spawnMs: 1200, sizeMin: 22, sizeMax: 30, drift: 12, riseMsMin: 2300, riseMsMax: 2900 }
```

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/component/emoji-shower-effect.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmojiShowerEffect } from '../../src/components/effects/EmojiShowerEffect.js';

describe('EmojiShowerEffect', () => {
  it('renders the full profile count of the chosen emoji', () => {
    render(<EmojiShowerEffect emoji={['🔥', '🦊']} reducedMotion={false} onDone={() => {}} />);
    // 40 particles cycling through the 2 emoji
    expect(screen.getAllByText(/🔥|🦊/)).toHaveLength(40);
  });

  it('renders far fewer particles under reduced motion', () => {
    render(<EmojiShowerEffect emoji={['💖']} reducedMotion={true} onDone={() => {}} />);
    expect(screen.getAllByText('💖')).toHaveLength(4);
  });

  it('calls onDone via the safety timeout', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<EmojiShowerEffect emoji={['✨']} reducedMotion={true} onDone={onDone} />);
    vi.advanceTimersByTime(10_000);
    expect(onDone).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/user-client && vitest run tests/component/emoji-shower-effect.test.tsx`
Expected: FAIL — components not found.

- [ ] **Step 3: Implement overlay, effect component, keyframe CSS**

(Port the chatsune `RisingEmojisEffect` structure; `EmojiShowerEffect` props: `{ emoji: string[]; reducedMotion: boolean; onDone: () => void }`. `ScreenEffectsOverlay` wires the store.)

- [ ] **Step 4: Run + typecheck + biome**

Run: `cd apps/user-client && vitest run tests/component/emoji-shower-effect.test.tsx && cd ../.. && pnpm typecheck --force && pnpm biome check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/effects/ apps/user-client/src/**/*.css apps/user-client/tests/
git commit -m "Add screen-effects overlay and emoji-shower renderer"
```

---

### Task D3: Live-stream trigger source

**Files:**
- Create: `apps/user-client/src/lib/integrations/use-live-effect-source.ts`
- Modify: `apps/user-client/src/components/chat/MessageBlock.tsx` (call the hook for the streaming draft) — or the streaming-draft owner if that is a different component (confirm in Task 0)
- Test: `apps/user-client/src/lib/integrations/use-live-effect-source.test.ts`

**Design notes:**
- A hook `useLiveEffectSource(draftText: string | null, enabled: boolean)` that, as `draftText` grows, finds integration tags with `findIntegrationTags` whose closing `]` is present, resolves each via the registry, and dispatches its `effect` **once** — deduping by the tag's start index within this draft (a `useRef<Set<number>>`). Reset the seen-set when the draft identity changes (new message).
- Gated by `enabled` (`= screenEffectsEnabled` from settings). When disabled, do nothing (no dispatch) — but the display glow (Tasks C1/C2) still renders, per spec §6.
- The effect resolution reuses the registry: `getIntegration(tag.prefix)?.handle(tag.command, tag.rawArgs)?.effect`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/src/lib/integrations/use-live-effect-source.test.ts
import { renderHook } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { useLiveEffectSource } from './use-live-effect-source.js';
import { useScreenEffectsStore } from './screen-effects-store.js';

describe('useLiveEffectSource', () => {
  beforeEach(() => useScreenEffectsStore.setState({ active: [] }));

  it('dispatches once when a tag completes in the growing draft', () => {
    const { rerender } = renderHook(({ t }) => useLiveEffectSource(t, true), {
      initialProps: { t: 'hi [sfx:emoji-shower 🔥' }, // incomplete
    });
    expect(useScreenEffectsStore.getState().active).toHaveLength(0);
    rerender({ t: 'hi [sfx:emoji-shower 🔥]' }); // now complete
    expect(useScreenEffectsStore.getState().active).toHaveLength(1);
    rerender({ t: 'hi [sfx:emoji-shower 🔥] more' }); // unchanged tag, no re-dispatch
    expect(useScreenEffectsStore.getState().active).toHaveLength(1);
  });

  it('does not dispatch when disabled', () => {
    renderHook(() => useLiveEffectSource('[sfx:emoji-shower 💖]', false));
    expect(useScreenEffectsStore.getState().active).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/user-client && vitest run src/lib/integrations/use-live-effect-source.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook + wire it in the streaming-draft component**

In the message component, derive `enabled` from `useSettings().data?.screenEffectsEnabled ?? true` and pass the current streaming draft text (the same `split.tailText`/full draft the renderer uses). Only run for the actively-streaming draft, not finalised messages.

- [ ] **Step 4: Run + typecheck**

Run: `cd apps/user-client && vitest run src/lib/integrations/ && cd ../.. && pnpm typecheck --force`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/integrations/use-live-effect-source.ts apps/user-client/src/components/chat/MessageBlock.tsx apps/user-client/src/lib/integrations/use-live-effect-source.test.ts
git commit -m "Fire screen effects from the live stream"
```

---

### Task D4: Read-aloud trigger source

**Files:**
- Create: `apps/user-client/src/lib/integrations/use-readaloud-effect-source.ts`
- Modify: the component that owns voice playback for a message (the one already consuming `currentSegmentId` / `currentMessageId` — `MessageBlock.tsx` per Task 0) to call the hook
- Test: `apps/user-client/src/lib/integrations/use-readaloud-effect-source.test.ts`

**Design notes:**
- A hook `useReadAloudEffectSource({ messageId, rawText, segments, currentSegmentId, currentMessageId, enabled })`. When `currentMessageId === messageId` and `currentSegmentId` changes to a segment whose `charRange` `[start, end)` contains an integration tag's `index` (from `findIntegrationTags(rawText)`), dispatch that tag's effect once per (segmentId) visit.
- Dedupe by `currentSegmentId` so re-renders within the same segment do not re-fire; reset when `currentMessageId` clears (playback ends) so a second playback replays.
- Gated by `enabled`. `segments` is the `SpeechSegment[]` the playback already computed (or recompute via the same `segmentMessage` util the playback uses, on the message's `contentBlocks`/raw text — confirm the available source in Task 0).

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/src/lib/integrations/use-readaloud-effect-source.test.ts
import { renderHook } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { useReadAloudEffectSource } from './use-readaloud-effect-source.js';
import { useScreenEffectsStore } from './screen-effects-store.js';

const raw = 'hello [sfx:emoji-shower 🔥] world';
const segments = [
  { segmentId: '0:0', charRange: [0, 27] as [number, number], blockIndex: 0 },
  { segmentId: '0:1', charRange: [27, raw.length] as [number, number], blockIndex: 0 },
];

describe('useReadAloudEffectSource', () => {
  beforeEach(() => useScreenEffectsStore.setState({ active: [] }));

  it('fires when the segment containing the tag becomes active', () => {
    const { rerender } = renderHook(
      ({ seg }) =>
        useReadAloudEffectSource({
          messageId: 'm1', rawText: raw, segments: segments as never,
          currentSegmentId: seg, currentMessageId: 'm1', enabled: true,
        }),
      { initialProps: { seg: null as string | null } },
    );
    expect(useScreenEffectsStore.getState().active).toHaveLength(0);
    rerender({ seg: '0:0' }); // contains the tag at index 6
    expect(useScreenEffectsStore.getState().active).toHaveLength(1);
    rerender({ seg: '0:1' }); // no tag here
    expect(useScreenEffectsStore.getState().active).toHaveLength(1);
  });

  it('does nothing when disabled', () => {
    renderHook(() =>
      useReadAloudEffectSource({
        messageId: 'm1', rawText: raw, segments: segments as never,
        currentSegmentId: '0:0', currentMessageId: 'm1', enabled: false,
      }),
    );
    expect(useScreenEffectsStore.getState().active).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/user-client && vitest run src/lib/integrations/use-readaloud-effect-source.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook + wire it in the message component**

- [ ] **Step 4: Run + typecheck**

Run: `cd apps/user-client && vitest run src/lib/integrations/ && cd ../.. && pnpm typecheck --force`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/integrations/use-readaloud-effect-source.ts apps/user-client/src/components/chat/MessageBlock.tsx apps/user-client/src/lib/integrations/use-readaloud-effect-source.test.ts
git commit -m "Replay screen effects during read-aloud"
```

---

### Task D5: Mount overlay + pass setting into prompt build

**Files:**
- Modify: the app root layout (where global overlays mount — find with `rg "SplashOverlay|Lightbox" apps/user-client/src/routes` or the App shell) to render `<ScreenEffectsOverlay />`
- Modify: the `buildPrompt` call-site (the stream engine — `apps/user-client/src/lib/.../stream-engine.ts` per Task 0) to pass `screenEffectsEnabled` from settings
- Modify: any background-job `buildPrompt` callers (title/memory/greeting) to pass `screenEffectsEnabled` (false is fine for title/memory; greeting should pass the real setting)
- Test: covered by the manual verification (Task E) + the existing prompt tests (A3)

**Design notes:**
- The overlay mounts once, globally, so any message's effect plays over the whole screen.
- The stream engine already reads the settings row to build inputs (per the first exploration); add `screenEffectsEnabled: settings.screenEffectsEnabled` to the `BuildPromptInputs` it constructs. Memory: background jobs must reuse the adapter path — only the chat/greeting builds need the real flag; title/memory pass `false`.

- [ ] **Step 1: Mount the overlay** — add `<ScreenEffectsOverlay />` to the global shell next to other global overlays.

- [ ] **Step 2: Wire the setting** — set `screenEffectsEnabled` in every `BuildPromptInputs` construction (real value for chat + greeting; `false` for title + memory).

- [ ] **Step 3: Run full typecheck + lint**

Run: `pnpm typecheck --force && pnpm biome check`
Expected: PASS — no remaining missing-field errors.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/
git commit -m "Mount screen-effects overlay and feed the toggle into prompt build"
```

---

## Phase E — Whole-feature verification & audit

### Task E: Full gate, manual verification, Laura pre-squash

- [ ] **Step 1: Full automated gate**

Run from repo root:
```bash
pnpm typecheck --force
pnpm biome check
cd packages/llm-unified && bun test && cd ../..
cd apps/user-client && vitest run && cd ../..
```
Expected: all green. The Vitest baseline carries a known trio of Node-localStorage failures (expect exactly those; a different count is a real regression — memory: vitest baseline = Node localStorage).

- [ ] **Step 2: Manual verification** (device-tested by Chris — spec §10). Drive the dev app (restart `pnpm dev` first — Vite HMR ignores `packages/*` edits, so the new prompt/registry will look missing until a restart; memory: catalogue changes need dev restart). Walk all seven steps in spec §10.

- [ ] **Step 3: Laura pre-squash pass.** Summon Laura on the built flow (light pre-squash mode — verify it honours the spec-pass intent: toggle in Voice settings, "off" stops new emissions, glow + overlay behave). Fix hard defects or log a deferral with Chris's sign-off.

- [ ] **Step 4: Update STATUS + couplings register.**
  - `obsidian/STATUS-CLIENT-ONLY.md`: move Screen Effects from "Doing now" to "Done"; refresh the "Next session" block and `Last updated:`.
  - `obsidian/insights/future-feature-couplings.md`: add the read-aloud ↔ screen-effects segment-event coupling, and the deferred "Built In" Integrations-tab (returns with the next integration).

- [ ] **Step 5: Squash & commit.** One squashed commit per the granularity rule. Before squashing, scan `git diff --cached --name-only` for any stray scratch/report files (memory: verify squash has no scratch pollution). Verify the final tree typechecks on the squashed state. Then hand back to Chris for push.

---

## Self-review (author's check against the spec)

- **§3.1 weiche / §3.3 grammar** → Tasks A1 (parser), C2 (streaming weiche). ✓
- **§3.2 interface** → A1 (`Integration`), refined: gating is external (composition input + client `enabled`), not an interface method, to keep `llm-unified` free of client `SettingsRow` types. Documented in A2/A3/D3.
- **§4.1 canonical text** → preserved: nothing persists the transformed display (C1 transforms at render only). ✓
- **§4.2 inline glow (finalised + streaming)** → C1 (preprocess + rehype + CSS, `var(--mindspace-accent)`) and C2 (streaming `sfx-glow` span). ✓
- **§4.3 overlay (profiles, reduced-motion, randomisation, safety timeout)** → D2. Mount-does-not-replay clarified (Global Constraints + D3/D4 fire only from the two sources). ✓
- **§4.4 trigger sources** → D3 (live), D4 (read-aloud via `charRange`). ✓
- **§5 prompt segment gated on toggle** → A3 (gated resolve) + D5 (real flag wired). ✓
- **§6 off-semantics** → parsing always live (C1/C2 unconditional), inline display always shown (C1/C2), overlay gated (D3/D4 `enabled`), prompt gated (A3). ✓
- **§7 settings + Voice surfacing + "FX" tile** → B1 (field), B2 (toggle + tile). My Integrations untouched. ✓
- **§8 emoji-shower display rule + rains args only** → A2. ✓
- **§9 first-party, no Larissa, Laura pre-squash** → E step 3. ✓
- **§10 manual verification** → E step 2. ✓
- **§11 future work (Built In tab, special integration mini-parser) + couplings** → E step 4. ✓

**Open dependency flagged for execution:** Dexie version number (Task 0/B1) and the streaming-draft component identity (Task 0/D3) must be reconfirmed against the merged tree before coding.
