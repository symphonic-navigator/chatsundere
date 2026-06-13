# Auto-Read-Aloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A persistent cockpit "voice mode" toggle that auto-reads each newly generated persona reply aloud as it streams, paragraph by paragraph (interleaving inference and TTS), with the glow tracking throughout.

**Architecture:** A single `committedPrefix` view (paragraphs closed by a blank line) drives both the TTS segments and a progressive markdown render. An "auto-read driver" effect inside `useVoicePlayback` watches the streaming draft and feeds an extended XState voice machine (new `streamComplete` flag, `SEGMENTS_UPDATED`/`STREAM_DONE` events, a `waiting` state). The same committed view renders committed paragraphs as final markdown (with glow anchors) while the open tail stays raw, so segment ids and glow anchors align by construction.

**Tech Stack:** TypeScript (strict), React 18, XState v5, Dexie, Zustand, TanStack Query, Vitest, Biome.

**Spec:** `superpowers/specs/2026-06-13-auto-read-aloud-design.md` (read it first).

**Conventions for every task:**
- British English in all code, comments, copy.
- Run `pnpm typecheck --force` and the relevant Vitest suite after each task; the full user-client suite baseline is **8 failures** (Node-26 localStorage) — a 9th means you broke something.
- Restart `pnpm dev` after touching `packages/*` (not needed here — all changes are in `apps/user-client`).
- Commit after each task with a free-form imperative subject; co-author `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Do NOT push, merge, or switch branches.
- Biome bans `!` non-null assertions — use explicit guards.

**Task order is topological over the import graph.** Do them in order.

---

## Task 1: Dexie v24 + settings fields (`autoReadAloud`, `voiceStopHintSeen`)

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (SettingsRow `14-55`, seed `884-907`, version chain after `775-785`)
- Test: `apps/user-client/tests/boot/client-data-db.test.ts` (create if absent; otherwise add to the existing settings/migration test)

- [ ] **Step 1: Write the failing test**

Add to `apps/user-client/tests/boot/client-data-db.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { getClientDataDb, seedBuiltinsIfNeeded } from '../../src/boot/client-data-db.js';

describe('settings: auto-read-aloud fields', () => {
  it('seeds autoReadAloud=false and voiceStopHintSeen=false', async () => {
    await seedBuiltinsIfNeeded();
    const row = await getClientDataDb().settings.get(1);
    expect(row?.autoReadAloud).toBe(false);
    expect(row?.voiceStopHintSeen).toBe(false);
  });
});
```

(If the existing test file imports the DB differently, mirror its import style. If `fake-indexeddb` is already wired globally in the test setup, drop the import line.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/boot/client-data-db.test.ts`
Expected: FAIL — `autoReadAloud` is `undefined`.

- [ ] **Step 3: Add the fields to `SettingsRow`**

In `apps/user-client/src/boot/client-data-db.ts`, inside `SettingsRow` after the `sttOffering` field (line ~52):

```typescript
  /** Voice mode: auto-read each newly generated persona reply aloud as it
   *  streams (behaviour-axis setting — global, persisted). */
  autoReadAloud: boolean;
  /** One-shot: the "voice mode is still on" hint shown the first time the user
   *  stops playback while the mode is on. */
  voiceStopHintSeen: boolean;
```

- [ ] **Step 4: Seed defaults**

In the `db.settings.add({ ... })` seed block (line ~884), after `sttOffering: null,`:

```typescript
        autoReadAloud: false,
        voiceStopHintSeen: false,
```

- [ ] **Step 5: Add the v24 migration**

After the `this.version(23)...` block (line ~785):

```typescript
    // Version 24 — auto-read-aloud. Settings gain the voice-mode toggle and the
    // one-shot stop-hint flag; both default false for existing installs.
    this.version(24).upgrade(async (tx) => {
      await tx
        .table('settings')
        .toCollection()
        .modify((s: Record<string, unknown>) => {
          if (typeof s.autoReadAloud !== 'boolean') s.autoReadAloud = false;
          if (typeof s.voiceStopHintSeen !== 'boolean') s.voiceStopHintSeen = false;
        });
    });
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/boot/client-data-db.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck --force` (from repo root). Expected: PASS.

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/tests/boot/client-data-db.test.ts
git commit -m "Add autoReadAloud + voiceStopHintSeen settings (Dexie v24)"
```

---

## Task 2: `committed-prefix.ts` — the shared committed-prefix helpers

**Files:**
- Create: `apps/user-client/src/lib/voice/committed-prefix.ts`
- Test: `apps/user-client/tests/lib/voice/committed-prefix.test.ts`

These pure functions are the heart of the feature: they compute the stable prefix of a streaming message and segment it. They reuse the existing `segmentMessage` (`lib/voice/segmentation.ts:531`) and mirror the engine's block coalescing (`lib/stream-engine.ts:166-183`).

- [ ] **Step 1: Write the failing tests**

Create `apps/user-client/tests/lib/voice/committed-prefix.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  coalesceBlocks,
  committedSegments,
  committedTextLength,
  splitStreamingContent,
} from '../../../src/lib/voice/committed-prefix.js';
import type { ContentBlock } from '../../../src/boot/client-data-db.js';
import { segmentMessage } from '../../../src/lib/voice/segmentation.js';

const OPTS = { mode: 'paragraph' as const, roleplay: false };
const text = (t: string): ContentBlock => ({ type: 'text', text: t });

describe('coalesceBlocks', () => {
  it('merges adjacent text chunks into one block (matches engine finalisation)', () => {
    expect(coalesceBlocks([text('Hel'), text('lo'), text(' world')])).toEqual([text('Hello world')]);
  });
  it('keeps pills as boundaries between text runs', () => {
    const blocks: ContentBlock[] = [text('a'), text('b'), { type: 'pill', pillId: 'p1' }, text('c')];
    expect(coalesceBlocks(blocks)).toEqual([text('ab'), { type: 'pill', pillId: 'p1' }, text('c')]);
  });
});

describe('committedTextLength (stream running)', () => {
  it('commits nothing while the first paragraph is still open', () => {
    expect(committedTextLength('The fog rolled in', false)).toBe(0);
  });
  it('commits a paragraph once a blank line closes it', () => {
    const t = 'Para one is done.\n\nPara two stil';
    const len = committedTextLength(t, false);
    expect(t.slice(0, len)).toContain('Para one is done.');
    expect(t.slice(0, len)).not.toContain('Para two');
  });
  it('commits everything when streamDone', () => {
    const t = 'Only one open paragraph';
    expect(committedTextLength(t, true)).toBe(t.length);
  });
  it('commits nothing inside an unterminated code fence', () => {
    const t = 'Intro line.\n\n```ts\nconst x = 1';
    const len = committedTextLength(t, false);
    expect(t.slice(0, len)).toContain('Intro line.');
    expect(t.slice(0, len)).not.toContain('const x');
  });
});

describe('splitStreamingContent', () => {
  it('withholds the open trailing paragraph as tailText', () => {
    const r = splitStreamingContent([text('Closed para.\n\nOpen tai')], false);
    expect(r.tailText).toBe('Open tai');
    expect(r.committedBlocks).toEqual([text('Closed para.\n\n')]);
  });
  it('has no tail when the last block is a pill', () => {
    const blocks: ContentBlock[] = [text('done'), { type: 'pill', pillId: 'p1' }];
    const r = splitStreamingContent(blocks, false);
    expect(r.tailText).toBe('');
  });
});

describe('committedSegments', () => {
  it('returns no segments before the first blank line', () => {
    expect(committedSegments([text('still typing the first line')], false, OPTS)).toEqual([]);
  });
  it('segment ids stay stable as the tail grows', () => {
    const a = committedSegments([text('First done.\n\nSecond gro')], false, OPTS);
    const b = committedSegments([text('First done.\n\nSecond growing more.\n\nThird')], false, OPTS);
    expect(a.map((s) => s.segmentId)).toEqual(['0:0']);
    expect(b.slice(0, a.length).map((s) => s.segmentId)).toEqual(a.map((s) => s.segmentId));
  });
  it('equals segmentMessage on the finalised (coalesced) message when streamDone', () => {
    const streamed: ContentBlock[] = [text('One.\n\n'), text('Two.\n\n'), text('Three.')];
    const finalised = coalesceBlocks(streamed); // what the engine persists
    expect(committedSegments(streamed, true, OPTS)).toEqual(segmentMessage(finalised, OPTS));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/user-client && pnpm vitest run tests/lib/voice/committed-prefix.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `committed-prefix.ts`**

Create `apps/user-client/src/lib/voice/committed-prefix.ts`:

```typescript
import type { ContentBlock } from '../../boot/client-data-db.js';
import { type SegmentationOpts, type SpeechSegment, segmentMessage } from './segmentation.js';

/**
 * Merge adjacent same-type text/reasoning blocks exactly as the stream engine
 * does at finalisation (`stream-engine.appendText`/`appendReasoning`), so a
 * streaming buffer's block indices match the finalised message's. Pills are
 * never coalesced — their identity is a structural boundary.
 */
export function coalesceBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if ((b.type === 'text' || b.type === 'reasoning') && last?.type === b.type) {
      out[out.length - 1] = { ...last, text: last.text + b.text };
    } else {
      out.push({ ...b });
    }
  }
  return out;
}

/**
 * Length of the stable prefix of `text`: everything up to the last paragraph
 * closed by a blank line (outside a code fence). The open trailing paragraph —
 * and any unterminated code fence — is withheld. `streamDone` commits all.
 *
 * Mirrors the fence-aware line scan of `segmentation.paragraphRanges`, but
 * reports the commit boundary rather than the ranges.
 */
export function committedTextLength(text: string, streamDone: boolean): number {
  if (streamDone) return text.length;
  let inFence = false;
  let fenceMarker = '';
  let paraStart: number | null = null;
  let fenceStart: number | null = null;
  let committedEnd = 0;
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    const atEnd = i === text.length;
    if (!atEnd && text[i] !== '\n') continue;
    const line = text.slice(lineStart, i);
    const trimmed = line.trim();
    const fenceOpen = /^(```|~~~)/.exec(trimmed);
    if (inFence) {
      if (
        fenceOpen &&
        trimmed.startsWith(fenceMarker) &&
        trimmed.slice(fenceMarker.length).trim() === ''
      ) {
        inFence = false;
        fenceStart = null;
      }
    } else if (fenceOpen) {
      inFence = true;
      fenceMarker = fenceOpen[1] ?? '```';
      if (paraStart === null) paraStart = lineStart;
      fenceStart = lineStart;
    } else if (trimmed === '') {
      if (paraStart !== null) {
        committedEnd = lineStart;
        paraStart = null;
      }
    } else if (paraStart === null) {
      paraStart = lineStart;
    }
    lineStart = i + 1;
  }
  // An unterminated fence withholds everything from its opening line onwards.
  if (inFence && fenceStart !== null) committedEnd = Math.min(committedEnd, fenceStart);
  return committedEnd;
}

export interface StreamingSplit {
  /** Coalesced blocks whose text is fully committed — render as final markdown. */
  committedBlocks: ContentBlock[];
  /** The open trailing text (the still-growing paragraph) — render raw. */
  tailText: string;
}

/**
 * Split a streaming content buffer into its committed prefix (final-markdown
 * renderable, glow-anchorable) and the open tail (raw). With `streamDone`
 * everything is committed and the tail is empty.
 */
export function splitStreamingContent(blocks: ContentBlock[], streamDone: boolean): StreamingSplit {
  const coalesced = coalesceBlocks(blocks);
  if (streamDone || coalesced.length === 0) return { committedBlocks: coalesced, tailText: '' };
  const lastIdx = coalesced.length - 1;
  const last = coalesced[lastIdx];
  if (last === undefined || last.type !== 'text') return { committedBlocks: coalesced, tailText: '' };
  const len = committedTextLength(last.text, false);
  const committedText = last.text.slice(0, len);
  const tailText = last.text.slice(len);
  const committedBlocks = coalesced.slice(0, lastIdx);
  if (committedText.length > 0) committedBlocks.push({ type: 'text', text: committedText });
  return { committedBlocks, tailText };
}

/**
 * The speech segments for the committed prefix of a streaming message. Reuses
 * the existing `segmentMessage` on the committed blocks, so ids/order match the
 * finalised render's anchors by construction.
 */
export function committedSegments(
  blocks: ContentBlock[],
  streamDone: boolean,
  opts: SegmentationOpts,
): SpeechSegment[] {
  return segmentMessage(splitStreamingContent(blocks, streamDone).committedBlocks, opts);
}
```

- [ ] **Step 4: Run to verify passing**

Run: `cd apps/user-client && pnpm vitest run tests/lib/voice/committed-prefix.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck --force`. Expected: PASS.

```bash
git add apps/user-client/src/lib/voice/committed-prefix.ts apps/user-client/tests/lib/voice/committed-prefix.test.ts
git commit -m "Add committed-prefix helpers for streaming auto-read"
```

---

## Task 3: Extend the voice machine (streamComplete, waiting, SEGMENTS_UPDATED, STREAM_DONE)

**Files:**
- Modify: `apps/user-client/src/lib/voice/voice-machine.ts`
- Test: `apps/user-client/tests/lib/voice/voice-machine.streaming.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/lib/voice/voice-machine.streaming.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { voiceMachine, type VoiceDeps } from '../../../src/lib/voice/voice-machine.js';
import type { SpeechSegment } from '../../../src/lib/voice/segmentation.js';

function seg(id: string): SpeechSegment {
  return {
    segmentId: id,
    spokenText: id,
    blockIndex: 0,
    paragraphIndex: Number(id.split(':')[1]),
    ordinalInParagraph: 0,
    charRange: [0, 1],
    voice: 'dialogue',
  };
}

function deps(): VoiceDeps {
  return {
    fetchAudio: vi.fn(async () => new Blob()),
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(),
  };
}

describe('voice machine — streaming', () => {
  it('parks in waiting when the queue drains before the stream is done', async () => {
    const actor = createActor(voiceMachine, { input: { deps: deps() } }).start();
    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0')], startIndex: 0, streamComplete: false });
    await vi.waitFor(() => expect(actor.getSnapshot().matches({ active: { playback: 'waiting' } })).toBe(true));
  });

  it('SEGMENTS_UPDATED wakes it from waiting and plays the next segment', async () => {
    const actor = createActor(voiceMachine, { input: { deps: deps() } }).start();
    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0')], startIndex: 0, streamComplete: false });
    await vi.waitFor(() => expect(actor.getSnapshot().matches({ active: { playback: 'waiting' } })).toBe(true));
    actor.send({ type: 'SEGMENTS_UPDATED', segments: [seg('0:0'), seg('0:1')] });
    await vi.waitFor(() => expect(actor.getSnapshot().context.currentIndex).toBe(1));
  });

  it('STREAM_DONE in waiting ends cleanly (back to idle)', async () => {
    const actor = createActor(voiceMachine, { input: { deps: deps() } }).start();
    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0')], startIndex: 0, streamComplete: false });
    await vi.waitFor(() => expect(actor.getSnapshot().matches({ active: { playback: 'waiting' } })).toBe(true));
    actor.send({ type: 'STREAM_DONE' });
    await vi.waitFor(() => expect(actor.getSnapshot().matches('idle')).toBe(true));
  });

  it('manual path (streamComplete defaulting true) never enters waiting', async () => {
    const actor = createActor(voiceMachine, { input: { deps: deps() } }).start();
    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0')], startIndex: 0 });
    await vi.waitFor(() => expect(actor.getSnapshot().matches('idle')).toBe(true));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/user-client && pnpm vitest run tests/lib/voice/voice-machine.streaming.test.ts`
Expected: FAIL — unknown events / `waiting` state does not exist.

- [ ] **Step 3: Edit the imports and types**

In `voice-machine.ts` line 1, add `not` and `or` are not needed; keep existing import but ensure `assign` present (it is). No import change required.

Extend `VoiceEvent` (lines 34-42): change the `PLAY` member and add two members:

```typescript
export type VoiceEvent =
  | {
      type: 'PLAY';
      messageId: string;
      segments: SpeechSegment[];
      startIndex: number;
      /** false for streaming auto-read (machine may park in `waiting`); defaults
       *  to true for manual playback (the full segment set is known up front). */
      streamComplete?: boolean;
    }
  | { type: 'SEGMENTS_UPDATED'; segments: SpeechSegment[] }
  | { type: 'STREAM_DONE' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'RETRY' }
  | { type: 'SKIP' }
  | { type: 'DISMISS' }
  | { type: 'LEAVE_CHAT' };
```

Add `streamComplete` to `VoiceContext` (lines 44-61), after `prefetched`:

```typescript
  /** false while a streaming reply is still arriving — the machine parks in
   *  `waiting` instead of ending when it runs out of known segments. */
  streamComplete: boolean;
```

- [ ] **Step 4: Edit the `TransportState` type and add `waiting`**

Find the `TransportState` type (exported in this file). Add `'waiting'`:

```typescript
export type TransportState = 'idle' | 'speaking' | 'paused' | 'failed' | 'ended-partial' | 'waiting';
```

- [ ] **Step 5: Add the `streamComplete` guard**

In the `guards: { ... }` block (lines 121-135), add:

```typescript
    streamComplete: ({ context }) => context.streamComplete,
    eventHasNext: ({ context, event }) =>
      event.type === 'SEGMENTS_UPDATED' && context.currentIndex + 1 < event.segments.length,
```

- [ ] **Step 6: Initialise `streamComplete` in context**

In the initial `context` factory (lines 138-147), add `streamComplete: true,` (manual default).

- [ ] **Step 7: Assign `streamComplete` on PLAY**

In the `idle` state's `PLAY` transition `actions` assign block, add:

```typescript
        streamComplete: ({ event }) =>
          event.type === 'PLAY' ? (event.streamComplete ?? true) : true,
```

- [ ] **Step 8: Modify the `playSegment.onDone` end branch**

In the `speaking` state, the `playSegment` invoke's `onDone` currently has two branches (continue-if-hasNext, else idle). Replace the else (natural-end) branch so it parks in `waiting` when the stream is not complete. The `onDone` array becomes:

```typescript
      onDone: [
        {
          guard: 'hasNext',
          target: 'speaking',
          reenter: true,
          actions: assign({ currentIndex: ({ context }) => context.currentIndex + 1 }),
        },
        { guard: 'streamComplete', target: '#voice.idle' },
        { target: 'waiting' },
      ],
```

(Keep the existing `onError` branches unchanged.)

- [ ] **Step 9: Add the `waiting` state**

In the `active.playback` region, alongside `speaking` and `failed`, add a `waiting` state:

```typescript
        waiting: {
          on: {
            SEGMENTS_UPDATED: [
              {
                guard: 'eventHasNext',
                target: 'speaking',
                reenter: true,
                actions: assign({
                  segments: ({ event }) =>
                    event.type === 'SEGMENTS_UPDATED' ? event.segments : [],
                  currentIndex: ({ context }) => context.currentIndex + 1,
                }),
              },
              {
                actions: assign({
                  segments: ({ event }) =>
                    event.type === 'SEGMENTS_UPDATED' ? event.segments : [],
                }),
              },
            ],
            STREAM_DONE: {
              target: '#voice.idle',
              actions: assign({ streamComplete: true }),
            },
          },
        },
```

- [ ] **Step 10: Handle SEGMENTS_UPDATED / STREAM_DONE while speaking (active level)**

On the `active` state node (the parallel state, where `STOP` and `LEAVE_CHAT` already live), add handlers so updates during active playback grow the queue and mark completion:

```typescript
    on: {
      STOP: { target: 'idle', actions: assign({ providerSkips: 0 }) },
      LEAVE_CHAT: { target: 'idle', actions: assign({ providerSkips: 0 }) },
      SEGMENTS_UPDATED: {
        actions: assign({
          segments: ({ event }) => (event.type === 'SEGMENTS_UPDATED' ? event.segments : []),
        }),
      },
      STREAM_DONE: { actions: assign({ streamComplete: true }) },
    },
```

(The `waiting` child's own `SEGMENTS_UPDATED`/`STREAM_DONE` handlers override these while in `waiting`, which is what we want — the child needs to transition, the parent only assigns.)

- [ ] **Step 11: Report `waiting` from `selectTransportState`**

In `selectTransportState` (lines 401-412), add the `waiting` check before the final `return 'speaking'`:

```typescript
  if (snapshot.matches({ active: { playback: 'waiting' } })) return 'waiting';
```

- [ ] **Step 12: Run the streaming tests**

Run: `cd apps/user-client && pnpm vitest run tests/lib/voice/voice-machine.streaming.test.ts`
Expected: PASS (all four).

- [ ] **Step 13: Run the existing voice-machine tests (regression)**

Run: `cd apps/user-client && pnpm vitest run tests/lib/voice/`
Expected: PASS — the manual path is unchanged.

- [ ] **Step 14: Typecheck + commit**

Run: `pnpm typecheck --force`. Expected: PASS.

```bash
git add apps/user-client/src/lib/voice/voice-machine.ts apps/user-client/tests/lib/voice/voice-machine.streaming.test.ts
git commit -m "Extend voice machine with streaming waiting state"
```

---

## Task 4: Auto-read driver inside `useVoicePlayback`

**Files:**
- Modify: `apps/user-client/src/lib/voice/use-voice-playback.ts`
- Test: `apps/user-client/tests/lib/voice/use-voice-playback.autoread.test.ts`

The driver is an effect inside the existing hook so it shares the one machine actor + sink. It observes the stream-manager handle for `chatId` and drives the machine.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/lib/voice/use-voice-playback.autoread.test.ts`. This test mocks the stream-manager store and `resolveTts`, renders the hook, and asserts the dispatched event sequence by spying on the machine via the returned `transportState`/`currentSegmentId`.

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock resolveTts to a successful resolution that returns empty audio.
vi.mock('../../../src/lib/voice/resolve-tts.js', () => ({
  resolveTts: vi.fn(async () => ({
    ok: true,
    fetchAudio: async () => new Blob(),
    voiceLabel: 'Test',
    cacheKeyFor: () => 'k',
  })),
}));

// Controllable fake stream-manager store.
let handle: unknown = null;
const listeners = new Set<() => void>();
vi.mock('../../../src/state/stream-manager.store.js', () => ({
  useStreamManagerStore: Object.assign(
    (selector: (s: { streams: Map<string, unknown> }) => unknown) =>
      selector({ streams: handle ? new Map([['c1', handle]]) : new Map() }),
    { getState: () => ({ streams: handle ? new Map([['c1', handle]]) : new Map() }) },
  ),
}));

import { useVoicePlayback } from '../../../src/lib/voice/use-voice-playback.js';
import type { PersonaRow } from '../../../src/boot/client-data-db.js';

const persona = { id: 'p1', roleplay: false, voice: 'v1', narratorVoice: null } as unknown as PersonaRow;

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('auto-read driver', () => {
  beforeEach(() => {
    handle = null;
  });

  it('does not auto-play when the handle has no committed paragraph yet', async () => {
    handle = { draftMessageId: 'm1', status: 'streaming', contentBuffer: [{ type: 'text', text: 'still typing' }] };
    const { result } = renderHook(() => useVoicePlayback('c1', persona, []), { wrapper });
    // No committed paragraph → stays idle. (autoReadAloud is gated on settings; see note.)
    await act(async () => {});
    expect(result.current.transportState).toBe('idle');
  });
});
```

NOTE for the implementer: the hook reads `autoReadAloud` from `useSettings()`. For this unit test, either (a) also mock `../../../src/data/settings.js` `useSettings` to return `{ data: { autoReadAloud: true, voiceMode: 'paragraph' } }`, or (b) keep the assertion to the no-commit / mode-off cases which do not require a live settings row. Implement at least the **mode-off does not auto-play** and **no committed paragraph does not auto-play** assertions; the full PLAY→SEGMENTS_UPDATED→STREAM_DONE sequence is covered end-to-end by the device test (spec §11) — do not over-invest in mocking the async TTS+audio path here.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/user-client && pnpm vitest run tests/lib/voice/use-voice-playback.autoread.test.ts`
Expected: FAIL — the driver does not exist yet (or import errors until you wire the mocks).

- [ ] **Step 3: Add the driver effect to `use-voice-playback.ts`**

Add imports near the top:

```typescript
import { committedSegments } from './committed-prefix.js';
import { useStreamManagerStore } from '../../state/stream-manager.store.js';
```

Inside `useVoicePlayback`, after the existing `settings` read and `segmentationOpts` memo, add:

```typescript
  const autoReadAloud = settings.data?.autoReadAloud ?? false;
  const handle = useStreamManagerStore((s) => (chatId ? (s.streams.get(chatId) ?? null) : null));
  // Tracks which draft we've started auto-reading, so growth becomes
  // SEGMENTS_UPDATED rather than a fresh PLAY.
  const autoReadRef = useRef<{ draftId: string } | null>(null);
  const wasAutoOnRef = useRef(autoReadAloud);

  // Toggling the mode off silences any current playback (spec §7).
  useEffect(() => {
    if (!autoReadAloud && wasAutoOnRef.current) {
      if (!actor.getSnapshot().matches('idle')) actor.send({ type: 'STOP' });
      autoReadRef.current = null;
    }
    wasAutoOnRef.current = autoReadAloud;
  }, [autoReadAloud, actor]);

  // The driver: translate streaming-draft progress into machine events.
  useEffect(() => {
    if (!autoReadAloud || !persona || !handle) return;
    const draftId = handle.draftMessageId;
    const streamDone = handle.status !== 'streaming';
    const tracked = autoReadRef.current;

    // A new generation superseded the one we were reading → stop and re-arm.
    if (tracked && tracked.draftId !== draftId) {
      if (!actor.getSnapshot().matches('idle')) actor.send({ type: 'STOP' });
      autoReadRef.current = null;
    }

    const segments = committedSegments(handle.contentBuffer, streamDone, segmentationOpts);
    if (segments.length === 0) return; // nothing stable to speak yet

    if (autoReadRef.current === null) {
      // First commit for this draft: resolve TTS, then PLAY with the freshest
      // committed view (the buffer may have grown during the await).
      autoReadRef.current = { draftId };
      void resolveTts(persona).then((resolution) => {
        if (!resolution.ok) {
          autoReadRef.current = null;
          return;
        }
        const live = useStreamManagerStore.getState().streams.get(chatId);
        // The draft must still be the active one and the mode still on.
        if (!live || live.draftMessageId !== draftId) return;
        const done = live.status !== 'streaming';
        const fresh = committedSegments(live.contentBuffer, done, segmentationOpts);
        if (fresh.length === 0) {
          autoReadRef.current = null;
          return;
        }
        resolutionRef.current = resolution;
        lastPlayRef.current = { messageId: draftId, segments: fresh };
        clearOffer();
        if (!actor.getSnapshot().matches('idle')) actor.send({ type: 'STOP' });
        actor.send({
          type: 'PLAY',
          messageId: draftId,
          segments: fresh,
          startIndex: 0,
          streamComplete: done,
        });
        if (done) actor.send({ type: 'STREAM_DONE' });
      });
      return;
    }

    // Subsequent commits → grow the queue; signal completion at stream end.
    actor.send({ type: 'SEGMENTS_UPDATED', segments });
    if (streamDone) actor.send({ type: 'STREAM_DONE' });
  }, [autoReadAloud, persona, handle, chatId, segmentationOpts, actor]);
```

(`resolutionRef`, `lastPlayRef`, `clearOffer` already exist in this hook — reuse them. If `lastPlayRef` is not present in your version, drop that line.)

- [ ] **Step 4: Run to verify passing**

Run: `cd apps/user-client && pnpm vitest run tests/lib/voice/use-voice-playback.autoread.test.ts`
Expected: PASS (the mode-off and no-commit assertions).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck --force`. Expected: PASS.

```bash
git add apps/user-client/src/lib/voice/use-voice-playback.ts apps/user-client/tests/lib/voice/use-voice-playback.autoread.test.ts
git commit -m "Add auto-read driver to useVoicePlayback"
```

---

## Task 5: Progressive markdown commit in `MessageBlock`

**Files:**
- Modify: `apps/user-client/src/components/chat/MessageBlock.tsx`
- Test: `apps/user-client/tests/components/chat/MessageBlock.progressive.test.tsx`

When the machine is auto-reading the streaming draft (`isStreamingDraft && currentMessageId === message.id`), render the committed prefix as markdown (glow-anchored) and the open tail raw. Otherwise behaviour is unchanged.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/components/chat/MessageBlock.progressive.test.tsx`:

```typescript
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MessageBlock } from '../../../src/components/chat/MessageBlock.js';
import type { MessageRow, PersonaRow } from '../../../src/boot/client-data-db.js';

const persona = { id: 'p1', font: 'serif', roleplay: false } as unknown as PersonaRow;
const mindspace = { /* fill from an existing MessageBlock test's fixture */ } as never;

function msg(text: string): MessageRow {
  return {
    id: 'm1',
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [{ type: 'text', text }],
    createdAt: 0,
  } as unknown as MessageRow;
}

describe('MessageBlock progressive commit', () => {
  it('renders the committed prefix as markdown and the open tail as raw stream text', () => {
    const { container } = render(
      <MessageBlock
        message={msg('First paragraph.\n\nSecond still typ')}
        pills={new Map()}
        persona={persona}
        mindspace={mindspace}
        displayName="Me"
        expanded
        onToggleExpand={() => {}}
        onCopy={() => {}}
        onBookmark={() => {}}
        isStreamingDraft
        currentMessageId="m1"
        currentSegmentId="0:0"
        voiceMode="paragraph"
      />,
    );
    // Committed paragraph is anchored for glow.
    expect(container.querySelector('[data-voice-para]')).not.toBeNull();
    // Open tail stays in the raw streaming span.
    expect(container.querySelector('.msg-stream-text')?.textContent).toContain('Second still typ');
  });

  it('uses the raw streaming render when not being auto-read (currentMessageId mismatch)', () => {
    const { container } = render(
      <MessageBlock
        message={msg('First paragraph.\n\nSecond still typ')}
        pills={new Map()}
        persona={persona}
        mindspace={mindspace}
        displayName="Me"
        expanded
        onToggleExpand={() => {}}
        onCopy={() => {}}
        onBookmark={() => {}}
        isStreamingDraft
        currentMessageId={null}
        voiceMode="paragraph"
      />,
    );
    expect(container.querySelector('[data-voice-para]')).toBeNull();
    expect(container.querySelector('.msg-stream-text')?.textContent).toContain('First paragraph.');
  });
});
```

(Copy the `mindspace` fixture from an existing `MessageBlock` test — e.g. `MessageBlock.glow.test.tsx` — so the component renders.)

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/user-client && pnpm vitest run tests/components/chat/MessageBlock.progressive.test.tsx`
Expected: FAIL — no `[data-voice-para]` during streaming (today's raw branch has no anchors).

- [ ] **Step 3: Add the `currentMessageId` prop**

In `MessageBlockProps` (lines 31-70), add (it is already threaded for glow per the spec/RC1 fix; if absent, add it):

```typescript
  /** The message currently driven by the voice machine, or null. When this
   *  equals a streaming draft's id, that draft renders progressively (committed
   *  prefix as markdown, open tail raw). */
  currentMessageId?: string | null;
```

- [ ] **Step 4: Compute the progressive split and adapt the glow memos**

Near the glow memos (lines 175-220), add a derived flag and the split, and make `blockSegments`/`glowByBlockIndex` use the committed blocks when progressive:

```typescript
  import { splitStreamingContent } from '../../lib/voice/committed-prefix.js'; // add to imports at top

  const progressive = p.isStreamingDraft === true && p.currentMessageId === p.message.id;
  const split = useMemo(
    () => (progressive ? splitStreamingContent(p.message.contentBlocks, false) : null),
    [progressive, p.message.contentBlocks],
  );
  // The blocks the glow segments + markdown render are computed on. For a
  // progressive draft, this is the committed prefix (so ids match the machine's
  // committedSegments); otherwise the message's own blocks.
  const renderSourceBlocks = split ? split.committedBlocks : p.message.contentBlocks;
```

Then change the `blockSegments` memo to iterate `renderSourceBlocks` instead of `p.message.contentBlocks`, and the same for `glowByBlockIndex`'s `p.message.contentBlocks` references (use `renderSourceBlocks`). Update their dependency arrays from `p.message.contentBlocks` to `renderSourceBlocks`.

- [ ] **Step 5: Branch the render in `renderBlocks`**

`renderBlocks` is a module function. Thread the progressive split into it. Change its signature to accept `progressiveTail: string | null` and the committed blocks:

At the call site (lines 326-341) change to:

```typescript
          {renderBlocks(
            split ? split.committedBlocks : p.message.contentBlocks,
            p.pills,
            // progressive committed blocks render as MARKDOWN, not raw stream text
            split ? false : p.isStreamingDraft === true,
            p.persona,
            p.mindspace,
            glowByBlockIndex,
          )}
          {split && split.tailText.length > 0 ? (
            <span className="msg-stream-text">
              {transformTealStream([split.tailText]).map((spans, i) =>
                spans.map((s, j) => (
                  <span
                    className={
                      s.classNames.length > 0 ? `stream-tok ${s.classNames.join(' ')}` : 'stream-tok'
                    }
                    // biome-ignore lint/suspicious/noArrayIndexKey: append-stable streaming tail
                    key={`tail-${i}-${j}`}
                  >
                    {s.text}
                  </span>
                )),
              )}
            </span>
          ) : null}
```

Rationale: when `split` is non-null we pass `isStreamingDraft=false` to `renderBlocks` so the committed blocks go through the finalised `<MarkdownContent>` path (with glow), and we append the open tail separately as raw stream-tok spans. When `split` is null, behaviour is exactly as today.

(`transformTealStream` is already imported in `MessageBlock.tsx` line 12.)

- [ ] **Step 6: Run to verify passing**

Run: `cd apps/user-client && pnpm vitest run tests/components/chat/MessageBlock.progressive.test.tsx`
Expected: PASS.

- [ ] **Step 7: Run the existing MessageBlock glow tests (regression)**

Run: `cd apps/user-client && pnpm vitest run tests/components/chat/`
Expected: PASS — finalised and non-progressive rendering unchanged.

- [ ] **Step 8: Typecheck + commit**

Run: `pnpm typecheck --force`. Expected: PASS.

```bash
git add apps/user-client/src/components/chat/MessageBlock.tsx apps/user-client/tests/components/chat/MessageBlock.progressive.test.tsx
git commit -m "Render committed prefix progressively during auto-read"
```

---

## Task 6: `VoiceTransport` `waiting` state ("reading…")

**Files:**
- Modify: `apps/user-client/src/components/chat/VoiceTransport.tsx`
- Test: `apps/user-client/tests/components/chat/VoiceTransport.test.tsx` (add a case)

- [ ] **Step 1: Write the failing test**

Add to (or create) `apps/user-client/tests/components/chat/VoiceTransport.test.tsx`:

```typescript
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { VoiceTransport } from '../../../src/components/chat/VoiceTransport.js';

const noop = () => {};
const base = {
  resumeOffer: null,
  providerSkips: 0,
  onPause: noop, onResume: noop, onStop: noop, onRetry: noop, onSkip: noop,
  onResumePlayback: noop, onStartOver: noop, onDismiss: noop,
};

describe('VoiceTransport waiting', () => {
  it('shows a calm reading… note while waiting (no Pause/Stop)', () => {
    const { getByText, queryByLabelText } = render(<VoiceTransport state="waiting" {...base} />);
    expect(getByText(/reading…/i)).toBeTruthy();
    expect(queryByLabelText('Pause reading')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/user-client && pnpm vitest run tests/components/chat/VoiceTransport.test.tsx`
Expected: FAIL — no "reading…" text.

- [ ] **Step 3: Render the waiting state**

In `VoiceTransport.tsx`, the idle-guard at line 41 returns null when `state === 'idle' && !resumeOffer && providerSkips === 0`. `waiting` is not idle, so the component already renders the `<section>`. Add a block (after the `speaking` block, before `paused`):

```tsx
      {p.state === 'waiting' ? (
        <span className="voice-transport-note" aria-live="polite">
          reading…
        </span>
      ) : null}
```

- [ ] **Step 4: Run to verify passing**

Run: `cd apps/user-client && pnpm vitest run tests/components/chat/VoiceTransport.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck --force`. Expected: PASS.

```bash
git add apps/user-client/src/components/chat/VoiceTransport.tsx apps/user-client/tests/components/chat/VoiceTransport.test.tsx
git commit -m "Show reading… note in voice transport waiting state"
```

---

## Task 7: One-shot first-Stop hint

**Files:**
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx` (the `VoiceTransport` wiring at lines 625-637 and the `voice` binding at 450)
- Modify: `apps/user-client/src/components/chat/VoiceTransport.tsx` (render an optional hint)
- Test: covered by manual verification (device) — the wiring is small and stateful; an automated test would mostly assert plumbing.

- [ ] **Step 1: Add a hint prop to `VoiceTransport`**

In `VoiceTransport.tsx` props, add `stopHint?: boolean` and `onDismissStopHint?: () => void`. Render it (after the section's other notes):

```tsx
      {p.stopHint ? (
        <span className="voice-transport-note">
          Reading stopped — voice mode is still on, so the next reply will read
          itself. Turn it off in the cockpit.
          {p.onDismissStopHint ? (
            <button type="button" className="voice-transport-btn" onClick={p.onDismissStopHint}>
              Got it
            </button>
          ) : null}
        </span>
      ) : null}
```

- [ ] **Step 2: Wire the one-shot in `chat-page.tsx`**

Near the `voice` binding (line 450) add:

```typescript
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const [stopHint, setStopHint] = useState(false);
  const onVoiceStop = useCallback(() => {
    voice.stop();
    if ((settings.data?.autoReadAloud ?? false) && !(settings.data?.voiceStopHintSeen ?? true)) {
      setStopHint(true);
      void updateSettings.mutateAsync({ voiceStopHintSeen: true });
    }
  }, [voice, settings.data?.autoReadAloud, settings.data?.voiceStopHintSeen, updateSettings]);
```

(`useSettings`/`useUpdateSettings` are in `apps/user-client/src/data/settings.ts`; import them. If `settings` is already read in this file, reuse it.)

Then pass to `VoiceTransport` (lines 625-637): change `onStop={voice.stop}` to `onStop={onVoiceStop}`, and add `stopHint={stopHint}` and `onDismissStopHint={() => setStopHint(false)}`.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck --force`. Expected: PASS.

```bash
git add apps/user-client/src/components/chat/VoiceTransport.tsx apps/user-client/src/routes/app/chat/chat-page.tsx
git commit -m "Add one-shot stop hint while voice mode is on"
```

---

## Task 8: Cockpit voice-mode toggle + touch-reachable disabled reason

**Files:**
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx` (control row at 401-413; note pattern at 480-505; props at 34-56)
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx` (thread voice availability into the cockpit)
- Test: `apps/user-client/tests/components/chat/Cockpit.voicemode.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/components/chat/Cockpit.voicemode.test.tsx`. Render `Cockpit` with the existing test fixture (copy from any Cockpit test) and:

```typescript
// 1. With voiceUnavailable='no-voice', the toggle is disabled; tapping it
//    reveals an inline note containing 'voice' and a Settings link/button.
// 2. With voiceUnavailable=null and autoReadAloud=false, clicking the toggle
//    calls onToggleAutoRead(true).
```

Concretely (adapt fixture as needed):

```typescript
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Cockpit } from '../../../src/components/chat/Cockpit.js';
// ...build `baseProps` from an existing Cockpit test fixture...

describe('cockpit voice-mode toggle', () => {
  it('reveals the disabled reason inline on tap (touch-reachable)', () => {
    const { getByLabelText, getByText } = render(
      <MemoryRouter>
        <Cockpit {...baseProps} autoReadAloud={false} voiceUnavailable="no-voice" onToggleAutoRead={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(getByLabelText(/read replies aloud/i));
    expect(getByText(/voice/i)).toBeTruthy();
  });

  it('toggles auto-read when enabled', () => {
    const onToggle = vi.fn();
    const { getByLabelText } = render(
      <MemoryRouter>
        <Cockpit {...baseProps} autoReadAloud={false} voiceUnavailable={null} onToggleAutoRead={onToggle} />
      </MemoryRouter>,
    );
    fireEvent.click(getByLabelText(/read replies aloud/i));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/user-client && pnpm vitest run tests/components/chat/Cockpit.voicemode.test.tsx`
Expected: FAIL — no such control / props.

- [ ] **Step 3: Extend Cockpit props**

In the `interface Props` (lines 34-56) add:

```typescript
  /** Voice-mode (auto-read-aloud) on/off — global setting. */
  autoReadAloud: boolean;
  onToggleAutoRead: (next: boolean) => void;
  /** Why read-aloud is unavailable, or null when a voice is configured.
   *  Mirrors the manual read button's reasons. */
  voiceUnavailable: 'no-provider' | 'no-voice' | null;
```

- [ ] **Step 4: Add navigation + local note state**

Add the import `import { useNavigate } from 'react-router-dom';` and inside the component: `const navigate = useNavigate();` and `const [voiceNote, setVoiceNote] = useState(false);`.

- [ ] **Step 5: Add the toggle button to the control row**

Immediately AFTER the disabled live-voice button (line 412, before the next element), insert:

```tsx
        <button
          type="button"
          className="cockpit-icon-btn"
          data-control="autoread"
          aria-pressed={p.autoReadAloud}
          aria-label={
            p.voiceUnavailable
              ? 'Read replies aloud (no voice configured)'
              : p.autoReadAloud
                ? 'Stop reading replies aloud'
                : 'Read replies aloud'
          }
          // No `disabled` attribute: a disabled button cannot receive the tap
          // that reveals the reason on touch. We gate the action instead.
          data-disabled={p.voiceUnavailable ? 'true' : undefined}
          onClick={() => {
            if (p.voiceUnavailable) {
              setVoiceNote(true);
              return;
            }
            setVoiceNote(false);
            p.onToggleAutoRead(!p.autoReadAloud);
          }}
        >
          <span className="speaker-icon" aria-hidden="true">
            {p.autoReadAloud ? '🔊' : '🔈'}
          </span>
        </button>
```

(Use whatever glyph/icon convention the cockpit already uses; the `wave-icon ≈` pattern at line 408 is the reference. The styling pass will finalise the icon — keep it a plain glyph for now.)

- [ ] **Step 6: Render the touch-reachable note**

In the note region (near lines 480-505 where `.cockpit-dictation-note` is rendered), add:

```tsx
      {voiceNote && p.voiceUnavailable ? (
        <div className="cockpit-dictation-note" role="status">
          <span>
            {p.voiceUnavailable === 'no-provider'
              ? 'No voice yet — set up a voice provider to read replies aloud.'
              : 'No voice yet — give this companion a voice to read replies aloud.'}
          </span>
          <button type="button" onClick={() => navigate('/app/settings')}>
            Settings → Voice
          </button>
        </div>
      ) : null}
```

- [ ] **Step 7: Thread props from `chat-page.tsx`**

The `Cockpit` is rendered inside `InteractionMode` (chat-page lines 179-194 / 719-742). Thread three new props down: `autoReadAloud`, `onToggleAutoRead`, `voiceUnavailable`.

In `chat-page.tsx`, derive them near the `voice` binding (line 450):

```typescript
  const autoReadAloud = settings.data?.autoReadAloud ?? false;
  const onToggleAutoRead = useCallback(
    (next: boolean) => void updateSettings.mutateAsync({ autoReadAloud: next }),
    [updateSettings],
  );
  // voice.disabledReason is 'no-provider' | 'no-voice' | null (use-voice-playback).
  const voiceUnavailable = voice.disabledReason;
```

Pass `autoReadAloud={autoReadAloud}`, `onToggleAutoRead={onToggleAutoRead}`, `voiceUnavailable={voiceUnavailable}` through `InteractionMode` to `Cockpit`. (Add the same three props to `InteractionMode`'s prop type and forward them.)

- [ ] **Step 8: Run the test + typecheck**

Run: `cd apps/user-client && pnpm vitest run tests/components/chat/Cockpit.voicemode.test.tsx`
Expected: PASS.
Run: `pnpm typecheck --force`. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/user-client/src/components/chat/Cockpit.tsx apps/user-client/src/routes/app/chat/chat-page.tsx apps/user-client/tests/components/chat/Cockpit.voicemode.test.tsx
git commit -m "Add cockpit voice-mode toggle with touch-reachable disabled reason"
```

---

## Task 9: Touch-reachable disabled reason for the manual read button

**Files:**
- Modify: `apps/user-client/src/components/chat/MessageControls.tsx` (read button 86-99, tones 26-33)
- Test: `apps/user-client/tests/components/chat/MessageControls.test.tsx` (add a case)

Today the read button is `disabled` + `title` only — invisible on touch. Make tapping a disabled read button reveal its reason inline (no navigation needed here; the reasons already say where to go).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MessageControls } from '../../../src/components/chat/MessageControls.js';
// ...build props from existing fixture; message.role='persona'...

describe('manual read button disabled reason (touch)', () => {
  it('reveals the reason inline on tap when disabled', () => {
    const { getByText, queryByText } = render(
      <MessageControls {...props} onReadAloud={() => {}} readDisabledReason="no-voice" />,
    );
    expect(queryByText(/voice/i)).toBeNull();
    fireEvent.click(getByText(/read/i));
    expect(getByText(/voice/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/user-client && pnpm vitest run tests/components/chat/MessageControls.test.tsx`
Expected: FAIL — tapping a disabled button does nothing; no inline reason.

- [ ] **Step 3: Make the read button reveal its reason on tap**

Replace the read button (lines 86-99). Do not use the `disabled` attribute (so the tap registers); gate the action and reveal the reason inline:

```tsx
      {p.message.role === 'persona' ? (
        <>
          <button
            type="button"
            data-ctrl="read"
            data-disabled={p.readDisabledReason ? 'true' : undefined}
            aria-disabled={p.readDisabledReason ? true : undefined}
            onClick={() => {
              if (p.readDisabledReason) {
                setReadNote(true);
                return;
              }
              setReadNote(false);
              p.onReadAloud?.();
            }}
            title={
              p.readDisabledReason ? READ_TOOLTIP[p.readDisabledReason] : 'Read this message aloud'
            }
            className="ctrl-btn"
          >
            ▸ Read
          </button>
          {readNote && p.readDisabledReason ? (
            <span className="ctrl-note" role="status">
              {READ_TOOLTIP[p.readDisabledReason]}
            </span>
          ) : null}
        </>
      ) : null}
```

Add `const [readNote, setReadNote] = useState(false);` at the top of the component. (`READ_TOOLTIP` already exists at lines 26-33.) The `.ctrl-note` class can reuse existing small-note styling; the styling pass finalises it.

- [ ] **Step 4: Run to verify passing + regression**

Run: `cd apps/user-client && pnpm vitest run tests/components/chat/MessageControls.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck --force`. Expected: PASS.

```bash
git add apps/user-client/src/components/chat/MessageControls.tsx apps/user-client/tests/components/chat/MessageControls.test.tsx
git commit -m "Make manual read button disabled reason touch-reachable"
```

---

## Task 10: Wire `currentMessageId` to `MessageBlock` + final integration gate

**Files:**
- Modify: `apps/user-client/src/components/chat/ChatStream.tsx` (threads voice props to `MessageBlock`)
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx` (passes `voice.currentMessageId` to `ChatStream` — likely already present per the RC1 fix)

- [ ] **Step 1: Confirm `currentMessageId` is threaded**

Check `chat-page.tsx` passes `currentMessageId={voice.currentMessageId}` to `ChatStream`, and `ChatStream` passes `currentMessageId` to `MessageBlock`. The 2026-06-13 glow RC1 fix introduced `selectCurrentMessageId`; verify it reaches `MessageBlock`. If `ChatStream` does not yet forward it to `MessageBlock`, add it:

```typescript
        currentMessageId={p.currentMessageId}
```

next to the existing `currentSegmentId={...}` prop on the `<MessageBlock>` element.

- [ ] **Step 2: Manual smoke in dev**

Run: `cd apps/user-client && pnpm dev`. Configure a read-aloud voice (Settings → Voice). Toggle the cockpit voice mode on. Send a multi-paragraph prompt. Observe: speech starts after the first paragraph closes; committed paragraphs render as markdown with the glow tracking; the open tail stays raw; `VoiceTransport` shows "reading…" when it catches up.

- [ ] **Step 3: Full gate**

Run from repo root:
```bash
pnpm typecheck --force
cd apps/user-client && pnpm vitest run
pnpm run build --force
pnpm biome check .
```
Expected: typecheck clean; vitest at the **8-failure baseline** (no new failures); build clean; biome clean.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Wire currentMessageId for progressive auto-read render"
```

---

## After implementation

- **Laura pre-squash pass (light):** verify the built flow honours the spec's UX intent (touch-reachable disabled reason on the toggle AND the manual read button; "reading…" during waiting; one-shot stop hint).
- **Squash** the ten task commits into one feature commit: `Add auto-read-aloud voice mode` (per ADR 0003 / squash-per-feature). Larissa not required (client-only, no new egress).
- **Device verification (Chris):** spec §11, steps 1-9 + 3a.
- **Update** `obsidian/STATUS-CLIENT-ONLY.md` (Done / Next session) and `Last updated:`.

## Self-review notes (for the implementer)

- **Spec coverage:** Decisions 1-5 → Tasks 8 (toggle, touch reason), 1 (global persisted), 2+3+4 (paragraph-commit interleave), 4 (new-generations-only via the driver targeting the live draft), 2+5 (progressive markdown commit). §7 lifecycle → Task 4 (supersede on new draft; mode-off stops) + Task 7 (stop hint). §6 glow → Task 5. §8 armed/waiting → Task 6. Manual button H1 → Task 9.
- **Type consistency:** `committedSegments(blocks, streamDone, opts)`, `splitStreamingContent(blocks, streamDone)`, `coalesceBlocks(blocks)`, `committedTextLength(text, streamDone)` are used identically in Tasks 2/4/5. The machine event is `SEGMENTS_UPDATED` (not `SEGMENT_UPDATED`) everywhere. `TransportState` gains exactly `'waiting'`.
- **Known soft deferrals (styling pass, not this plan):** graceful fade on "sending is barging" cut; final icon/copy for the toggle and notes; the progressive-typography calm budget (watch on device).
