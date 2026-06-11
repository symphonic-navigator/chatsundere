# Voice Playback Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read-aloud of persona messages with paragraph/sentence interleave modes, an XState playback machine, segment glow, a persistent Dexie LRU audio cache, and Mistral TTS (direct, no proxy) as the first provider.

**Architecture:** llm-unified gains a `serviceKind: 'tts'` module (Mistral `POST /audio/speech`, encoded-blob results, TEAL strip/passthrough hook per offering). The user-client gains a pure segmentation library (the single source of truth for spoken text AND highlight anchors), an XState v5 statechart with prefetch-one-ahead actors, a thin Web Audio sink, a Dexie v21 blob cache, a `VoiceTransport` floating control, and glow wiring via a rehype plugin. Spec: `superpowers/specs/2026-06-11-voice-playback-core-design.md` — read it FIRST; its Decisions table (D1–D15) is binding.

**Tech Stack:** TypeScript strict, XState v5 + `@xstate/react`, Dexie, `Intl.Segmenter`, Web Audio API, Bun test (llm-unified), Vitest (user-client).

---

## House rules for every task (binding)

- **British English** in all code, comments, tests, commit messages.
- TDD: failing test first. Tests live in `apps/user-client/tests/**` (mirroring `src/**`) for the client; `*.test.ts` beside source for llm-unified.
- Run `pnpm typecheck --force` (repo root) before claiming a task done — Turbo caches typecheck, `--force` is mandatory.
- The user-client vitest baseline is **8 pre-existing failures** in `tests/unit/cockpit-draft.test.ts`, `tests/unit/chat-page.test.tsx`, `tests/unit/chat-route.test.tsx` (localStorage-jsdom). Do NOT fix them; zero NEW failures allowed.
- Biome bans non-null `!` — write guards instead.
- Subagents never merge, push, or switch branches.
- Commit per task, imperative subject, co-author tag `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. No `[skip ci]` (these are code commits).

---

### Task 1: llm-unified — `tts` module + Mistral offering

**Files:**
- Create: `packages/llm-unified/src/b64.ts` (extract the private `b64ToBlob` from `src/tti/generate-images.ts:63`)
- Modify: `packages/llm-unified/src/tti/generate-images.ts` (import `b64ToBlob` from `../b64.js`, delete local copy)
- Modify: `packages/llm-unified/src/catalogue/types.ts` (add `TtsOfferingMeta`, `tts?` field on `Offering` — mirror how `tti?: TtiOfferingMeta` is declared)
- Create: `packages/llm-unified/src/tts/synthesise-speech.ts`
- Create: `packages/llm-unified/src/tts/voices.ts`
- Modify: `packages/llm-unified/src/registry.ts` (add `listTtsOfferings` beside `listTtiOfferings`, registry.ts:77-79)
- Modify: `packages/llm-unified/src/providers/mistral.ts` (append the TTS offering)
- Modify: `packages/llm-unified/src/index.ts` (exports)
- Test: `packages/llm-unified/src/tts/synthesise-speech.test.ts`, `packages/llm-unified/src/tts/offerings.test.ts`

- [ ] **Step 1: Write the failing tests**

`synthesise-speech.test.ts` — follow the mocked-fetch pattern of `src/tti/generate-images.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { SpeechSynthesisError, synthesiseSpeech } from './synthesise-speech.js';
import { listTtsVoices } from './voices.js';

const PROVIDER = { baseUrl: 'https://api.mistral.ai/v1', routing: { kind: 'direct' } as const };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('synthesiseSpeech', () => {
  test('POSTs model/input/voice_id, decodes base64 audio_data to an MP3 blob', async () => {
    let captured: { url: string; body: Record<string, unknown>; auth: string | null } | null = null;
    const fetchFn = (async (input: Request | string | URL) => {
      const req = input instanceof Request ? input : new Request(String(input));
      captured = {
        url: req.url,
        body: JSON.parse(await req.text()) as Record<string, unknown>,
        auth: req.headers.get('authorization'),
      };
      // 'abc' base64 → bytes 105, 183
      return jsonResponse({ audio_data: 'abc=' });
    }) as typeof fetch;

    const result = await synthesiseSpeech({
      providerConfig: PROVIDER,
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      upstreamSlug: 'voxtral-mini-tts-2603',
      teal: 'strip',
      text: 'Hello [laugh] there, <whisper>friend</whisper>.',
      voiceId: 'v1',
      fetchFn,
    });

    expect(captured?.url).toBe('https://api.mistral.ai/v1/audio/speech');
    expect(captured?.auth).toBe('Bearer k');
    expect(captured?.body).toEqual({
      model: 'voxtral-mini-tts-2603',
      input: 'Hello there, friend.', // TEAL stripped via the hook
      voice_id: 'v1',
      stream: false,
    });
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.blob.type).toBe('audio/mpeg');
    expect(result.blob.size).toBeGreaterThan(0);
  });

  test('teal passthrough leaves tags in the input', async () => {
    let body: Record<string, unknown> | null = null;
    const fetchFn = (async (input: Request | string | URL) => {
      const req = input instanceof Request ? input : new Request(String(input));
      body = JSON.parse(await req.text()) as Record<string, unknown>;
      return jsonResponse({ audio_data: 'abc=' });
    }) as typeof fetch;
    await synthesiseSpeech({
      providerConfig: PROVIDER,
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      upstreamSlug: 'voxtral-mini-tts-2603',
      teal: 'passthrough',
      text: 'Hello [laugh].',
      voiceId: 'v1',
      fetchFn,
    });
    expect(body?.input).toBe('Hello [laugh].');
  });

  test('non-OK status throws SpeechSynthesisError carrying the status', async () => {
    const fetchFn = (async () => new Response('nope', { status: 429 })) as typeof fetch;
    await expect(
      synthesiseSpeech({
        providerConfig: PROVIDER,
        apiKey: 'k',
        corsProxyUrl: null,
        corsProxyKey: null,
        upstreamSlug: 'voxtral-mini-tts-2603',
        teal: 'strip',
        text: 'x',
        voiceId: 'v1',
        fetchFn,
      }),
    ).rejects.toThrow(SpeechSynthesisError);
  });

  test('missing audio_data throws', async () => {
    const fetchFn = (async () => jsonResponse({})) as typeof fetch;
    await expect(
      synthesiseSpeech({
        providerConfig: PROVIDER,
        apiKey: 'k',
        corsProxyUrl: null,
        corsProxyKey: null,
        upstreamSlug: 'voxtral-mini-tts-2603',
        teal: 'strip',
        text: 'x',
        voiceId: 'v1',
        fetchFn,
      }),
    ).rejects.toThrow('audio_data');
  });
});

describe('listTtsVoices', () => {
  test('paginates /audio/voices and maps id+name', async () => {
    const pages = [
      { items: [{ id: 'a', name: 'Alice' }], page: 1, total_pages: 2 },
      { items: [{ id: 'b', name: 'Bob' }], page: 2, total_pages: 2 },
    ];
    let call = 0;
    const fetchFn = (async () => jsonResponse(pages[call++])) as typeof fetch;
    const voices = await listTtsVoices({
      providerConfig: PROVIDER,
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      fetchFn,
    });
    expect(voices).toEqual([
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' },
    ]);
  });
});
```

`offerings.test.ts` — mirror `src/tti/offerings.test.ts` (same `_resetRegistryForTests` + `registerBuiltinProviders` lifecycle):

```ts
test('mistral voxtral TTS offering is present with teal strip', () => {
  const tts = listTtsOfferings();
  expect(tts.map((o) => `${o.providerId}:${o.upstreamSlug}`)).toEqual([
    'mistral:voxtral-mini-tts-2603',
  ]);
  const offering = tts[0];
  expect(offering?.serviceKind).toBe('tts');
  expect(offering?.tts?.teal).toBe('strip');
  expect(offering?.adapter.kind).toBe('generic');
});
```

- [ ] **Step 2: Run tests, verify they fail** — `cd packages/llm-unified && bun test src/tts/` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/b64.ts`: move the existing `b64ToBlob(b64: string, mime: string): Blob` from `tti/generate-images.ts:63` verbatim, export it; update the tti import.

`catalogue/types.ts` — beside `TtiOfferingMeta`:

```ts
/** Metadata carried by a `serviceKind: 'tts'` offering. */
export interface TtsOfferingMeta {
  displayName: string;
  /**
   * How this provider treats TEAL expression markup in the input text:
   * 'strip' removes the tags before synthesis (provider has no expressive
   * markup support); 'passthrough' sends them verbatim (TEAL v1 is the xAI
   * snapshot, so the future xAI offering passes through natively).
   */
  teal: 'strip' | 'passthrough';
}
```

Add `tts?: TtsOfferingMeta;` to `Offering` exactly where `tti?: TtiOfferingMeta;` sits.

`src/tts/synthesise-speech.ts`:

```ts
import { b64ToBlob } from '../b64.js';
import { stripTeal } from '../teal/teal.js';
import { buildRequest } from '../transport.js';
import type { ProviderConfig } from '../types.js';

const POST_TIMEOUT_MS = 120_000;

export class SpeechSynthesisError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'SpeechSynthesisError';
  }
}

export interface SynthesiseSpeechArgs {
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  upstreamSlug: string;
  teal: 'strip' | 'passthrough';
  text: string;
  voiceId: string;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

export interface SynthesiseSpeechResult {
  blob: Blob;
  mimeType: string;
}

/** Synthesise one speech segment; returns the provider's encoded audio blob (never PCM). */
export async function synthesiseSpeech(args: SynthesiseSpeechArgs): Promise<SynthesiseSpeechResult> {
  const fetchFn = args.fetchFn ?? fetch;
  const input = args.teal === 'strip' ? stripTeal(args.text) : args.text;
  const timeoutSignal = AbortSignal.timeout(POST_TIMEOUT_MS);
  const signal = args.signal ? AbortSignal.any([args.signal, timeoutSignal]) : timeoutSignal;
  const request = buildRequest({
    provider: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    path: '/audio/speech',
    method: 'POST',
    body: { model: args.upstreamSlug, input, voice_id: args.voiceId, stream: false },
  });
  const response = await fetchFn(request, { signal });
  if (!response.ok) {
    throw new SpeechSynthesisError(`TTS upstream ${response.status}`, response.status);
  }
  const payload = (await response.json()) as { audio_data?: unknown };
  if (typeof payload.audio_data !== 'string') {
    throw new SpeechSynthesisError('TTS response missing audio_data', null);
  }
  return { blob: b64ToBlob(payload.audio_data, 'audio/mpeg'), mimeType: 'audio/mpeg' };
}
```

`src/tts/voices.ts` — `listTtsVoices` GETs `/audio/voices?limit=100&offset=<n>` via `buildRequest` (method `'GET'`, no body), loops while `page < total_pages`, maps `items` to `{ id, name }`. Throw `SpeechSynthesisError` on non-OK.

`registry.ts` — beside `listTtiOfferings` (line 77):

```ts
export function listTtsOfferings(): Offering[] {
  return listProviders().flatMap((p) => p.offerings.filter((o) => o.serviceKind === 'tts'));
}
```

`providers/mistral.ts` — append to `offerings` (copy `trust` and the boilerplate profile fields VERBATIM from an existing mistral offering in the same file; only the fields shown here differ):

```ts
{
  canonicalRef: null,
  providerId: 'mistral',
  upstreamSlug: 'voxtral-mini-tts-2603',
  adapter: { kind: 'generic' }, // TTS calls bypass chat adapters entirely
  profile: {
    reasoning: { mode: 'none' },
    toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
    vision: false,
    replayReasoning: false,
  },
  context: { recommended: 0, max: 0 },
  trust: /* copy from the existing mistral LLM offerings */,
  freedomOrientedDeployment: /* copy from the existing mistral LLM offerings */,
  source: 'curated',
  confidence: 'verified',
  serviceKind: 'tts',
  tts: { displayName: 'Voxtral Mini TTS', teal: 'strip' },
},
```

The `registerMistral()` loop only registers adapters for `adapter.kind === 'catalogue'`, so the generic TTS offering needs no loop change — verify by reading it.

`index.ts` — export `synthesiseSpeech`, `SpeechSynthesisError`, `SynthesiseSpeechArgs`, `SynthesiseSpeechResult`, `listTtsVoices`, `TtsVoice`, `listTtsOfferings`, `TtsOfferingMeta`.

- [ ] **Step 4: Run tests** — `bun test` (whole package) → all green, no regressions from the b64 extraction.
- [ ] **Step 5: Commit** — `Add serviceKind tts with Mistral Voxtral offering to llm-unified`

---

### Task 2: user-client — XState dependency + segmentation library

**Files:**
- Modify: `apps/user-client/package.json` (via `cd apps/user-client && pnpm add xstate @xstate/react`)
- Create: `apps/user-client/src/lib/voice/segmentation.ts`
- Test: `apps/user-client/tests/lib/voice/segmentation.test.ts`

- [ ] **Step 1: Add dependencies** — `cd apps/user-client && pnpm add xstate @xstate/react`. Verify `pnpm typecheck --force` still passes before any new code.

- [ ] **Step 2: Write the failing tests**

The segmentation contract (spec §3.2). IMPORTANT INPUT SEMANTICS: `segmentBlock` receives the **same preprocessed source string** the renderer feeds to react-markdown (i.e. AFTER `preprocessTeal` from `src/lib/teal/preprocess-teal.ts` — its PUA sentinels shift offsets, and `charRange` must agree with what the rehype glow plugin sees via node positions). TEAL inline tags like `[laugh]` survive `preprocessTeal` as sentinel-wrapped text; `stripForSpeech` must remove both raw tags and the PUA sentinels.

```ts
import { describe, expect, it } from 'vitest';
import { segmentBlock } from '../../../src/lib/voice/segmentation.js';

const opts = { mode: 'paragraph' as const, roleplay: false };

describe('segmentBlock — paragraph mode', () => {
  it('cuts at blank lines, one segment per paragraph, dialogue voice', () => {
    const src = 'First paragraph here.\n\nSecond paragraph follows on.';
    const segs = segmentBlock(src, 0, opts);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({
      segmentId: '0:0',
      blockIndex: 0,
      paragraphIndex: 0,
      voice: 'dialogue',
      spokenText: 'First paragraph here.',
    });
    expect(segs[1]?.paragraphIndex).toBe(1);
    // charRange points back into src
    const [s, e] = segs[1]?.charRange ?? [0, 0];
    expect(src.slice(s, e)).toBe('Second paragraph follows on.');
  });

  it('drops segments that are empty after stripping (code-only paragraph)', () => {
    const src = 'Spoken bit.\n\n```ts\nconst x = 1;\n```\n\nMore speech.';
    const segs = segmentBlock(src, 0, opts);
    expect(segs.map((s) => s.spokenText)).toEqual(['Spoken bit.', 'More speech.']);
    // paragraphIndex still counts the skipped paragraph (glow alignment)
    expect(segs[1]?.paragraphIndex).toBe(2);
  });

  it('strips markdown but keeps link labels', () => {
    const src = '## Heading\n\nSee [the docs](https://example.com) for **bold** detail.';
    const segs = segmentBlock(src, 0, opts);
    expect(segs[0]?.spokenText).toBe('Heading');
    expect(segs[1]?.spokenText).toBe('See the docs for bold detail.');
  });

  it('retains TEAL tags in spokenText (canonical text; provider hook strips later)', () => {
    const segs = segmentBlock('Hello [laugh] friend.', 0, opts);
    expect(segs[0]?.spokenText).toContain('[laugh]');
  });
});

describe('segmentBlock — roleplay voice cuts', () => {
  const rp = { mode: 'paragraph' as const, roleplay: true };
  it('labels *asterisk narration* narrator and the rest dialogue, in order', () => {
    const segs = segmentBlock('*She smiles warmly.* Welcome back, traveller.', 0, rp);
    expect(segs.map((s) => [s.voice, s.spokenText])).toEqual([
      ['narrator', 'She smiles warmly.'],
      ['dialogue', 'Welcome back, traveller.'],
    ]);
  });
  it('outside roleplay, single asterisks are emphasis: stripped, dialogue voice', () => {
    const segs = segmentBlock('*She smiles.* Hello.', 0, opts);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.voice).toBe('dialogue');
    expect(segs[0]?.spokenText).toBe('She smiles. Hello.');
  });
});

describe('segmentBlock — sentence mode', () => {
  const sm = { mode: 'sentence' as const, roleplay: false };
  it('splits within a paragraph via Intl.Segmenter and merges short fragments', () => {
    const src =
      'This is the first reasonably long sentence of the reply. Short. ' +
      'And this is the third sentence, also comfortably long enough.';
    const segs = segmentBlock(src, 0, sm);
    // 'Short.' (6 chars < 30) merges forward into the next sentence
    expect(segs).toHaveLength(2);
    expect(segs[1]?.spokenText).toBe(
      'Short. And this is the third sentence, also comfortably long enough.',
    );
  });
  it('segment ids stay stable and ordered across paragraphs', () => {
    const segs = segmentBlock('One full sentence long enough to stand alone here.\n\nAnother one, equally long enough to stand alone.', 0, sm);
    expect(segs.map((s) => s.segmentId)).toEqual(['0:0', '0:1']);
  });
});
```

- [ ] **Step 3: Run, verify FAIL** — `cd apps/user-client && pnpm vitest run tests/lib/voice/segmentation.test.ts`

- [ ] **Step 4: Implement `segmentation.ts`**

```ts
export interface SpeechSegment {
  /** `${blockIndex}:${ordinal}` — stable addressing, tap-to-replay-ready. */
  segmentId: string;
  spokenText: string;
  blockIndex: number;
  /** Nth blank-line-separated paragraph within the block (skipped ones count). */
  paragraphIndex: number;
  /** Range in the (preprocessed) block source — the glow layer matches node positions against this. */
  charRange: [number, number];
  voice: 'dialogue' | 'narrator';
}

export interface SegmentationOpts {
  mode: 'paragraph' | 'sentence';
  roleplay: boolean;
}
```

Implementation outline (pure functions, no I/O):

1. **Mask code first** so blank lines inside fences never split paragraphs: reuse the shared code-mask from the TEAL work (`src/lib/teal/code-mask.ts` — check its exact export with `rg 'export' src/lib/teal/code-mask.ts`; it masks fenced + inline code with placeholder chars of identical length, preserving offsets).
2. **Paragraph split** on the masked text: regex `/\n{2,}/g` over the masked string, recording `[start, end)` offsets of each paragraph in the ORIGINAL string (identical offsets — masking is length-preserving).
3. Per paragraph: **roleplay voice cut** (only when `opts.roleplay`): scan for single-asterisk spans `/(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)/g` on the unmasked paragraph; emit alternating sub-ranges (narrator inside, dialogue outside), preserving order and offsets.
4. Per (sub-)range: **`stripForSpeech(text)`** — order: remove masked-code regions entirely; strip PUA sentinels from `preprocessTeal` (check the sentinel constants exported by `src/lib/teal/preprocess-teal.ts` and remove the sentinel chars only, keeping the visible tag text for inline tags — TEAL tags stay in spokenText per spec D-note, so ONLY remove the invisible sentinels); links `[label](url)` → `label`; images `![alt](url)` → ''; headings `^#{1,6}\s+` → ''; bold/italic markers (`**`, `__`, `*`, `_` — but NOT when roleplay already consumed single `*`); list markers `^\s*([-*+]|\d+\.)\s+`; blockquote `^\s*>\s?`; standalone URLs; emoji (`/\p{Extended_Pictographic}/gu` plus ZWJ/variation selectors); collapse whitespace, trim.
5. **Sentence mode**: within each paragraph (after voice cut), `new Intl.Segmenter(undefined, { granularity: 'sentence' })` over the paragraph source; map each sentence back to offsets (the segmenter yields `index`); compute each sentence's spokenText via `stripForSpeech`; **merge-forward** while effective length < 20 (first) / 30 (subsequent); a trailing short sentence merges backward.
6. Drop segments whose `spokenText` is empty; `segmentId = `${blockIndex}:${ordinal}`` with ordinal counting EMITTED segments.

Also export a convenience `segmentMessage(blocks: ContentBlock[], opts)` that runs `segmentBlock` over each `type: 'text'` block (using the block's index within `contentBlocks` as `blockIndex`, after applying the SAME preprocessing the renderer applies) and flattens. Import `ContentBlock` from `src/lib/content-blocks.ts`. Check how `MessageBlock.tsx` preprocesses text before react-markdown (`rg -n 'preprocessTeal|preprocess' src/components/chat/MessageBlock.tsx src/components/chat/markdown/`) and call the identical chain.

- [ ] **Step 5: Run tests → PASS**, `pnpm typecheck --force` green.
- [ ] **Step 6: Commit** — `Add voice segmentation library (single source of truth)`

---

### Task 3: Dexie v21 + voice cache

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Create: `apps/user-client/src/lib/voice/voice-cache.ts`
- Test: `apps/user-client/tests/lib/voice/voice-cache.test.ts`, extend `apps/user-client/tests/boot/` with a v21 migration test (mirror `client-data-db-v9.test.ts`)

**PRE-CHECK (binding):** run `rg -n "this.version\(" apps/user-client/src/boot/client-data-db.ts | tail -3` — the head MUST be 20. If a parallel feature claimed 21, renumber to the next free version and say so in the commit body.

- [ ] **Step 1: Failing tests**

Migration test: plant a v20 DB (existing test shows the pattern), reopen, assert `settings.voiceMode === 'paragraph'` and personas have `voice: null`, `narratorVoice: null`, and the `voiceAudio` table exists.

Cache test (uses `fake-indexeddb` via the global test setup):

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  cacheGet, cachePut, voiceCacheKey, _voiceCacheOptsForTests,
} from '../../../src/lib/voice/voice-cache.js';

function blobOf(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' });
}

describe('voice cache', () => {
  it('voiceCacheKey is deterministic and voice-scoped', () => {
    const a = voiceCacheKey('hello', 'mistral', 'voxtral-mini-tts-2603', 'v1');
    expect(a).toBe(voiceCacheKey('hello', 'mistral', 'voxtral-mini-tts-2603', 'v1'));
    expect(a).not.toBe(voiceCacheKey('hello', 'mistral', 'voxtral-mini-tts-2603', 'v2'));
  });

  it('get touches lastUsedAt; eviction removes least-recently-used first', async () => {
    _voiceCacheOptsForTests({ maxBytes: 250 });
    await cachePut({ key: 'a', blob: blobOf(100), mimeType: 'audio/mpeg' });
    await cachePut({ key: 'b', blob: blobOf(100), mimeType: 'audio/mpeg' });
    await cacheGet('a'); // a is now fresher than b
    await cachePut({ key: 'c', blob: blobOf(100), mimeType: 'audio/mpeg' }); // 300 > 250 → evict b
    expect(await cacheGet('b')).toBeUndefined();
    expect(await cacheGet('a')).toBeDefined();
    expect(await cacheGet('c')).toBeDefined();
  });
});
```

(`lastUsedAt` ordering needs distinct timestamps — use a monotonic counter fallback: `Math.max(Date.now(), last + 1)` inside the module so same-millisecond writes stay ordered.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

`client-data-db.ts`:
- `SettingsRow` gains `voiceMode: 'paragraph' | 'sentence';`
- `PersonaRow` gains `voice: string | null;` and `narratorVoice: string | null;` (non-optional — let typecheck surface every fixture; the v16 precedent updated 37 persona fixtures, expect the same here, including the default-factory functions).
- New row type:

```ts
export interface VoiceAudioRow {
  key: string;
  blob: Blob;
  mimeType: string;
  bytes: number;
  lastUsedAt: number;
}
```

- Migration:

```ts
this.version(21)
  .stores({ voiceAudio: 'key, lastUsedAt' })
  .upgrade(async (tx) => {
    await tx
      .table('settings')
      .toCollection()
      .modify((s: Record<string, unknown>) => {
        if (s.voiceMode !== 'paragraph' && s.voiceMode !== 'sentence') s.voiceMode = 'paragraph';
      });
    await tx
      .table('personas')
      .toCollection()
      .modify((p: Record<string, unknown>) => {
        if (typeof p.voice !== 'string') p.voice = null;
        if (typeof p.narratorVoice !== 'string') p.narratorVoice = null;
      });
  });
```

`voice-cache.ts`:

```ts
import { getClientDataDb, type VoiceAudioRow } from '../../boot/client-data-db.js';

let OPTS = { maxBytes: 64 * 1024 * 1024 }; // device-tunable
export function _voiceCacheOptsForTests(opts: { maxBytes: number }): void { OPTS = opts; }

/** djb2 over the canonical inputs — collision-safe enough at cache scale, sync, no crypto. */
export function voiceCacheKey(spokenText: string, providerId: string, modelSlug: string, voiceId: string): string {
  const input = `${providerId} ${modelSlug} ${voiceId} ${spokenText}`;
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `${h.toString(16)}:${input.length}`;
}

export async function cacheGet(key: string): Promise<VoiceAudioRow | undefined> { /* get; if hit, update lastUsedAt via touch() */ }
export async function cachePut(row: { key: string; blob: Blob; mimeType: string }): Promise<void> {
  /* put { ...row, bytes: row.blob.size, lastUsedAt: touch() }; then evict:
     rows = await db.voiceAudio.orderBy('lastUsedAt').toArray();
     total = sum(bytes); delete from the front while total > OPTS.maxBytes (never the just-written key). */
}
export async function cacheDelete(key: string): Promise<void> { /* db.voiceAudio.delete(key) */ }
```

- [ ] **Step 4: Run tests + `pnpm typecheck --force`** — fix every persona-fixture error typecheck surfaces.
- [ ] **Step 5: Commit** — `Add Dexie v21 voice settings and LRU audio cache`

---

### Task 4: Audio sink

**Files:**
- Create: `apps/user-client/src/lib/voice/audio-sink.ts`
- Test: none (jsdom has no real audio — spec §7 accepts manual verification; keep the file thin so this is defensible)

- [ ] **Step 1: Implement**

```ts
/** Thin Web Audio wrapper: decode → play → onended. No queue, no state machine. */
export class AudioSink {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;

  private ensureCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  /** Decode and start the blob; resolves when playback of this blob ENDS. Rejects on decode failure. */
  async play(blob: Blob, signal?: AbortSignal): Promise<void> {
    const ctx = this.ensureCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (signal?.aborted) return;
    return new Promise<void>((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => {
        if (this.source === source) this.source = null;
        resolve();
      };
      this.source = source;
      signal?.addEventListener('abort', () => {
        source.onended = null;
        try { source.stop(); } catch { /* already stopped */ }
        resolve();
      }, { once: true });
      source.start();
    });
  }

  /** Sample-accurate freeze — resume continues mid-word (spec D-pause semantics). */
  async pause(): Promise<void> { if (this.ctx?.state === 'running') await this.ctx.suspend(); }
  async resume(): Promise<void> { if (this.ctx?.state === 'suspended') await this.ctx.resume(); }

  stop(): void {
    if (this.source) {
      this.source.onended = null;
      try { this.source.stop(); } catch { /* already stopped */ }
      this.source = null;
    }
  }

  async dispose(): Promise<void> {
    this.stop();
    if (this.ctx) { await this.ctx.close(); this.ctx = null; }
  }
}
```

- [ ] **Step 2: `pnpm typecheck --force` green. Commit** — `Add thin Web Audio sink for voice playback`

---

### Task 5: XState playback machine

**Files:**
- Create: `apps/user-client/src/lib/voice/voice-machine.ts`
- Test: `apps/user-client/tests/lib/voice/voice-machine.test.ts`

The machine is **dependency-injected**: it never imports the sink, cache, or llm-unified directly. Input carries `deps`, so tests drive it with mocks and the React layer wires real ones. ADR 0034 rules apply: timers via `after`, async via actors, no `setTimeout`.

- [ ] **Step 1: Failing tests** (`createActor`, mocked deps; vitest fake timers are unnecessary — no timers in v1):

```ts
import { describe, expect, it, vi } from 'vitest';
import { createActor, waitFor } from 'xstate';
import { voiceMachine, type VoiceDeps } from '../../../src/lib/voice/voice-machine.js';
import type { SpeechSegment } from '../../../src/lib/voice/segmentation.js';

function seg(id: string, text: string): SpeechSegment {
  return { segmentId: id, spokenText: text, blockIndex: 0, paragraphIndex: 0, charRange: [0, 1], voice: 'dialogue' };
}

function makeDeps(overrides: Partial<VoiceDeps> = {}): VoiceDeps {
  return {
    fetchAudio: vi.fn(async () => new Blob(['x'], { type: 'audio/mpeg' })),
    play: vi.fn(async () => {}), // resolves = segment finished
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(),
    ...overrides,
  };
}

describe('voiceMachine', () => {
  it('plays segments in order and returns to idle when done', async () => {
    const deps = makeDeps();
    const actor = createActor(voiceMachine, { input: { deps } });
    actor.start();
    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0', 'a'), seg('0:1', 'b')], startIndex: 0 });
    await waitFor(actor, (s) => s.matches('idle'));
    expect(deps.play).toHaveBeenCalledTimes(2);
  });

  it('exposes currentSegmentId while speaking', async () => {
    let release: () => void = () => {};
    const deps = makeDeps({ play: vi.fn(() => new Promise<void>((r) => { release = r; })) });
    const actor = createActor(voiceMachine, { input: { deps } });
    actor.start();
    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0', 'a')], startIndex: 0 });
    await waitFor(actor, (s) => s.context.currentIndex === 0 && s.matches({ active: { playback: 'speaking' } }));
    expect(actor.getSnapshot().context.segments[0]?.segmentId).toBe('0:0');
    release();
    await waitFor(actor, (s) => s.matches('idle'));
  });

  it('PAUSE freezes, RESUME continues the same segment (no re-fetch)', async () => { /* assert deps.pause/resume called, play NOT re-invoked */ });

  it('STOP aborts the in-flight fetch', async () => {
    const sawAbort = vi.fn();
    const deps = makeDeps({
      fetchAudio: vi.fn((_seg, signal: AbortSignal) =>
        new Promise<Blob>((_resolve, reject) => {
          signal.addEventListener('abort', () => { sawAbort(); reject(new Error('aborted')); });
        })),
    });
    const actor = createActor(voiceMachine, { input: { deps } });
    actor.start();
    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0', 'a')], startIndex: 0 });
    actor.send({ type: 'STOP' });
    await waitFor(actor, (s) => s.matches('idle'));
    expect(sawAbort).toHaveBeenCalled();
  });

  it('fetch failure parks in failed at the segment; RETRY re-fetches; SKIP advances', async () => { /* fetchAudio rejects once for segment 1; assert state failed, context.failedIndex === 1; RETRY → completes; separate run: SKIP → plays segment 2 */ });

  it('prefetches segment n+1 while n is speaking', async () => { /* gate play with a manual release; assert fetchAudio called for index 1 before release of index 0 */ });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** with XState v5 `setup()`:

```ts
import { assign, fromPromise, setup } from 'xstate';
import type { SpeechSegment } from './segmentation.js';

export interface VoiceDeps {
  fetchAudio: (segment: SpeechSegment, signal: AbortSignal) => Promise<Blob>;
  play: (blob: Blob, signal: AbortSignal) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => void;
}

interface Ctx {
  deps: VoiceDeps;
  messageId: string | null;
  segments: SpeechSegment[];
  currentIndex: number;
  failedIndex: number | null;
  prefetched: Map<number, Blob>;
}

type Ev =
  | { type: 'PLAY'; messageId: string; segments: SpeechSegment[]; startIndex: number }
  | { type: 'PAUSE' } | { type: 'RESUME' } | { type: 'STOP' }
  | { type: 'RETRY' } | { type: 'SKIP' } | { type: 'LEAVE_CHAT' };
```

States: `idle` → (PLAY, assign context) → `active`. `active` is a compound state whose child `speaking` invokes a `playSegment` actor (`fromPromise`): it resolves the blob (prefetched map first, else `deps.fetchAudio`), then `deps.play`. `onDone` → `currentIndex + 1 < segments.length ? re-enter speaking : idle` (use `always`/re-target with `reenter: true`). `onError` → `failed` (assign `failedIndex`). A SECOND invoked actor `prefetchNext` runs in parallel inside `active` (either as a parallel region or simply invoked alongside in `speaking`): fetches `currentIndex + 1` into `prefetched` (`assign` on done; swallow errors — the failure will re-surface when that segment actually plays). `PAUSE` (in active) → `paused` with `entry: deps.pause` — IMPORTANT: pausing must NOT cancel the `playSegment` actor, so model pause as a sibling state that does NOT leave `active`'s invoke — use a parallel `gate` region (`running`/`frozen`) and call `deps.pause()`/`deps.resume()` on its transitions, leaving the speaking invoke untouched (the underlying promise simply takes longer because the AudioContext is suspended). `STOP`/`LEAVE_CHAT` (on `active`, `paused`, `failed`) → `idle` with `entry` action `deps.stop()`; invoke cancellation aborts the fetch signal automatically (xstate aborts `fromPromise` signals on state exit — pass that signal through to `fetchAudio`/`play`). `RETRY` (in failed) re-enters speaking at `failedIndex`; `SKIP` advances to `failedIndex + 1` or `idle` if it was the last (the transport surfaces the partial-finish note — UI concern, Task 7).

Export also a pure helper `selectCurrentSegmentId(snapshot): string | null` for the glow layer.

- [ ] **Step 4: Run tests → PASS. Typecheck green.**
- [ ] **Step 5: Commit** — `Add XState voice playback machine with prefetch and failure states`

---

### Task 6: TTS resolver — wiring machine deps to llm-unified + cache

**Files:**
- Create: `apps/user-client/src/lib/voice/resolve-tts.ts`
- Test: `apps/user-client/tests/lib/voice/resolve-tts.test.ts`

- [ ] **Step 1: Failing test** — mock `getClientDataDb` provider rows + `useSessionStore` mk + `openSecret` (follow how existing tests mock the send path; `rg -l "openSecret" apps/user-client/tests/` for the precedent). Assert: (a) no enabled mistral provider row → `{ ok: false, reason: 'no-provider' }`; (b) persona voice null → `{ ok: false, reason: 'no-voice' }`; (c) happy path returns `fetchAudio` that consults the cache first (seed the cache, assert NO network), and on miss calls `synthesiseSpeech` then writes the cache.

- [ ] **Step 2: Implement**

```ts
import { getOffering, getProvider, listTtsOfferings, synthesiseSpeech } from '@chatsundere/llm-unified';
import { openSecret } from /* same module the send path uses — copy its import */;
import { useSessionStore } from /* same module send-message.ts imports it from */;
import { getClientDataDb, type PersonaRow } from '../../boot/client-data-db.js';
import { cacheGet, cachePut, voiceCacheKey } from './voice-cache.js';
import type { SpeechSegment } from './segmentation.js';

export type TtsResolution =
  | { ok: true; fetchAudio: (seg: SpeechSegment, signal: AbortSignal) => Promise<Blob>; voiceLabel: string }
  | { ok: false; reason: 'no-provider' | 'no-voice' };

export async function resolveTts(persona: PersonaRow): Promise<TtsResolution> { ... }
```

Resolution mirrors `resolveSubstituteVision` (`src/data/send-message.ts:236-279`): take the first `listTtsOfferings()` entry (v1 has exactly one), find the enabled `db.providers` row for its `providerId` via `templateId`, decrypt the key with `openSecret(row.apiKey, mk, \`provider/${row.id}/api-key\`)`, build `providerConfig` from `getProvider(...)` (`corsHint === 'requires-proxy' ? { kind: 'cors-proxy' } : { kind: 'direct' }` — mistral is direct, but write it generically). Voice per segment: `seg.voice === 'narrator' ? (persona.narratorVoice ?? persona.voice) : persona.voice` — if `persona.voice` is null → `no-voice`. `fetchAudio` closure: `voiceCacheKey(seg.spokenText, providerId, upstreamSlug, voiceId)` → `cacheGet` (decode failures are handled by the machine layer calling `cacheDelete` — expose the key via a tiny exported helper or accept a second cache miss after the sink rejects; SIMPLEST: wrap `deps.play` failure handling in Task 7's hook: on play rejection, `cacheDelete(key)` and retry once with a fresh synthesis) → miss: `synthesiseSpeech({ ..., teal: offering.tts.teal, text: seg.spokenText, voiceId })` → `cachePut` → return blob.

- [ ] **Step 3: Tests PASS, typecheck green. Commit** — `Add TTS resolver wiring cache and Mistral synthesis to the voice machine`

---

### Task 7: VoiceTransport + read-aloud control + chat-page wiring

**Files:**
- Create: `apps/user-client/src/components/chat/VoiceTransport.tsx`
- Create: `apps/user-client/src/lib/voice/resume-memory.ts`
- Create: `apps/user-client/src/lib/voice/use-voice-playback.ts`
- Modify: `apps/user-client/src/components/chat/MessageControls.tsx` (add the Read control)
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx` (mount transport, LEAVE_CHAT on unmount)
- Modify: `apps/user-client/src/index.css` (transport styling, minimal — Chris does the precise pass)
- Test: `apps/user-client/tests/components/chat/VoiceTransport.test.tsx`, `apps/user-client/tests/lib/voice/resume-memory.test.ts`

Spec bindings: D14 (transport governs, message control only starts), the one-canonical-restart rule, resume-on-return honesty, constructive disabled tooltips, Retry/Skip + partial-finish note on the transport.

- [ ] **Step 1: Failing tests**

`resume-memory.test.ts` — module-level `Map`: `rememberPosition(chatId, { messageId, segmentIndex })`, `takePosition(chatId)` returns and KEEPS (so re-entering twice still offers resume until playback starts), `clearPosition(chatId)` on PLAY-from-start/completion.

`VoiceTransport.test.tsx` — render with a mocked machine snapshot/send (the component receives plain props — `state: 'speaking' | 'paused' | 'failed'`, `onPause/onResume/onStop/onRetry/onSkip`, `resumeOffer: { paragraphLabel } | null`, `onResume(Resume)`, `failedLast: boolean`): asserts (a) nothing renders when state is `idle` and no resume offer; (b) speaking → pause + stop visible; (c) failed → Retry + Skip + the constructive copy; (d) resume offer → `Resume · ¶3` + `Start over`.

- [ ] **Step 2: Implement**

`use-voice-playback.ts` — the hook owning the actor for the chat page:

```ts
import { useActorRef, useSelector } from '@xstate/react';
```

- Creates the actor once per `chatId` (key the actor ref by chatId; recreate on change) with real deps: `fetchAudio` from `resolveTts`, `play/pause/resume/stop` from one `AudioSink` instance per hook lifetime (dispose on unmount). On `play` rejection (decode failure): `cacheDelete(key)` + one re-synthesis retry before surfacing failure (spec §5 cache-decode rule).
- On unmount or `chatId` change: send `LEAVE_CHAT`; if the machine was non-idle, `rememberPosition(chatId, { messageId, segmentIndex: currentIndex })`.
- Exposes `{ state, currentSegmentId, playMessage(messageId, startIndex), pause, resume, stop, retry, skip, resumeOffer }`.
- `playMessage` builds segments via `segmentMessage` (Task 2) from the message's contentBlocks + `settings.voiceMode` + `persona.roleplay`, resolves TTS, sends `PLAY`. On `resolveTts` not-ok the message-level control should already be disabled — but guard anyway (return the reason for the tooltip).

`VoiceTransport.tsx` — presentational, mounted in `chat-page.tsx` inside the `.chat-page` div (sibling of `BottomAffordance`), **`position: absolute`** anchored bottom-centre above the cockpit/affordance — NOT `position: fixed` (the mindspace transform layers clip fixed elements; documented trap, see spec §4). Renders nothing when idle-without-resume-offer. In Interaction Mode it shifts up via a `data-mode` CSS hook (`.chat-page[data-mode='interaction'] .voice-transport { bottom: ... }`).

`MessageControls.tsx` — add a Read control for `role === 'persona'` messages: enabled when TTS resolvable and the message has ≥1 speakable segment; disabled-with-tooltip otherwise (three tones per spec §4: "Set up a TTS provider in My Settings" / "Give this persona a voice in its editor" / "Nothing to read aloud in this message"). Look at how existing controls (star, Save) are structured and follow exactly. Compute "speakable" lazily on first render of the controls (cheap: `segmentMessage(...).length > 0`).

`chat-page.tsx` — instantiate `useVoicePlayback(activeChatId)`, pass `currentSegmentId` down to `ChatStream` → `MessageBlock` (Task 8 consumes it), pass `playMessage` down to `MessageControls`, mount `<VoiceTransport …/>`.

- [ ] **Step 3: Tests PASS; typecheck green; full vitest run — baseline only.**
- [ ] **Step 4: Commit** — `Add voice transport, read-aloud control and chat-page wiring`

---

### Task 8: Glow — paragraph + sentence highlight

**Files:**
- Create: `apps/user-client/src/lib/voice/rehype-voice-anchor.ts`
- Modify: `apps/user-client/src/components/chat/MessageBlock.tsx` (thread `currentSegmentId`; pass anchor plugin; active class)
- Modify: `apps/user-client/src/index.css` (glow styles + `prefers-reduced-motion`)
- Test: `apps/user-client/tests/lib/voice/rehype-voice-anchor.test.ts`, extend `apps/user-client/tests/components/chat/` MessageBlock glow test

This is the riskiest task — read spec §3.2 + §4 carefully. The contract: segmentation (Task 2) and this plugin operate on the SAME preprocessed source string, so `charRange` offsets agree with HAST `node.position.start.offset`.

- [ ] **Step 1: Failing tests** — unified-pipeline unit test: run the same remark/rehype chain MessageBlock uses (find it: `rg -n "rehypeTeal|remarkPlugins|rehypePlugins" src/components/chat/markdown/`) plus `rehypeVoiceAnchor({ segments })` over a two-paragraph source; assert the output HTML carries `data-voice-seg="0:0"` / `data-voice-seg="0:1"` on the two `<p>` elements (paragraph mode), and for sentence mode that spans inside the `<p>` wrap the sentence ranges with the right ids. Component test: render MessageBlock with `currentSegmentId='0:1'` → the second paragraph has class `voice-glow-active`.

- [ ] **Step 2: Implement**

`rehype-voice-anchor.ts` — a rehype plugin receiving `segments: SpeechSegment[]` (for ONE text block):
- **Paragraph mode segments** (charRange spans whole paragraphs): walk top-level element children of the tree root; for each, find the segment whose `charRange` contains the element's `position.start.offset`; set `properties['data-voice-seg'] = segmentId`.
- **Sentence mode segments**: same paragraph match first, then within the matched element walk text nodes (they carry positions); intersect each text node's `[start, end)` with each sentence's `charRange`; split text nodes at boundaries and wrap the intersecting parts in `{ type: 'element', tagName: 'span', properties: { 'data-voice-seg': id } }`. Nodes without position info (synthetic, e.g. TEAL sentinel spans) inherit the enclosing segment of their parent — never crash, degrade to paragraph-level anchoring for that element.
- Mode is detected from the segments themselves (a paragraph whose charRange equals the whole paragraph vs sub-ranges) — or simpler and explicit: the plugin takes `mode` as an option. Take it as an option.

`MessageBlock.tsx` — add the plugin to the rehype chain for text blocks, passing the per-block segments (recompute via `segmentMessage` — memoise with `useMemo` on `[block text, mode, roleplay]`); apply `voice-glow-active` by setting a `data-voice-active` attribute on the wrapper and CSS `[data-voice-active='0:1'] [data-voice-seg='0:1']` — pure CSS matching avoids re-rendering markdown on every segment advance (IMPORTANT for streaming perf; MessageBlock memo notes exist in follow-ups).

CSS:

```css
.msg-text [data-voice-seg] { transition: background-color 600ms ease, box-shadow 600ms ease; border-radius: 4px; }
/* active match via the wrapper attribute set from currentSegmentId */
@media (prefers-reduced-motion: reduce) {
  .msg-text [data-voice-seg] { transition: none; }
}
```

Steady tracking indicator per D15: ONE subtle background tint + soft shadow, fixed intensity, no per-segment randomisation, no transform/layout-affecting properties (no scale — 380 px reflow ban).

- [ ] **Step 3: Tests PASS; typecheck; full vitest baseline-only. Commit** — `Add playback glow anchored to voice segments`

---

### Task 9: Settings — My Settings Voice section + persona voice pickers

**Files:**
- Modify: `apps/user-client/src/routes/app/settings.tsx` (new AccordionCard "Voice")
- Create: `apps/user-client/src/components/voice/VoiceSection.tsx`
- Create: `apps/user-client/src/components/voice/VoicePicker.tsx`
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx` (voice + narratorVoice pickers)
- Test: `apps/user-client/tests/components/voice/VoiceSection.test.tsx`, persona-editor structure test extension

- [ ] **Step 1: Failing tests** — VoiceSection: renders the mode toggle (paragraph/sentence) and fires `useUpdateSettings().mutate({ voiceMode: 'sentence' })` immediately on tap (the `SubstituteVisionSetting` immediate-persist pattern, settings.tsx:78-105); shows the TTS provider state line ("Voxtral Mini TTS via Mistral AI" when an enabled mistral provider row exists, otherwise the constructive add-provider hint). Persona editor: voice picker present; narratorVoice picker rendered ONLY when `draft.roleplay` is true (spec §4), defaulting display to the dialogue voice when null.

- [ ] **Step 2: Implement**

`VoicePicker.tsx` — a small select-like control listing voices from `listTtsVoices` (llm-unified): fetch lazily on first open, memoise module-level (`let voicesPromise: Promise<TtsVoice[]> | null`), resolve the API key exactly like `resolveTts` (reuse it — export a `resolveTtsTransport()` helper from Task 6 returning `{ providerConfig, apiKey, … }` so the picker and the synthesis share resolution). No enabled provider → render disabled with the constructive tooltip. Persist via `patch({ voice: id })` in the editor draft (the editor's existing draft/patch flow — voice fields ride the normal persona save).

Mode toggle in `VoiceSection` follows the persona-editor toggle button pattern (aria-pressed pill, persona-editor.tsx Behaviour section) but writes settings immediately.

- [ ] **Step 3: Tests PASS; typecheck; vitest baseline-only. Commit** — `Add voice settings section and persona voice pickers`

---

### Task 10: Gates, egress log, STATUS

**Files:**
- Modify: `obsidian/insights/security-deferrals.md` (new egress class)
- Modify: `obsidian/STATUS-CLIENT-ONLY.md` (new top entry)

- [ ] **Step 1: Full gates on the integrated tree** (from repo root):
  - `pnpm typecheck --force` → expect **14/14**
  - `cd packages/llm-unified && bun test` → 0 fail
  - `cd apps/user-client && pnpm vitest run` → exactly the 8-failure baseline, zero new
  - `pnpm run build --force` → **9/9**
  - `pnpm biome check apps/user-client/src packages/llm-unified/src` (changed files clean; the known pre-existing `index.css` drift is not ours)
- [ ] **Step 2: Egress note** — append to `security-deferrals.md`: new outbound egress class "persona message text (markdown-stripped) sent to the configured TTS provider on user-initiated read-aloud; segment-grained; rides the existing per-provider key + direct/CORS-proxy routing". Not a Larissa path (client-only, no auth/sync/proxy/crypto code touched) but the egress is logged per house custom.
- [ ] **Step 3: STATUS entry** — done/spec/plan links, gates evidence, the device-test pointer (spec §8, 12 steps, restart `pnpm dev` — packages/* changed — and `pnpm install` once for xstate).
- [ ] **Step 4: Commit** — `Update STATUS and egress log for voice playback core [skip ci]`

---

## Execution notes (for the orchestrating session, not the subagents)

- Isolated worktree (`superpowers:using-git-worktrees`), branch `feature/voice-playback-core`; subagents run serially, one per turn, each on the worktree; verify each subagent's commit actually landed on the branch (detached-HEAD hazard).
- Per-task review: spec review + code-quality review after every task; the reviewer runs the FULL vitest suite, not just the touched directory, and verifies "pre-existing failure" claims against master.
- Final: opus holistic review → Laura pre-squash pass (user-reachable flows changed) → squash to master (one commit: `Add voice playback core — read-aloud, segmentation, cache, Mistral TTS`), verify full-tree capture (`git diff master..branch` empty), typecheck on master, worktree cleanup.
- NOT a Larissa path (client-only; new egress logged in Task 10). Laura pre-squash IS required (new flows/controls).
- Liz must NOT push — Chris pushes the backlog on his word.
