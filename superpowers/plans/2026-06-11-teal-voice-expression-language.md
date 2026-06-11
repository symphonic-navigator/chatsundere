# TEAL — Voice Expression Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement TEAL v1 — the canonical voice expression language (closed vocabulary, xAI snapshot), its always-on Band-1 prompt segment, and the human-friendly display rendering (emoji / typography / silent) in both the finalised Markdown path and the live streaming path.

**Architecture:** A pure vocabulary + prompt-segment module in `packages/llm-unified` (`teal/`), wired into `buildPrompt` as a Band-1 segment with `jobs: ['chat', 'greeting']` placed **before** the roleplay segment (spec D9). Display rendering in `apps/user-client` is data-driven from one render map: a preprocess step replaces known inline tags with emoji/typography and converts known wrapping tags to private-use sentinels (code regions masked), a rehype plugin turns sentinel spans into styled `<span class="teal-…">` elements, and a pure chunk-state-machine transforms the raw streaming path (react-markdown is NOT involved during streaming — see spec context below).

**Tech Stack:** TypeScript strict, Bun test (llm-unified), Vitest + Testing Library (user-client), react-markdown v10 pipeline (remark-gfm, remark-math, rehype-katex), Biome.

**Spec:** `superpowers/specs/2026-06-11-teal-voice-expression-language-design.md` — read it first.

---

## Empirical pipeline facts (read before coding)

1. **react-markdown v10 skips raw HTML by default** (no `rehype-raw` in use). `<whisper>text</whisper>` never reaches rehype as an element — the tags are dropped, the inner text survives. Therefore known wrapping tags MUST be converted to text-safe sentinels **before** ReactMarkdown parses (preprocess), and a rehype plugin converts the sentinels into spans. Unknown wrapping tags need no code at all: the default pipeline already strips the tags and keeps the text — exactly spec §4.2.
2. **CommonMark replaces U+0000 with U+FFFD**, so NUL-style masks (the `preprocessMath` trick) cannot survive into the parser. The TEAL sentinels use Private Use Area chars ``/``, which pass through micromark as ordinary text.
3. **Streaming renders raw text** — `MessageBlock.renderBlocks` emits one `<span class="stream-tok">` per upstream chunk, with NO Markdown parse (apps/user-client/src/components/chat/MessageBlock.tsx:295-306). Tags would flash raw during streaming without a dedicated transform. Tags can split across chunk boundaries (`"[lau"` + `"gh]"`).
4. **Band/order segment registry** lives in `packages/llm-unified/src/composition.ts` (`SEGMENTS`, sorted by band then order). Roleplay is band 1 order 3, persona order 4. `CHAT_AND_GREETING` already exists (line 69). TEAL is always-on → **no new `BuildPromptInputs` field**, and the chat-page context gauge counts it automatically (it calls `buildPrompt(…, 'chat')`).
5. **Conventions:** llm-unified co-locates tests in `src/**/*.test.ts` (bun test). user-client tests live under `tests/**` (vitest). Biome bans non-null `!`. All repo text is British English. LGPL header for llm-unified files (`// SPDX-License-Identifier: LGPL-3.0-only`), AGPL for user-client files (`// SPDX-License-Identifier: AGPL-3.0-only`).
6. **Gates** (run from repo root): `pnpm typecheck --force` (14 projects), `cd packages/llm-unified && bun test`, `cd apps/user-client && pnpm vitest run`, `pnpm run build`, `pnpm exec biome check <changed files>`. The user-client suite has a known 8-failure baseline (cockpit-draft/chat-page/chat-route localStorage-jsdom) — zero NEW failures allowed.

**Audit gates:** Not a Larissa path (client-only, no auth/sync/proxy/crypto, no new egress). Not a Laura path (no flow/state/reachability change — message text renders friendlier; judgement call recorded in the STATUS entry).

---

### Task 1: TEAL vocabulary module in llm-unified

**Files:**
- Create: `packages/llm-unified/src/teal/teal.ts`
- Test: `packages/llm-unified/src/teal/teal.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import {
  TEAL_EXPRESSION_PROMPT,
  TEAL_INLINE_TAGS,
  TEAL_WRAPPING_TAGS,
  matchTealInline,
  stripTeal,
} from './teal.js';

describe('TEAL vocabulary', () => {
  it('carries the v1 snapshot sizes', () => {
    expect(TEAL_INLINE_TAGS.length).toBe(16);
    expect(TEAL_WRAPPING_TAGS.length).toBe(13);
  });

  it('matches exact inline tags', () => {
    expect(matchTealInline('laugh')).toBe('laugh');
    expect(matchTealInline('long-pause')).toBe('long-pause');
  });

  it('matches qualified inline tags on the core word', () => {
    expect(matchTealInline('soft laugh')).toBe('laugh');
    expect(matchTealInline('exhale sharply')).toBe('exhale');
    expect(matchTealInline('Soft  Laugh')).toBe('laugh'); // normalises case + whitespace
  });

  it('returns null for unknown content', () => {
    expect(matchTealInline('snort')).toBeNull();
    expect(matchTealInline('1')).toBeNull();
    expect(matchTealInline('sic')).toBeNull();
    expect(matchTealInline('')).toBeNull();
  });
});

describe('stripTeal', () => {
  it('removes known inline tags and wrapping tags, keeps text', () => {
    expect(stripTeal('Hello [laugh] there')).toBe('Hello there');
    expect(stripTeal('<whisper>a secret</whisper>')).toBe('a secret');
    expect(stripTeal('[soft laugh] <loud>hey</loud>')).toBe('hey');
  });

  it('leaves unknown brackets and tags literal', () => {
    expect(stripTeal('see [1] and [sic]')).toBe('see [1] and [sic]');
    expect(stripTeal('<snort>text</snort>')).toBe('<snort>text</snort>');
  });
});

describe('TEAL_EXPRESSION_PROMPT', () => {
  it('lists both syntaxes and every tag', () => {
    for (const tag of TEAL_INLINE_TAGS) expect(TEAL_EXPRESSION_PROMPT).toContain(`[${tag}]`);
    for (const tag of TEAL_WRAPPING_TAGS) expect(TEAL_EXPRESSION_PROMPT).toContain(`<${tag}>`);
  });

  it('carries dosage and the anti-double-marking rule (structural markers)', () => {
    expect(TEAL_EXPRESSION_PROMPT).toContain('0–2 markups');
    expect(TEAL_EXPRESSION_PROMPT).toContain('asterisks');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/llm-unified && bun test src/teal/teal.test.ts`
Expected: FAIL — module `./teal.js` not found.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only

/**
 * TEAL v1 — Transformative Expression and Anthropomorphisation Layer.
 *
 * The canonical voice expression language: a closed, versioned vocabulary
 * (v1 = xAI voice-tag snapshot, 2026-06-11) that every consumer translates
 * from — the chat display renders it as friendly formatting, and future TTS
 * translators map it onto each backend's capabilities. Extension is
 * deliberate curation (a new version), never heuristics. See the design spec
 * `superpowers/specs/2026-06-11-teal-voice-expression-language-design.md`.
 */

export const TEAL_VERSION = 1;

/** Inline tags — discrete one-shot events, written `[tag]`. */
export const TEAL_INLINE_TAGS = [
  'pause',
  'long-pause',
  'hum-tune',
  'laugh',
  'chuckle',
  'giggle',
  'cry',
  'whoop',
  'tsk',
  'tongue-click',
  'lip-smack',
  'breath',
  'inhale',
  'exhale',
  'sigh',
  'gasp',
] as const;
export type TealInlineTag = (typeof TEAL_INLINE_TAGS)[number];

/** Wrapping tags — prosody spans, written `<tag>…</tag>`. May nest. */
export const TEAL_WRAPPING_TAGS = [
  'soft',
  'whisper',
  'loud',
  'build-intensity',
  'decrease-intensity',
  'higher-pitch',
  'lower-pitch',
  'slow',
  'fast',
  'sing-song',
  'singing',
  'laugh-speak',
  'emphasis',
] as const;
export type TealWrappingTag = (typeof TEAL_WRAPPING_TAGS)[number];

const INLINE_SET: ReadonlySet<string> = new Set(TEAL_INLINE_TAGS);
const WRAPPING_SET: ReadonlySet<string> = new Set(TEAL_WRAPPING_TAGS);

const INLINE_DESCRIPTIONS: Record<TealInlineTag, string> = {
  pause: 'a short silence',
  'long-pause': 'a longer deliberate silence',
  'hum-tune': 'a brief hummed tune',
  laugh: 'a full laugh',
  chuckle: 'a quiet chuckle',
  giggle: 'a playful giggle',
  cry: 'a sob or cry',
  whoop: 'a whoop of excitement',
  tsk: 'a disapproving tsk',
  'tongue-click': 'a tongue click',
  'lip-smack': 'a lip smack',
  breath: 'an audible breath',
  inhale: 'an inward breath',
  exhale: 'an outward breath',
  sigh: 'a sigh',
  gasp: 'a sharp gasp',
};

const WRAPPING_DESCRIPTIONS: Record<TealWrappingTag, string> = {
  soft: 'soften the delivery',
  whisper: 'whisper',
  loud: 'raise the volume',
  'build-intensity': 'build intensity across the wrapped text',
  'decrease-intensity': 'fade intensity across the wrapped text',
  'higher-pitch': 'raise the pitch',
  'lower-pitch': 'lower the pitch',
  slow: 'slow the pace',
  fast: 'speed up the pace',
  'sing-song': 'sing-song intonation',
  singing: 'sing the wrapped text',
  'laugh-speak': 'speak through laughter',
  emphasis: 'emphasise the wrapped text',
};

/**
 * Resolve bracket content to a known inline tag. Exact match first; otherwise
 * the first whitespace-separated token that is a known core word (qualifiers
 * like `soft` in `[soft laugh]` never block recognition). Returns null when
 * nothing matches — unknown content stays literal (closed vocabulary, D2).
 */
export function matchTealInline(content: string): TealInlineTag | null {
  const norm = content.trim().toLowerCase().replace(/\s+/g, ' ');
  if (norm.length === 0) return null;
  if (INLINE_SET.has(norm)) return norm as TealInlineTag;
  for (const token of norm.split(' ')) {
    if (INLINE_SET.has(token)) return token as TealInlineTag;
  }
  return null;
}

/** True when `name` is a known wrapping tag. */
export function isTealWrapping(name: string): name is TealWrappingTag {
  return WRAPPING_SET.has(name.toLowerCase());
}

/**
 * Remove all known TEAL markup from text — for plain-text surfaces
 * (previews, notifications). Unknown brackets/tags stay untouched.
 */
export function stripTeal(text: string): string {
  return text
    .replace(/\[([A-Za-z][A-Za-z\- ]{0,38})\]/g, (m, content: string) =>
      matchTealInline(content) === null ? m : '',
    )
    .replace(/<(\/?)([a-z-]+)>/g, (m, _slash: string, name: string) =>
      isTealWrapping(name) ? '' : m,
    )
    .replace(/ {2,}/g, ' ')
    .replace(/^ +| +$/gm, '');
}

function tagLines(): { inline: string; wrapping: string } {
  const inline = TEAL_INLINE_TAGS.map((t) => `- \`[${t}]\` — ${INLINE_DESCRIPTIONS[t]}`).join('\n');
  const wrapping = TEAL_WRAPPING_TAGS.map(
    (t) => `- \`<${t}>…</${t}>\` — ${WRAPPING_DESCRIPTIONS[t]}`,
  ).join('\n');
  return { inline, wrapping };
}

/** Band-1 TEAL segment — always on for chat and greeting (spec D1/D8). */
export const TEAL_EXPRESSION_PROMPT = (() => {
  const { inline, wrapping } = tagLines();
  return `## Expressive delivery

The assistant's replies carry vocal expression. Two kinds of markup are understood: in text they render as friendly formatting; when the assistant speaks aloud they shape the voice itself.

### Syntax

- Inline tags in square brackets trigger a discrete sound or pause: \`[laugh]\`, \`[breath]\`, \`[pause]\`.
- Inline tags may carry a short qualifier word in the same brackets: \`[soft laugh]\`, \`[exhale sharply]\`.
- Wrapping tags in angle brackets modulate delivery across the text they enclose: \`<whisper>a secret</whisper>\`. Wrapping tags may nest.

### Inline tags

${inline}

### Wrapping tags

${wrapping}

### Dosage

Typically 0–2 markups per message — not every sentence. Use a wrapping tag for genuine emphasis, a pause to let a punchline land, a breath where one would naturally fall. Expression reads as natural when markup is rare.
When narrating an action between asterisks, do not additionally tag the same sound — \`*giggles softly*\` already carries the giggle.`;
})();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/llm-unified && bun test src/teal/teal.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/teal/
git commit -m "Add TEAL vocabulary module"
```

---

### Task 2: Wire TEAL into buildPrompt as a Band-1 segment

**Files:**
- Modify: `packages/llm-unified/src/composition.ts` (SegmentId union ~line 46; SEGMENTS ~lines 99-113)
- Modify: `packages/llm-unified/src/index.ts` (exports)
- Test: `packages/llm-unified/src/composition.test.ts`

- [ ] **Step 1: Write the failing tests** (append a describe block)

```typescript
describe('teal segment', () => {
  it('is always present in chat and greeting', () => {
    for (const job of ['chat', 'greeting'] as const) {
      const out = buildPrompt(inputs({}), job);
      expect(out).toContain('Expressive delivery');
    }
  });

  it('is absent from title and memory jobs', () => {
    for (const job of ['title', 'memory'] as const) {
      const out = buildPrompt(inputs({}), job);
      expect(out).not.toContain('Expressive delivery');
    }
  });

  it('sits before roleplay, which stays directly before persona', () => {
    const out = buildPrompt(
      inputs({
        roleplayEnabled: true,
        personaInstructions: 'PERSONA-MARK',
      }),
      'chat',
    );
    const tealIdx = out.indexOf('Expressive delivery');
    const rpIdx = out.indexOf('roleplay mode');
    const pIdx = out.indexOf('PERSONA-MARK');
    expect(tealIdx).toBeGreaterThanOrEqual(0);
    expect(tealIdx).toBeLessThan(rpIdx);
    expect(rpIdx).toBeLessThan(pIdx);
  });
});
```

Note: reuse the existing `inputs()` helper at the top of composition.test.ts (line ~7). Match its actual signature when appending.

- [ ] **Step 2: Run tests to verify the new block fails**

Run: `cd packages/llm-unified && bun test src/composition.test.ts`
Expected: the three new tests FAIL ('Expressive delivery' absent); pre-existing tests still pass.

- [ ] **Step 3: Implement**

In `composition.ts`:

1. Add the import:

```typescript
import { TEAL_EXPRESSION_PROMPT } from './teal/teal.js';
```

2. Extend the `SegmentId` union with `| 'teal'` (after `'global'`).

3. Insert the segment before roleplay and renumber roleplay/persona:

```typescript
  { id: 'global', band: 1, order: 2, jobs: ALL_JOBS, resolve: (i) => i.globalInstructions },
  // Always-on expression layer (TEAL spec 2026-06-11, D1/D9): placed before the
  // roleplay segment so the roleplay → persona adjacency stays intact. Chat and
  // greeting only — title and memory produce no spoken text (D8).
  { id: 'teal', band: 1, order: 3, jobs: CHAT_AND_GREETING, resolve: () => TEAL_EXPRESSION_PROMPT },
  // Runs in every Band-1 job on purpose (spec 2026-06-11 §4.1): the title job's
  // trailing instruction overrides the embodiment rules in practice — the same
  // mechanism that lets the NSFW segment coexist with title generation.
  {
    id: 'roleplay',
    band: 1,
    order: 4,
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
  { id: 'persona', band: 1, order: 5, jobs: ALL_JOBS, resolve: (i) => i.personaInstructions },
```

In `index.ts`, add alongside the existing identity exports (~line 34):

```typescript
export {
  TEAL_EXPRESSION_PROMPT,
  TEAL_INLINE_TAGS,
  TEAL_WRAPPING_TAGS,
  TEAL_VERSION,
  type TealInlineTag,
  type TealWrappingTag,
  isTealWrapping,
  matchTealInline,
  stripTeal,
} from './teal/teal.js';
```

- [ ] **Step 4: Run the full llm-unified suite; repair any assertion the new segment shifts**

Run: `cd packages/llm-unified && bun test`
Expected: the three new tests PASS. Any pre-existing test that asserts a *full* chat/greeting prompt string (rather than `toContain`) now includes the TEAL text — update those assertions to keep their original intent (they assert presence/ordering of OTHER segments, not TEAL's absence). Do NOT weaken ordering tests.

- [ ] **Step 5: Run user-client tests that build prompts**

Run: `cd apps/user-client && pnpm vitest run`
Expected: baseline 8 failures only. Any test pinning exact system-prompt strings (stream-engine, title-generator, opener tests) that breaks: update the same way. Zero new failures otherwise.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/src/composition.ts packages/llm-unified/src/composition.test.ts packages/llm-unified/src/index.ts
git commit -m "Wire TEAL segment into buildPrompt for chat and greeting"
```

---

### Task 3: Data-driven render map in user-client

**Files:**
- Create: `apps/user-client/src/lib/teal/teal-render-map.ts`
- Test: `apps/user-client/tests/lib/teal/teal-render-map.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  resolveTealInline,
  resolveTealWrap,
} from '../../../src/lib/teal/teal-render-map.js';

describe('resolveTealInline', () => {
  it('renders core tags', () => {
    expect(resolveTealInline('laugh')).toEqual({ kind: 'emoji', value: '😄' });
    expect(resolveTealInline('giggle')).toEqual({ kind: 'emoji', value: '🤭' });
    expect(resolveTealInline('pause')).toEqual({ kind: 'text', value: ' … ' });
    expect(resolveTealInline('long-pause')).toEqual({ kind: 'text', value: ' …… ' });
  });

  it('prefers combination rows over the core word (longest match)', () => {
    expect(resolveTealInline('soft laugh')).toEqual({ kind: 'emoji', value: '🤭' });
    expect(resolveTealInline('SOFT  laugh')).toEqual({ kind: 'emoji', value: '🤭' });
  });

  it('falls back to the core word for unknown qualifiers', () => {
    expect(resolveTealInline('exhale sharply')).toEqual({ kind: 'emoji', value: '😮‍💨' });
    expect(resolveTealInline('quick breath')).toEqual({ kind: 'emoji', value: '😮‍💨' });
  });

  it('maps the breath family onto one emoji and silences mouth sounds', () => {
    for (const t of ['sigh', 'breath', 'inhale', 'exhale']) {
      expect(resolveTealInline(t)).toEqual({ kind: 'emoji', value: '😮‍💨' });
    }
    expect(resolveTealInline('tongue-click')).toEqual({ kind: 'silent' });
    expect(resolveTealInline('lip-smack')).toEqual({ kind: 'silent' });
  });

  it('returns null for unknown content (stays literal)', () => {
    expect(resolveTealInline('snort')).toBeNull();
    expect(resolveTealInline('1')).toBeNull();
    expect(resolveTealInline('citation needed')).toBeNull();
  });
});

describe('resolveTealWrap', () => {
  it('maps wrapping tags to presentation classes', () => {
    expect(resolveTealWrap('whisper')).toEqual({ kind: 'wrap', className: 'teal-whisper' });
    expect(resolveTealWrap('soft')).toEqual({ kind: 'wrap', className: 'teal-italic' });
    expect(resolveTealWrap('loud')).toEqual({ kind: 'wrap', className: 'teal-bold' });
    expect(resolveTealWrap('emphasis')).toEqual({ kind: 'wrap', className: 'teal-bold' });
    expect(resolveTealWrap('laugh-speak')).toEqual({ kind: 'wrap', className: 'teal-bold' });
    expect(resolveTealWrap('slow')).toEqual({ kind: 'wrap', className: 'teal-slow' });
    expect(resolveTealWrap('singing')).toEqual({ kind: 'wrap', className: 'teal-singing' });
    expect(resolveTealWrap('sing-song')).toEqual({ kind: 'wrap', className: 'teal-singing' });
  });

  it('silences voice-only modulation and rejects unknown tags', () => {
    for (const t of ['higher-pitch', 'lower-pitch', 'fast', 'build-intensity', 'decrease-intensity']) {
      expect(resolveTealWrap(t)).toEqual({ kind: 'silent' });
    }
    expect(resolveTealWrap('snort')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/user-client && pnpm vitest run tests/lib/teal/teal-render-map.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import {
  type TealInlineTag,
  type TealWrappingTag,
  isTealWrapping,
  matchTealInline,
} from 'llm-unified';

/**
 * TEAL display render map — the data file Chris curates. The display is one
 * translation target of the canonical language (the prettiest one): every
 * row says how a tag looks in chat text. Three output classes: emoji,
 * typography (text replacement or a styled span), or silent (audible later,
 * not visible). Editing a row is the whole change — the plugins are generic.
 * Spec: superpowers/specs/2026-06-11-teal-voice-expression-language-design.md §4.3.
 */
export type TealRenderAction =
  | { kind: 'emoji'; value: string }
  | { kind: 'text'; value: string }
  | { kind: 'wrap'; className: string }
  | { kind: 'silent' };

const BREATH = { kind: 'emoji', value: '😮‍💨' } as const;

/** Combination rows — matched before the core word (longest match, D3). */
const INLINE_COMBINATIONS: Readonly<Record<string, TealRenderAction>> = {
  'soft laugh': { kind: 'emoji', value: '🤭' },
};

const INLINE_RENDER: Readonly<Record<TealInlineTag, TealRenderAction>> = {
  pause: { kind: 'text', value: ' … ' },
  'long-pause': { kind: 'text', value: ' …… ' },
  'hum-tune': { kind: 'emoji', value: '🎶' },
  laugh: { kind: 'emoji', value: '😄' },
  chuckle: { kind: 'emoji', value: '😁' },
  giggle: { kind: 'emoji', value: '🤭' },
  cry: { kind: 'emoji', value: '😢' },
  whoop: { kind: 'emoji', value: '🥳' },
  tsk: { kind: 'emoji', value: '😒' },
  'tongue-click': { kind: 'silent' },
  'lip-smack': { kind: 'silent' },
  breath: BREATH,
  inhale: BREATH,
  exhale: BREATH,
  sigh: BREATH,
  gasp: { kind: 'emoji', value: '😲' },
};

const WRAP_RENDER: Readonly<Record<TealWrappingTag, TealRenderAction>> = {
  soft: { kind: 'wrap', className: 'teal-italic' },
  whisper: { kind: 'wrap', className: 'teal-whisper' },
  loud: { kind: 'wrap', className: 'teal-bold' },
  emphasis: { kind: 'wrap', className: 'teal-bold' },
  'laugh-speak': { kind: 'wrap', className: 'teal-bold' },
  slow: { kind: 'wrap', className: 'teal-slow' },
  singing: { kind: 'wrap', className: 'teal-singing' },
  'sing-song': { kind: 'wrap', className: 'teal-singing' },
  'build-intensity': { kind: 'silent' },
  'decrease-intensity': { kind: 'silent' },
  'higher-pitch': { kind: 'silent' },
  'lower-pitch': { kind: 'silent' },
  fast: { kind: 'silent' },
};

/** Resolve inline bracket content: combination row first, then core word. */
export function resolveTealInline(content: string): TealRenderAction | null {
  const norm = content.trim().toLowerCase().replace(/\s+/g, ' ');
  const combo = INLINE_COMBINATIONS[norm];
  if (combo) return combo;
  const core = matchTealInline(norm);
  return core === null ? null : INLINE_RENDER[core];
}

/** Resolve a wrapping tag name; null for unknown tags. */
export function resolveTealWrap(name: string): TealRenderAction | null {
  const norm = name.toLowerCase();
  return isTealWrapping(norm) ? WRAP_RENDER[norm] : null;
}
```

Note: check how user-client imports llm-unified elsewhere (e.g. `rg "from 'llm-unified'" apps/user-client/src | head -3`) and use the same specifier.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/user-client && pnpm vitest run tests/lib/teal/teal-render-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/teal/teal-render-map.ts apps/user-client/tests/lib/teal/teal-render-map.test.ts
git commit -m "Add data-driven TEAL render map"
```

---

### Task 4: Extract shared code-region masking

**Files:**
- Create: `apps/user-client/src/lib/markdown/code-mask.ts`
- Modify: `apps/user-client/src/lib/markdown/preprocess-math.ts` (use the shared util)
- Test: existing `apps/user-client/tests/lib/markdown/preprocess-math.test.ts` must stay green

- [ ] **Step 1: Create the shared utility** (extracted verbatim from preprocess-math.ts Steps 1+4)

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Mask fenced code blocks and inline code spans with NUL-delimited sentinels
 * so string-level preprocessors never rewrite user code, then restore them.
 * NUL is safe here because the masked string never reaches the Markdown
 * parser — callers must restore before handing the text on.
 */
export function maskCodeRegions(src: string): { masked: string; restore: (s: string) => string } {
  const masks: string[] = [];
  const mask = (m: string): string => {
    const i = masks.length;
    masks.push(m);
    return `\0CODE${i}\0`;
  };
  const masked = src
    .replace(
      /(^|\n)(```[\s\S]*?\n```|~~~[\s\S]*?\n~~~)/g,
      (_m, lead: string, fence: string) => `${lead}${mask(fence)}`,
    )
    .replace(/(`+)([\s\S]*?)\1/g, (m) => mask(m));
  const restore = (s: string): string =>
    s.replace(/\0CODE(\d+)\0/g, (_m, idx: string) => masks[Number(idx)] ?? '');
  return { masked, restore };
}
```

- [ ] **Step 2: Refactor preprocess-math.ts to use it**

Replace its inline Step-1 masking and Step-4 restore with:

```typescript
import { maskCodeRegions } from './code-mask.js';
// ...
export function preprocessMath(src: string): string {
  const { masked, restore } = maskCodeRegions(src);
  let out = masked;
  // (existing Step 2 and Step 3 replacements unchanged)
  return restore(out);
}
```

Keep the explanatory header comments; delete only the now-duplicated mask/restore code.

- [ ] **Step 3: Verify the existing tests stay green**

Run: `cd apps/user-client && pnpm vitest run tests/lib/markdown/preprocess-math.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/lib/markdown/code-mask.ts apps/user-client/src/lib/markdown/preprocess-math.ts
git commit -m "Extract shared code-region masking from preprocess-math"
```

---

### Task 5: TEAL preprocess step (inline tags + wrap sentinels)

**Files:**
- Create: `apps/user-client/src/lib/teal/preprocess-teal.ts`
- Test: `apps/user-client/tests/lib/teal/preprocess-teal.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  TEAL_MARK_END,
  TEAL_MARK_START,
  preprocessTeal,
} from '../../../src/lib/teal/preprocess-teal.js';

describe('preprocessTeal — inline tags', () => {
  it('replaces known inline tags per the render map', () => {
    expect(preprocessTeal('Hello [laugh] there')).toBe('Hello 😄 there');
    expect(preprocessTeal('Wait[pause]now')).toBe('Wait … now');
    expect(preprocessTeal('a [soft laugh] b')).toBe('a 🤭 b');
  });

  it('removes silent inline tags', () => {
    expect(preprocessTeal('a [tongue-click] b')).toBe('a  b');
  });

  it('leaves unknown brackets literal', () => {
    expect(preprocessTeal('see [1], [sic], [snort]')).toBe('see [1], [sic], [snort]');
    expect(preprocessTeal('[checklist item](https://x)')).toBe('[checklist item](https://x)');
  });
});

describe('preprocessTeal — wrapping tags', () => {
  it('converts known wraps to sentinel markers', () => {
    expect(preprocessTeal('<whisper>hi</whisper>')).toBe(
      `${TEAL_MARK_START}whisper${TEAL_MARK_END}hi${TEAL_MARK_START}/whisper${TEAL_MARK_END}`,
    );
  });

  it('drops silent wraps but keeps the text', () => {
    expect(preprocessTeal('<fast>quick</fast>')).toBe('quick');
  });

  it('leaves unknown angle tags untouched (default pipeline strips them)', () => {
    expect(preprocessTeal('<snort>text</snort>')).toBe('<snort>text</snort>');
  });
});

describe('preprocessTeal — code immunity', () => {
  it('never rewrites inside fenced code blocks', () => {
    const src = 'before\n```\n[laugh] <whisper>x</whisper>\n```\nafter [laugh]';
    expect(preprocessTeal(src)).toBe('before\n```\n[laugh] <whisper>x</whisper>\n```\nafter 😄');
  });

  it('never rewrites inside inline code', () => {
    expect(preprocessTeal('use `[pause]` here [pause]')).toBe('use `[pause]` here  … ');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/user-client && pnpm vitest run tests/lib/teal/preprocess-teal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { maskCodeRegions } from '../markdown/code-mask.js';
import { resolveTealInline, resolveTealWrap } from './teal-render-map.js';

/**
 * String-level TEAL preprocessing, run before the text reaches ReactMarkdown:
 *
 *   - Known inline tags `[laugh]` become their emoji / typographic
 *     replacement (or vanish when silent).
 *   - Known wrapping tags `<whisper>…</whisper>` become Private-Use-Area
 *     sentinel markers that survive micromark as plain text; the rehype-teal
 *     plugin turns the marked ranges into styled spans. (react-markdown
 *     drops raw HTML by default, so the tags themselves would never reach
 *     rehype — and CommonMark replaces NUL with U+FFFD, hence PUA chars.)
 *   - Unknown brackets and unknown angle tags stay literal: the closed
 *     vocabulary is the false-positive guard (spec D2), and the default
 *     pipeline already strips unknown HTML tags while keeping their text.
 *
 * Code fences and inline code are masked during the rewrite.
 */
export const TEAL_MARK_START = '\uE000';
export const TEAL_MARK_END = '\uE001';

/** Max length of bracket content we consider a tag candidate. */
const TAG_CANDIDATE = /\[([A-Za-z][A-Za-z\- ]{0,38})\](?!\()/g;
const WRAP_CANDIDATE = /<(\/?)([a-z-]+)>/g;

export function preprocessTeal(src: string): string {
  const { masked, restore } = maskCodeRegions(src);
  let out = masked.replace(TAG_CANDIDATE, (m, content: string) => {
    const action = resolveTealInline(content);
    if (action === null) return m;
    if (action.kind === 'emoji' || action.kind === 'text') return action.value;
    return '';
  });
  out = out.replace(WRAP_CANDIDATE, (m, slash: string, name: string) => {
    const action = resolveTealWrap(name);
    if (action === null) return m;
    if (action.kind === 'wrap') return `${TEAL_MARK_START}${slash}${name}${TEAL_MARK_END}`;
    return '';
  });
  return restore(out);
}
```

Note the `(?!\()` guard: `[text](url)` is a Markdown link, never a tag candidate.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/user-client && pnpm vitest run tests/lib/teal/preprocess-teal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/teal/preprocess-teal.ts apps/user-client/tests/lib/teal/preprocess-teal.test.ts
git commit -m "Add TEAL preprocess step"
```

---

### Task 6: rehype-teal plugin (sentinels → styled spans)

**Files:**
- Create: `apps/user-client/src/lib/teal/rehype-teal.ts`
- Test: `apps/user-client/tests/lib/teal/rehype-teal.test.ts`
- Modify (if needed): `apps/user-client/package.json` — add `@types/hast` as devDependency (`pnpm add -D @types/hast --filter user-client`) unless `import type { Root } from 'hast'` already resolves.

- [ ] **Step 1: Write the failing tests** (full unified pipeline, mirrors production order)

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import rehypeStringify from 'rehype-stringify';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';
import { preprocessTeal } from '../../../src/lib/teal/preprocess-teal.js';
import { rehypeTeal } from '../../../src/lib/teal/rehype-teal.js';

function render(md: string): string {
  return unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeTeal)
    .use(rehypeStringify)
    .processSync(preprocessTeal(md))
    .toString();
}

describe('rehypeTeal', () => {
  it('wraps whisper ranges in a classed span', () => {
    expect(render('a <whisper>secret</whisper> b')).toBe(
      '<p>a <span class="teal-whisper">secret</span> b</p>',
    );
  });

  it('nests wraps as combined classes on the inner text', () => {
    // No empty spans for the zero-length outer segments; the wrapped text
    // carries BOTH classes.
    expect(render('<soft><emphasis>word</emphasis></soft>')).toBe(
      '<p><span class="teal-italic teal-bold">word</span></p>',
    );
  });

  it('styles across element boundaries and to the end when unclosed', () => {
    const html = render('<whisper>one\n\ntwo');
    expect(html).toContain('<p><span class="teal-whisper">one</span></p>');
    expect(html).toContain('<p><span class="teal-whisper">two</span></p>');
  });

  it('does not touch code blocks', () => {
    const html = render('```\n<whisper>x</whisper>\n```');
    expect(html).toContain('&#x3C;whisper>x&#x3C;/whisper>');
    expect(html).not.toContain('teal-whisper');
  });

  it('removes an orphan close tag without styling anything', () => {
    expect(render('hi</whisper> there')).toBe('<p>hi there</p>');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/user-client && pnpm vitest run tests/lib/teal/rehype-teal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import type { Element, ElementContent, Root, Text } from 'hast';
import { TEAL_MARK_END, TEAL_MARK_START } from './preprocess-teal.js';
import { resolveTealWrap } from './teal-render-map.js';

/**
 * Rehype plugin: converts TEAL sentinel markers (emitted by preprocessTeal)
 * into styled spans. Walks text nodes in document order with ONE active-class
 * stack for the whole tree, so a wrap spanning paragraphs styles every
 * paragraph and an unclosed wrap styles progressively to the end — which is
 * exactly the live-streaming semantic. Skips code/pre subtrees. Orphan or
 * mismatched markers are removed without effect.
 */
const MARKER = new RegExp(`${TEAL_MARK_START}(/?)([a-z-]+)${TEAL_MARK_END}`, 'g');

export function rehypeTeal() {
  return (tree: Root): void => {
    const active: string[] = [];

    const wrapSegment = (value: string): ElementContent => {
      if (active.length === 0) return { type: 'text', value } satisfies Text;
      return {
        type: 'element',
        tagName: 'span',
        properties: { className: [...new Set(active)] },
        children: [{ type: 'text', value }],
      } satisfies Element;
    };

    const transformText = (node: Text): ElementContent[] => {
      const out: ElementContent[] = [];
      let last = 0;
      MARKER.lastIndex = 0;
      for (let m = MARKER.exec(node.value); m !== null; m = MARKER.exec(node.value)) {
        const before = node.value.slice(last, m.index);
        if (before.length > 0) out.push(wrapSegment(before));
        last = m.index + m[0].length;
        const closing = m[1] === '/';
        const action = resolveTealWrap(m[2] ?? '');
        if (action === null || action.kind !== 'wrap') continue; // orphan/silent: marker just vanishes
        if (closing) {
          const idx = active.lastIndexOf(action.className);
          if (idx >= 0) active.splice(idx, 1);
        } else {
          active.push(action.className);
        }
      }
      const rest = node.value.slice(last);
      if (rest.length > 0) out.push(wrapSegment(rest));
      return out;
    };

    const visit = (node: Root | Element): void => {
      if (node.type === 'element' && (node.tagName === 'code' || node.tagName === 'pre')) return;
      const children = node.children;
      const next: ElementContent[] = [];
      for (const child of children) {
        if (child.type === 'text') {
          next.push(...transformText(child));
        } else {
          if (child.type === 'element') visit(child);
          next.push(child);
        }
      }
      node.children = next as Root['children'] & Element['children'];
    };

    visit(tree);
  };
}
```

Implementation notes for the engineer:
- If the `node.children = next as …` cast fights the hast types, assign via `node.children.splice(0, node.children.length, ...next)` or type the visitor on a narrowed `Parents` union — keep it `strict`-clean WITHOUT `any` and WITHOUT non-null `!` (Biome bans it).
- A wrap whose segment is empty must not emit an empty span (the `before.length > 0` / `rest.length > 0` guards do this).
- `[...new Set(active)]` dedupes `teal-bold teal-bold` when `<loud>` nests inside `<emphasis>`.

- [ ] **Step 4: Run tests; pin the nesting assertion to the real output**

Run: `cd apps/user-client && pnpm vitest run tests/lib/teal/rehype-teal.test.ts`
Expected: PASS after pinning the exact expected HTML strings (structural requirements unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/teal/rehype-teal.ts apps/user-client/tests/lib/teal/rehype-teal.test.ts apps/user-client/package.json pnpm-lock.yaml
git commit -m "Add rehype-teal sentinel-to-span plugin"
```

---

### Task 7: Wire TEAL into MarkdownContent + CSS

**Files:**
- Modify: `apps/user-client/src/components/chat/markdown/MarkdownContent.tsx` (lines 13-19)
- Modify: `apps/user-client/src/index.css` (after the `.msg-text .katex-display` block, ~line 690)
- Test: `apps/user-client/tests/unit/markdown-teal.test.tsx`

- [ ] **Step 1: Write the failing component test**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownContent } from '../../src/components/chat/markdown/MarkdownContent.js';

describe('MarkdownContent — TEAL rendering', () => {
  it('renders inline tags as emoji', () => {
    render(<MarkdownContent text="Hello [laugh] there" />);
    expect(screen.getByText(/Hello 😄 there/)).toBeTruthy();
  });

  it('renders whisper as a classed span', () => {
    const { container } = render(<MarkdownContent text="a <whisper>secret</whisper> b" />);
    const span = container.querySelector('span.teal-whisper');
    expect(span?.textContent).toBe('secret');
  });

  it('leaves code blocks untouched', () => {
    const { container } = render(<MarkdownContent text={'```\n[laugh]\n```'} />);
    expect(container.textContent).toContain('[laugh]');
    expect(container.textContent).not.toContain('😄');
  });

  it('keeps unknown tags literal', () => {
    const { container } = render(<MarkdownContent text="see [snort] and [1]" />);
    expect(container.textContent).toContain('[snort]');
    expect(container.textContent).toContain('[1]');
  });
});
```

(If MarkdownContent needs a provider in tests, copy the wrapper pattern from `tests/unit/markdown-table-overflow.test.tsx`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/unit/markdown-teal.test.tsx`
Expected: FAIL — no emoji, no `.teal-whisper` span.

- [ ] **Step 3: Integrate in MarkdownContent.tsx**

```typescript
import { preprocessTeal } from '../../../lib/teal/preprocess-teal.js';
import { rehypeTeal } from '../../../lib/teal/rehype-teal.js';
// ...
const rehypePlugins: PluggableList = [[rehypeKatex, { throwOnError: false }], rehypeTeal];
// ...
  const processed = useMemo(() => preprocessMath(preprocessTeal(text)), [text]);
```

(rehypeTeal runs AFTER rehype-katex so maths output is never re-walked into spans; preprocessTeal runs before preprocessMath — both mask code, order between them is otherwise free.)

- [ ] **Step 4: Add the presentation classes to index.css**

```css
/* TEAL — expression rendering (spec 2026-06-11 §4.3). Shared by the
   finalised Markdown path (.msg-text) and the live stream (.msg-stream-text). */
.msg-text .teal-italic,
.msg-stream-text .teal-italic {
  font-style: italic;
}
.msg-text .teal-whisper,
.msg-stream-text .teal-whisper {
  font-style: italic;
  opacity: 0.75;
}
.msg-text .teal-bold,
.msg-stream-text .teal-bold {
  font-weight: 600;
}
.msg-text .teal-slow,
.msg-stream-text .teal-slow {
  letter-spacing: 0.08em;
}
.msg-text .teal-singing,
.msg-stream-text .teal-singing {
  font-style: italic;
}
.msg-text .teal-singing::before,
.msg-stream-text .teal-singing::before {
  content: '♪ ';
}
.msg-text .teal-singing::after,
.msg-stream-text .teal-singing::after {
  content: ' ♪';
}
```

(Note: the ♪ pair via CSS means consecutive sibling singing-spans would each carry their own ♪ — acceptable; the rehype plugin emits one span per text segment and singing rarely crosses paragraphs.)

- [ ] **Step 5: Run the test to verify it passes, then the full unit dir**

Run: `cd apps/user-client && pnpm vitest run tests/unit/markdown-teal.test.tsx && pnpm vitest run tests/unit`
Expected: new tests PASS; only the known 8-failure baseline elsewhere.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/chat/markdown/MarkdownContent.tsx apps/user-client/src/index.css apps/user-client/tests/unit/markdown-teal.test.tsx
git commit -m "Render TEAL expressions in the Markdown pipeline"
```

---

### Task 8: Streaming transform (pure chunk state machine)

**Files:**
- Create: `apps/user-client/src/lib/teal/teal-streaming.ts`
- Test: `apps/user-client/tests/lib/teal/teal-streaming.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { transformTealStream } from '../../../src/lib/teal/teal-streaming.js';

const flat = (chunks: string[]) =>
  transformTealStream(chunks).map((spans) => spans.map((s) => `${s.text}|${s.classNames.join('+')}`));

describe('transformTealStream', () => {
  it('replaces complete inline tags inside a chunk', () => {
    expect(flat(['Hello [laugh] there'])).toEqual([['Hello 😄 there|']]);
  });

  it('handles a tag split across chunk boundaries', () => {
    expect(flat(['Hi [lau', 'gh] yes'])).toEqual([['Hi |'], ['😄 yes|']]);
  });

  it('suppresses a half-typed tag at the stream tip', () => {
    expect(flat(['Hello [lau'])).toEqual([['Hello |']]);
    expect(flat(['Hello <whis'])).toEqual([['Hello |']]);
  });

  it('flushes bracket content that can no longer be a tag', () => {
    expect(flat(['see [1] ok'])).toEqual([['see [1] ok|']]);
    expect(flat(['a [this bracketed aside is far too long to ever be an expression tag] b'])).toEqual([
      ['a [this bracketed aside is far too long to ever be an expression tag] b|'],
    ]);
  });

  it('applies wrap classes from the opening tag onwards', () => {
    expect(flat(['a <whisper>b', 'c</whisper> d'])).toEqual([
      ['a |', 'b|teal-whisper'],
      ['c|teal-whisper', ' d|'],
    ]);
  });

  it('keeps unknown tags literal and removes silent ones', () => {
    expect(flat(['x <snort>y</snort> [tongue-click] z'])).toEqual([['x <snort>y</snort>  z|']]);
  });

  it('passes fenced code through untransformed', () => {
    expect(flat(['```\n[laugh]\n``` [laugh]'])).toEqual([['```\n[laugh]\n``` 😄|']]);
  });

  it('passes inline code through untransformed', () => {
    expect(flat(['use `[pause]` now [pause]'])).toEqual([['use `[pause]` now  … |']]);
  });

  it('is stable across appends (earlier chunks render identically)', () => {
    const first = flat(['Hi [lau']);
    const second = flat(['Hi [lau', 'gh]']);
    expect(second[0]).toEqual(first[0]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/user-client && pnpm vitest run tests/lib/teal/teal-streaming.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { resolveTealInline, resolveTealWrap } from './teal-render-map.js';

/**
 * TEAL transform for the LIVE streaming path. MessageBlock renders streaming
 * drafts as raw per-chunk spans (no Markdown), so without this transform tags
 * would flash raw mid-stream. A sequential state machine walks the chunks:
 *
 *   - complete known inline tags are replaced (emoji/typography/silent);
 *   - known wrapping tags toggle active classes carried onto later spans;
 *   - a possibly-incomplete tag at a chunk boundary is carried into the next
 *     chunk; at the very stream tip it is suppressed (no raw flash) — the
 *     finalised Markdown pass settles the text either way;
 *   - fenced code (``` at line start) and inline code spans pass through
 *     untransformed, mirroring the finalised pipeline's code immunity;
 *   - unknown tags stay literal (closed vocabulary).
 *
 * Determinism guarantee: output for chunk N depends only on chunks 0..N, so
 * already-rendered spans never change when new chunks append (stable
 * React keys, no re-fade).
 */
export interface TealStreamSpan {
  text: string;
  classNames: string[];
}

/** Longest text we still treat as a possibly-incomplete tag at a boundary. */
const MAX_CANDIDATE = 40;
const INLINE_RX = /^\[([A-Za-z][A-Za-z\- ]{0,38})\]/;
const WRAP_RX = /^<(\/?)([a-z-]+)>/;
const INLINE_PARTIAL_RX = /^\[[A-Za-z\- ]*$/;
const WRAP_PARTIAL_RX = /^<\/?[a-z-]*$/;

export function transformTealStream(chunks: string[]): TealStreamSpan[][] {
  const result: TealStreamSpan[][] = [];
  const active: string[] = [];
  let carry = ''; // unfinished tag candidate from the previous chunk
  let inFence = false; // inside a ``` fenced block
  let inCode = false; // inside an `inline code` span
  let atLineStart = true;

  for (let c = 0; c < chunks.length; c++) {
    const isLast = c === chunks.length - 1;
    const text = carry + (chunks[c] ?? '');
    carry = '';
    const spans: TealStreamSpan[] = [];
    let plain = '';
    let plainClasses = '';

    // A new span starts only when the effective class set CHANGES — code
    // regions and unstyled text therefore stay one span, and wrap toggles
    // split exactly where the styling changes.
    const effective = (): string => (inFence || inCode ? '' : [...new Set(active)].join(' '));
    const append = (s: string): void => {
      if (s.length === 0) return;
      const cls = effective();
      if (cls !== plainClasses && plain.length > 0) {
        spans.push({ text: plain, classNames: plainClasses === '' ? [] : plainClasses.split(' ') });
        plain = '';
      }
      plainClasses = cls;
      plain += s;
    };

    let i = 0;
    while (i < text.length) {
      const ch = text[i] ?? '';

      // --- code-region tracking (mirrors the finalised pipeline's immunity)
      if (ch === '`' && atLineStart && text.startsWith('```', i)) {
        inFence = !inFence;
        append('```');
        i += 3;
        atLineStart = false;
        continue;
      }
      if (ch === '`' && !inFence) {
        inCode = !inCode;
        append('`');
        i += 1;
        atLineStart = false;
        continue;
      }
      if (inFence || inCode) {
        append(ch);
        atLineStart = ch === '\n';
        i += 1;
        continue;
      }

      // --- tag candidates
      if (ch === '[' || ch === '<') {
        const rest = text.slice(i);
        const m = (ch === '[' ? INLINE_RX : WRAP_RX).exec(rest);
        if (m !== null) {
          if (ch === '[') {
            const action = resolveTealInline(m[1] ?? '');
            if (action === null) append(m[0]);
            else if (action.kind === 'emoji' || action.kind === 'text') append(action.value);
            // silent: nothing
          } else {
            const action = resolveTealWrap(m[2] ?? '');
            if (action === null) append(m[0]);
            else if (action.kind === 'wrap') {
              if (m[1] === '/') {
                const idx = active.lastIndexOf(action.className);
                if (idx >= 0) active.splice(idx, 1);
              } else {
                active.push(action.className);
              }
            }
            // silent: tags vanish, text continues unstyled
          }
          i += m[0].length;
          atLineStart = false;
          continue;
        }
        // No complete tag — possibly incomplete at the end of this text?
        const partialRx = ch === '[' ? INLINE_PARTIAL_RX : WRAP_PARTIAL_RX;
        if (rest.length <= MAX_CANDIDATE && partialRx.test(rest)) {
          if (!isLast) carry = rest; // complete it with the next chunk
          // last chunk: stream tip — suppress the half-typed tag (no raw flash)
          break;
        }
        // Provably not a tag: emit literally.
        append(ch);
        atLineStart = false;
        i += 1;
        continue;
      }

      append(ch);
      atLineStart = ch === '\n';
      i += 1;
    }

    if (plain.length > 0) {
      spans.push({ text: plain, classNames: plainClasses === '' ? [] : plainClasses.split(' ') });
    }
    result.push(spans);
  }
  return result;
}
```

Engineer notes:
- The fence/inline-code handling deliberately emits the backticks as plain text — streaming has always shown raw Markdown; we only need tags inside code to NOT transform (so the finalised render does not "snap" content).
- `noUncheckedIndexedAccess` is on: every indexed access uses `?? ''` / explicit null checks, as above.
- If a test reveals an ordering subtlety (e.g. `flush()` boundaries producing empty leading spans), prefer adjusting `flush()` guards — the contract is the TEST file, especially stability-across-appends.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/user-client && pnpm vitest run tests/lib/teal/teal-streaming.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/teal/teal-streaming.ts apps/user-client/tests/lib/teal/teal-streaming.test.ts
git commit -m "Add TEAL streaming transform"
```

---

### Task 9: Wire the streaming transform into MessageBlock

**Files:**
- Modify: `apps/user-client/src/components/chat/MessageBlock.tsx` (`renderBlocks`, lines 288-310)
- Test: extend `apps/user-client/tests/unit/message-block.test.tsx`

- [ ] **Step 1: Write the failing test** — append inside the `describe('MessageBlock', …)` block. The fixtures (`personaMsg`, `aurum`, `qcWrapper`, `mindspaceStub`) already exist at the top of the file; mirror the streaming test at lines 167-197.

```tsx
it('transforms TEAL tags in streaming drafts', () => {
  const msg = personaMsg({
    contentBlocks: [
      { type: 'text', text: 'Hello [lau' },
      { type: 'text', text: 'gh] <whisper>hi' },
    ],
  });
  const { container } = render(
    <MessageBlock
      message={msg}
      pills={new Map()}
      mindspace={mindspaceStub}
      persona={aurum}
      displayName="Chris"
      expanded={false}
      onToggleExpand={vi.fn()}
      onCopy={vi.fn()}
      onBookmark={vi.fn()}
      isStreamingDraft={true}
    />,
    { wrapper: qcWrapper },
  );
  const text = container.querySelector('.msg-text') as HTMLElement;
  // The split tag completed across the chunk boundary; the wrap styles from
  // its opening tag onwards; no raw markup reaches the DOM.
  expect(text.textContent).toBe('Hello 😄 hi');
  expect(text.textContent).not.toContain('[lau');
  const whisper = container.querySelector('.stream-tok.teal-whisper');
  expect(whisper?.textContent).toBe('hi');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/unit/message-block.test.tsx`
Expected: the new test FAILS (raw tags rendered); existing tests pass.

- [ ] **Step 3: Implement in renderBlocks**

Replace the streaming branch (MessageBlock.tsx lines 295-306) with:

```tsx
      if (isStreamingDraft) {
        const chunkSpans = transformTealStream(
          group.blocks.map((b) => (b as { type: 'text'; text: string }).text),
        );
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: group ordering is stable across token appends (append-only)
          <span className="msg-stream-text" key={`g-${idx}`}>
            {chunkSpans.map((spans, i) =>
              spans.map((s, j) => (
                <span
                  className={
                    s.classNames.length > 0 ? `stream-tok ${s.classNames.join(' ')}` : 'stream-tok'
                  }
                  // biome-ignore lint/suspicious/noArrayIndexKey: transform output is append-stable (earlier chunks render identically), so existing spans keep their key and only fresh ones animate
                  key={`${i}-${j}`}
                >
                  {s.text}
                </span>
              )),
            )}
          </span>
        );
      }
```

Add the import at the top of MessageBlock.tsx:

```typescript
import { transformTealStream } from '../../lib/teal/teal-streaming.js';
```

(Adjust the relative path to the file's actual location depth.)

- [ ] **Step 4: Run the whole message-block file, then the unit dir**

Run: `cd apps/user-client && pnpm vitest run tests/unit/message-block.test.tsx && pnpm vitest run tests/unit`
Expected: all green except the known baseline. The PRE-EXISTING streaming tests (lines 167-197) assert one span per chunk for plain text — plain chunks produce exactly one span each in the transform, so they should still pass; if an assertion counts spans, verify the count logic against transform output before touching the test.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat/MessageBlock.tsx apps/user-client/tests/unit/message-block.test.tsx
git commit -m "Render TEAL expressions in the live streaming path"
```

---

### Task 10: Full gates + documentation

**Files:**
- Modify: `obsidian/STATUS-CLIENT-ONLY.md` (new top entry + `Last updated:` line)

- [ ] **Step 1: Run all gates from the repo root**

```bash
pnpm typecheck --force        # expect 14/14 (never trust a cached pass)
cd packages/llm-unified && bun test && cd ../..
cd apps/user-client && pnpm vitest run && cd ../..   # baseline 8 failures only, zero new
pnpm run build                # expect 9/9
pnpm exec biome check apps/user-client/src/lib/teal apps/user-client/src/components/chat packages/llm-unified/src/teal packages/llm-unified/src/composition.ts
```

Expected: all green. Fix anything that is not; re-run.

- [ ] **Step 2: Update STATUS-CLIENT-ONLY.md**

New top entry (mirror the house style): TEAL landed — what it is (canonical expression language, always-on segment, display rendering), spec/plan links, gate numbers, the Laura/Larissa skip rationale (no flow change; client-only no new egress), and the device-test list from spec §8. Note: **restart `pnpm dev`** before device testing (packages/llm-unified changed — Vite HMR ignores `packages/*`). Update the `Last updated:` line.

- [ ] **Step 3: Commit**

```bash
git add obsidian/STATUS-CLIENT-ONLY.md
git commit -m "Record TEAL expression language in client STATUS [skip ci]"
```

---

## Self-review checklist (run after writing, before execution)

- Spec coverage: §2 vocabulary → Task 1; §3 segment/D8/D9 → Task 2; §4.1-4.3 render map + plugin → Tasks 3, 5, 6, 7; §4.4 streaming → Tasks 8, 9; §4.5 stripTeal → Task 1; §5 storage → no code (tags are message text; nothing persists rendering); §6 translator notes → spec-only by design; §7 tests → per task; §8 manual verification → STATUS entry (Task 10).
- The squash (one feature unit) happens after execution, per ADR 0003 — task commits are worktree-internal.
