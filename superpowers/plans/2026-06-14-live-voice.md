# Live Voice Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the hands-free, turn-based Live Voice Mode — a stage-metaphor conversation loop (your floor ↔ persona's floor) driven by one large thumb button on the audio toolbar, per [`2026-06-14-live-voice-design`](../specs/2026-06-14-live-voice-design.md).

**Architecture:** A new orchestrator (a small XState v5 floor-machine in `use-live-voice.ts`) sequences the loop *listen → capture → transcribe → send → think → read aloud → listen*, **reusing** the existing primitives: continuous VAD (`capture.ts`), transcription (`resolve-stt.ts`), read-aloud playback (`useVoicePlayback`), and message send (`useSendMessage` via a callback). Two genuinely-new engine pieces: a **redemption-progress signal** (the fill-from-left countdown, a pure `RedemptionTracker` fed by vad-web's `onFrameProcessed`) and **hold-suppresses-submit** (PCM buffering across held segments, WAV-encoded on release). The surface is a sibling `LiveVoiceBar` reusing the audio-toolbar CSS; a store flag drives the cockpit↔live mode switch.

**Tech Stack:** TypeScript (strict), XState v5, `@xstate/react`, React 18, `@ricky0123/vad-web` 0.0.30, Bun/Vitest, Zustand, Dexie (no new persisted settings — reuse `dictationSensitivity` / `dictationRedemptionMs`).

---

## File structure

**New files:**
- `apps/user-client/src/lib/voice/dictation/redemption-tracker.ts` — pure 0→1 silence-countdown tracker (no I/O; unit-tested).
- `apps/user-client/src/lib/voice/live/merge-pcm.ts` — concatenate `Float32Array` PCM chunks (held-merge helper; unit-tested).
- `apps/user-client/src/lib/voice/live/live-voice-machine.ts` — the floor state-chart (DI, mirrors `voice-machine.ts` / `dictation-machine.ts` idioms).
- `apps/user-client/src/lib/voice/live/use-live-voice.ts` — the hook that wires capture + STT + send + playback into the machine.
- `apps/user-client/src/components/chat/LiveVoiceBar.tsx` — the live-mode toolbar surface (big turn button + Hold/Skip + Exit), reusing `.voice-transport` CSS.

**Modified files:**
- `apps/user-client/src/lib/voice/dictation/capture.ts` — add `onRedemptionProgress` to `AudioCaptureCallbacks`; wire vad-web `onFrameProcessed` → `RedemptionTracker` in `startContinuous`.
- `apps/user-client/src/state/current-chat.store.ts` — add `isLiveVoice` flag + `setLiveVoice`.
- `apps/user-client/src/components/chat/Cockpit.tsx` — enable the live button (`data-control="live"`, lines 414-424), wire it to toggle live voice, disabled-with-reason when no voice provider.
- `apps/user-client/src/routes/app/chat/chat-page.tsx` — own `useLiveVoice`; render `LiveVoiceBar` and hide the cockpit when `isLiveVoice` (unless pinned); pinned-cockpit VAD suppression on composer focus.

**Test files:**
- `apps/user-client/tests/lib/voice/dictation/redemption-tracker.test.ts`
- `apps/user-client/tests/lib/voice/live/merge-pcm.test.ts`
- `apps/user-client/tests/lib/voice/live/live-voice-machine.test.ts`
- `apps/user-client/tests/components/chat/LiveVoiceBar.test.tsx`

**Decomposition note (read before starting):** `LiveVoiceBar` is a *sibling* of `VoiceTransport`, not an extension of it — the big turn button is structurally unlike the read-aloud transport, and `VoiceTransport.tsx` is already a large presentational file. Both share the `.voice-transport*` CSS classes and the constant-Exit-right skeleton. The chat page renders **exactly one** of the two: `LiveVoiceBar` while `isLiveVoice`, `VoiceTransport` otherwise. This honours the spec's "the toolbar becomes the sole surface" visually while keeping each component focused.

**Gate before every commit (project rule):** run `pnpm --filter @chatsundere/user-client typecheck` and `pnpm --filter @chatsundere/user-client exec biome check --write src tests`, then the relevant test file. The pre-commit hook runs Biome only — typecheck is yours. Biome bans non-null `!`. British English in every string and comment.

---

## Phase 1 — Capture instrumentation (the fill-from-left signal)

### Task 1: `RedemptionTracker` — the pure countdown

**Files:**
- Create: `apps/user-client/src/lib/voice/dictation/redemption-tracker.ts`
- Test: `apps/user-client/tests/lib/voice/dictation/redemption-tracker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { RedemptionTracker } from '../../../../src/lib/voice/dictation/redemption-tracker.js';

const opts = {
  positiveSpeechThreshold: 0.65,
  negativeSpeechThreshold: 0.5,
  redemptionMs: 960, // 10 frames at 96 ms — round numbers for the test
  frameMs: 96,
};

describe('RedemptionTracker', () => {
  test('stays at 0 before any speech is detected', () => {
    const t = new RedemptionTracker(opts);
    expect(t.frame(0.1)).toBe(0);
    expect(t.frame(0.4)).toBe(0);
  });

  test('fills from 0 to 1 over the redemption window once speech then silence', () => {
    const t = new RedemptionTracker(opts);
    expect(t.frame(0.9)).toBe(0); // speech — resets/holds at 0
    // five silent frames = 480 ms of 960 ms ⇒ 0.5
    let f = 0;
    for (let i = 0; i < 5; i++) f = t.frame(0.1);
    expect(f).toBeCloseTo(0.5, 5);
    // five more ⇒ clamps at 1
    for (let i = 0; i < 5; i++) f = t.frame(0.1);
    expect(f).toBe(1);
    // never exceeds 1
    expect(t.frame(0.1)).toBe(1);
  });

  test('resumed speech resets the fill to 0', () => {
    const t = new RedemptionTracker(opts);
    t.frame(0.9);
    t.frame(0.1);
    t.frame(0.1);
    expect(t.frame(0.9)).toBe(0); // back above the positive threshold ⇒ reset
    expect(t.frame(0.1)).toBeCloseTo(96 / 960, 5);
  });

  test('reset() returns to the pre-speech state', () => {
    const t = new RedemptionTracker(opts);
    t.frame(0.9);
    t.frame(0.1);
    t.reset();
    expect(t.frame(0.1)).toBe(0); // no speech seen since reset ⇒ still 0
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec bun test tests/lib/voice/dictation/redemption-tracker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A pure, frame-driven replica of vad-web's redemption countdown, exposing it
 * as a 0→1 fill the UI can render (vad-web keeps the window internal and emits
 * no progress). Fed one `onFrameProcessed` speech probability per frame.
 *
 * The fill begins only after speech has been seen (so background silence never
 * shows a countdown), advances while frames sit below the negative threshold,
 * and resets to 0 the instant a frame crosses back above the positive
 * threshold (speech resumed). It mirrors the same thresholds passed to
 * `MicVAD.new`, so the fill reaches ~1 just as vad-web fires `onSpeechEnd`.
 */
export interface RedemptionTrackerOptions {
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  redemptionMs: number;
  /** Silero legacy frame duration: 1536 samples @ 16 kHz = 96 ms. */
  frameMs: number;
}

export class RedemptionTracker {
  private speaking = false;
  private silenceMs = 0;

  constructor(private readonly opts: RedemptionTrackerOptions) {}

  /** Feed one frame's speech probability; returns the current fill fraction 0..1. */
  frame(isSpeechProb: number): number {
    if (isSpeechProb >= this.opts.positiveSpeechThreshold) {
      this.speaking = true;
      this.silenceMs = 0;
      return 0;
    }
    if (this.speaking && isSpeechProb < this.opts.negativeSpeechThreshold) {
      this.silenceMs += this.opts.frameMs;
    }
    return this.speaking ? Math.min(1, this.silenceMs / this.opts.redemptionMs) : 0;
  }

  /** Return to the pre-speech state (call on speech-end / session stop). */
  reset(): void {
    this.speaking = false;
    this.silenceMs = 0;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec bun test tests/lib/voice/dictation/redemption-tracker.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/user-client exec biome check --write src tests
git add apps/user-client/src/lib/voice/dictation/redemption-tracker.ts apps/user-client/tests/lib/voice/dictation/redemption-tracker.test.ts
git commit -m "Add RedemptionTracker for live-voice fill-from-left countdown"
```

### Task 2: Wire `onRedemptionProgress` into the capture layer

**Files:**
- Modify: `apps/user-client/src/lib/voice/dictation/capture.ts` (`AudioCaptureCallbacks` ~lines 25-42; `startContinuous` ~lines 271-364; `handleVadSpeechEnd` ~line 393; `stopContinuous` ~line 473)

**Context:** vad-web 0.0.30 `MicVAD.new` accepts `onFrameProcessed: (probs: { isSpeech: number; notSpeech: number }, frame: Float32Array) => void`. Verify the signature against `node_modules/@ricky0123/vad-web` before relying on it. The tracker is reset on speech-end and on stop so a fresh utterance starts the fill from 0.

- [ ] **Step 1: Extend the callbacks interface**

In `AudioCaptureCallbacks` (after `onMisfire`), add:

```ts
  /**
   * Continuous/VAD mode only: the redemption countdown as a 0→1 fraction,
   * emitted per VAD frame once speech has been seen. Drives the live-voice
   * "fill from the left" indicator. 0 means "no countdown" (pre-speech or
   * speech resumed); 1 means "about to auto-submit".
   */
  onRedemptionProgress?: (fraction: number) => void;
```

- [ ] **Step 2: Add a tracker field and import**

At the top of `capture.ts`, add to the imports:

```ts
import { RedemptionTracker } from './redemption-tracker.js';
```

In `class AudioCaptureImpl`, in the VAD state block (near `vadDeliveryPending`), add:

```ts
  private redemptionTracker: RedemptionTracker | null = null;
```

- [ ] **Step 3: Construct the tracker and wire `onFrameProcessed` in `startContinuous`**

Inside `startContinuous`, after `const preset = VAD_PRESETS[options.sensitivity];` and `const MS_PER_FRAME = 96;`, construct the tracker:

```ts
    this.redemptionTracker = new RedemptionTracker({
      positiveSpeechThreshold: preset.positiveSpeechThreshold,
      negativeSpeechThreshold: preset.negativeSpeechThreshold,
      redemptionMs: options.redemptionMs,
      frameMs: MS_PER_FRAME,
    });
```

In the `MicVAD.new({ ... })` options object, add an `onFrameProcessed` handler (the `probabilities` shape is vad-web's `{ isSpeech, notSpeech }`):

```ts
      onFrameProcessed: (probabilities: { isSpeech: number; notSpeech: number }) => {
        const fraction = this.redemptionTracker?.frame(probabilities.isSpeech) ?? 0;
        this.callbacks?.onRedemptionProgress?.(fraction);
      },
```

- [ ] **Step 4: Reset the tracker on speech-end and on stop**

In `handleVadSpeechEnd`, at the top (before building the deliver closure), add:

```ts
    this.redemptionTracker?.reset();
    this.callbacks?.onRedemptionProgress?.(0);
```

In `stopContinuous`, where the other VAD fields are nulled (the block around `this.vad = null;`), add:

```ts
    this.redemptionTracker = null;
```

- [ ] **Step 5: Typecheck, lint**

Run:
```bash
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/user-client exec biome check --write src
```
Expected: clean. (No new unit test here — `capture.ts` is device-verified; the tracker logic is covered by Task 1. Verify on device in Phase 4.)

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/lib/voice/dictation/capture.ts
git commit -m "Emit VAD redemption progress for the live-voice countdown"
```

---

## Phase 2 — The orchestrator (machine + hook)

### Task 3: `mergePcm` — concatenate held PCM chunks

**Files:**
- Create: `apps/user-client/src/lib/voice/live/merge-pcm.ts`
- Test: `apps/user-client/tests/lib/voice/live/merge-pcm.test.ts`

**Context:** "Hold to keep talking" buffers each VAD segment delivered while held and merges them into one utterance on release. Container blobs (Opus/webm) cannot be concatenated, but the 16 kHz mono `pcm: Float32Array` on `CapturedAudio` can — merge the PCM and WAV-encode it via the existing `float32ToWavBlob`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { mergePcm } from '../../../../src/lib/voice/live/merge-pcm.js';

describe('mergePcm', () => {
  test('concatenates in order', () => {
    const out = mergePcm([new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([4, 5])]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });
  test('returns an empty array for no chunks', () => {
    expect(mergePcm([]).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec bun test tests/lib/voice/live/merge-pcm.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Concatenate VAD PCM chunks (16 kHz mono Float32) into one buffer, in order. */
export function mergePcm(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec bun test tests/lib/voice/live/merge-pcm.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/user-client exec biome check --write src tests
git add apps/user-client/src/lib/voice/live/merge-pcm.ts apps/user-client/tests/lib/voice/live/merge-pcm.test.ts
git commit -m "Add mergePcm helper for live-voice hold-to-keep-talking"
```

### Task 4: The live-voice floor machine — types and skeleton

**Files:**
- Create: `apps/user-client/src/lib/voice/live/live-voice-machine.ts`
- Test: `apps/user-client/tests/lib/voice/live/live-voice-machine.test.ts`

**Context:** Study `voice-machine.ts` and `dictation-machine.ts` first — this machine follows the same conventions: `setup({ types, actors, guards })`, dependency injection via `input.deps`, `fromPromise` actors that respect `signal`, and `selectXxx` snapshot selectors at the bottom. This machine owns the **floor** (whose turn) and the **microphone lifecycle**; it does NOT own the AudioSink or read-aloud playback — those are driven by the hook (Task 8) through deps.

The machine's job is the turn loop. Read-aloud of the persona's reply is delegated: the hook calls `deps.startPlayback(messageId)` when the machine enters `personaSpeaking`, and sends `PLAYBACK_DONE` / `PLAYBACK_FAILED` back. Barge sends `deps.stopPlayback()`.

This task lays down the **types and the idle↔listening entry only**; each later task adds one transition with its test (TDD).

- [ ] **Step 1: Write the failing test (initial state + enter/leave)**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { createActor } from 'xstate';
import { type LiveVoiceDeps, liveVoiceMachine, selectFloor } from '../../../../src/lib/voice/live/live-voice-machine.js';

function deps(over: Partial<LiveVoiceDeps> = {}): LiveVoiceDeps {
  return {
    startCapture: () => {},
    stopCapture: () => {},
    transcribe: async () => 'hello',
    sendMessage: () => {},
    startPlayback: () => {},
    stopPlayback: () => {},
    ...over,
  };
}

describe('liveVoiceMachine', () => {
  test('starts idle and enters listening on ENTER, leaving capture armed', () => {
    let started = 0;
    const actor = createActor(liveVoiceMachine, {
      input: { deps: deps({ startCapture: () => { started++; } }) },
    }).start();
    expect(selectFloor(actor.getSnapshot())).toBe('idle');
    actor.send({ type: 'ENTER' });
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
    expect(started).toBe(1);
  });

  test('EXIT stops capture and returns to idle', () => {
    let stopped = 0;
    const actor = createActor(liveVoiceMachine, {
      input: { deps: deps({ stopCapture: () => { stopped++; } }) },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'EXIT' });
    expect(selectFloor(actor.getSnapshot())).toBe('idle');
    expect(stopped).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec bun test tests/lib/voice/live/live-voice-machine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the skeleton (types + idle/listening only)**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { type SnapshotFrom, assign, fromPromise, setup } from 'xstate';

/**
 * The live-voice orchestrator (Spec 3). A floor state-chart: at any moment the
 * floor is the USER's (mic open, VAD listening) or the PERSONA's (mic closed,
 * reading aloud). It owns the floor and the microphone lifecycle; it delegates
 * capture, transcription, send, and playback to injected deps, mirroring the
 * DI discipline of voice-machine.ts / dictation-machine.ts.
 */
export interface LiveVoiceDeps {
  /** Arm continuous VAD capture (the hook wires capture callbacks → machine events). */
  startCapture: () => void;
  /** Tear down VAD capture (mic closes). */
  stopCapture: () => void;
  /** Transcribe a finished utterance. Must respect the signal. */
  transcribe: (pcm: Float32Array, blob: Blob, mimeType: string, signal: AbortSignal) => Promise<string>;
  /** Send a transcribed turn to the persona. */
  sendMessage: (text: string) => void;
  /** Begin reading the persona's reply aloud (the hook drives useVoicePlayback). */
  startPlayback: () => void;
  /** Stop read-aloud (barge / floor-reclaim / exit). */
  stopPlayback: () => void;
}

export type LiveVoiceEvent =
  | { type: 'ENTER' }
  | { type: 'EXIT' }
  | { type: 'HOLD' } // unified pause
  | { type: 'RESUME' }
  | { type: 'SPEECH_START' }
  | { type: 'SPEECH_END'; pcm: Float32Array; blob: Blob; mimeType: string }
  | { type: 'MISFIRE' }
  | { type: 'PROGRESS'; fraction: number } // redemption fill 0..1
  | { type: 'PRESS_START' } // thumb down on the big button
  | { type: 'PRESS_END'; heldMs: number } // thumb up
  | { type: 'TAP' } // a short press resolved by the hook
  | { type: 'CANCEL' } // cancel the in-flight transcription
  | { type: 'BARGE' } // reclaim the floor from the persona
  | { type: 'PLAYBACK_DONE' }
  | { type: 'PLAYBACK_FAILED' }
  | { type: 'STT_FAILED' };

export interface LiveVoiceContext {
  deps: LiveVoiceDeps;
  /** The redemption fill, surfaced to the button while the user's floor is silent. */
  fillFraction: number;
  /** PCM chunks buffered while the thumb holds the button (hold-to-keep-talking). */
  heldPcm: Float32Array[];
  /** True while the big button is physically held. */
  holding: boolean;
}

export interface LiveVoiceInput {
  deps: LiveVoiceDeps;
}

/** Coarse floor state for the UI (one row per Spec §4). */
export type Floor =
  | 'idle'
  | 'listening'
  | 'userSpeaking'
  | 'transcribing'
  | 'personaThinking'
  | 'personaSpeaking'
  | 'held'
  | 'sttFailed';

const transcribe = fromPromise<
  string,
  { deps: LiveVoiceDeps; pcm: Float32Array; blob: Blob; mimeType: string }
>(async ({ input, signal }) => {
  return input.deps.transcribe(input.pcm, input.blob, input.mimeType, signal);
});

export const liveVoiceMachine = setup({
  types: {
    context: {} as LiveVoiceContext,
    events: {} as LiveVoiceEvent,
    input: {} as LiveVoiceInput,
  },
  actors: { transcribe },
}).createMachine({
  id: 'liveVoice',
  context: ({ input }) => ({ deps: input.deps, fillFraction: 0, heldPcm: [], holding: false }),
  initial: 'idle',
  states: {
    idle: {
      on: { ENTER: { target: 'listening' } },
    },
    listening: {
      // Mic is armed on entry to the whole live session; closed on EXIT.
      entry: ({ context }) => context.deps.startCapture(),
      on: {
        EXIT: { target: 'idle', actions: ({ context }) => context.deps.stopCapture() },
      },
    },
  },
});

export type LiveVoiceSnapshot = SnapshotFrom<typeof liveVoiceMachine>;

/** Coarse floor state for the UI. */
export function selectFloor(snapshot: LiveVoiceSnapshot): Floor {
  if (snapshot.matches('idle')) return 'idle';
  if (snapshot.matches('listening')) return 'listening';
  return 'idle';
}

/** The current redemption fill (0..1) for the big button. */
export function selectFill(snapshot: LiveVoiceSnapshot): number {
  return snapshot.context.fillFraction;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec bun test tests/lib/voice/live/live-voice-machine.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/user-client exec biome check --write src tests
git add apps/user-client/src/lib/voice/live/live-voice-machine.ts apps/user-client/tests/lib/voice/live/live-voice-machine.test.ts
git commit -m "Add live-voice floor machine skeleton (idle/listening)"
```

### Task 5: User's floor — speak, fill, submit

Add the user-floor capture path. Each step adds one behaviour with its test (append to the same test file; mirror the existing tests' `deps()` helper).

**Files:** Modify `live-voice-machine.ts` + its test.

- [ ] **Step 1: Tests for the speak→fill→submit path**

Append:

```ts
import { createActor as _ca } from 'xstate'; // (already imported above; keep one import)

describe('liveVoiceMachine — user floor', () => {
  test('SPEECH_START → userSpeaking; PROGRESS updates the fill', () => {
    const actor = createActor(liveVoiceMachine, { input: { deps: deps() } }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    expect(selectFloor(actor.getSnapshot())).toBe('userSpeaking');
    actor.send({ type: 'PROGRESS', fraction: 0.5 });
    expect(selectFill(actor.getSnapshot())).toBe(0.5);
  });

  test('MISFIRE reverts userSpeaking → listening and zeroes the fill', () => {
    const actor = createActor(liveVoiceMachine, { input: { deps: deps() } }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({ type: 'PROGRESS', fraction: 0.3 });
    actor.send({ type: 'MISFIRE' });
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
    expect(selectFill(actor.getSnapshot())).toBe(0);
  });

  test('SPEECH_END (not holding) → transcribing → sends → personaThinking', async () => {
    const sent: string[] = [];
    const actor = createActor(liveVoiceMachine, {
      input: { deps: deps({ transcribe: async () => 'hi there', sendMessage: (t) => sent.push(t) }) },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({ type: 'SPEECH_END', pcm: new Float32Array([1]), blob: new Blob(), mimeType: 'audio/wav' });
    expect(selectFloor(actor.getSnapshot())).toBe('transcribing');
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(['hi there']);
    expect(selectFloor(actor.getSnapshot())).toBe('personaThinking');
  });

  test('empty transcript returns to listening without sending', async () => {
    const sent: string[] = [];
    const actor = createActor(liveVoiceMachine, {
      input: { deps: deps({ transcribe: async () => '   ', sendMessage: (t) => sent.push(t) }) },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({ type: 'SPEECH_END', pcm: new Float32Array([1]), blob: new Blob(), mimeType: 'audio/wav' });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([]);
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
  });

  test('TAP during transcribing cancels — back to listening, no send', async () => {
    const sent: string[] = [];
    const actor = createActor(liveVoiceMachine, {
      input: {
        deps: deps({
          transcribe: async (_p, _b, _m, signal) =>
            new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))),
          sendMessage: (t) => sent.push(t),
        }),
      },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({ type: 'SPEECH_END', pcm: new Float32Array([1]), blob: new Blob(), mimeType: 'audio/wav' });
    expect(selectFloor(actor.getSnapshot())).toBe('transcribing');
    actor.send({ type: 'CANCEL' });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([]);
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm --filter @chatsundere/user-client exec bun test tests/lib/voice/live/live-voice-machine.test.ts`
Expected: FAIL — `userSpeaking`/`transcribing`/`personaThinking` not reached.

- [ ] **Step 3: Implement the user-floor states**

Extend `selectFloor` with the new matches, and replace the `listening` state and add the new states. The `listening` state gains `SPEECH_START`, `PRESS_START`/`HOLD`, and keeps `EXIT`; add `userSpeaking`, `transcribing`, `personaThinking`. Use this structure (study `dictation-machine.ts` for the `fromPromise` settle pattern):

```ts
    listening: {
      entry: ({ context }) => context.deps.startCapture(),
      on: {
        EXIT: { target: 'idle', actions: ({ context }) => context.deps.stopCapture() },
        SPEECH_START: { target: 'userSpeaking' },
        HOLD: { target: 'held' },
      },
    },
    userSpeaking: {
      on: {
        EXIT: { target: 'idle', actions: ({ context }) => context.deps.stopCapture() },
        PROGRESS: { actions: assign({ fillFraction: ({ event }) => event.fraction }) },
        MISFIRE: { target: 'listening', actions: assign({ fillFraction: 0 }) },
        HOLD: { target: 'held' },
        SPEECH_END: [
          // Holding is handled in Task 6 (buffer + stay). Not-holding: transcribe.
          {
            target: 'transcribing',
            actions: assign({
              fillFraction: 0,
              // stash the utterance for the transcribe actor input
              heldPcm: ({ event }) => [event.pcm],
              _utterance: ({ event }) => ({ blob: event.blob, mimeType: event.mimeType }),
            }),
          },
        ],
      },
    },
    transcribing: {
      invoke: {
        src: 'transcribe',
        input: ({ context }) => ({
          deps: context.deps,
          pcm: mergePcm(context.heldPcm),
          blob: context._utterance?.blob ?? new Blob(),
          mimeType: context._utterance?.mimeType ?? 'audio/wav',
        }),
        onDone: [
          {
            guard: ({ event }) => event.output.trim() === '',
            target: 'listening',
            actions: assign({ heldPcm: [] }),
          },
          {
            target: 'personaThinking',
            actions: [
              ({ context, event }) => context.deps.sendMessage(event.output),
              assign({ heldPcm: [] }),
            ],
          },
        ],
        onError: { target: 'sttFailed' },
      },
      on: {
        // CANCEL leaves the state, which aborts the transcribe actor's signal.
        CANCEL: { target: 'listening', actions: assign({ heldPcm: [] }) },
        EXIT: { target: 'idle', actions: ({ context }) => context.deps.stopCapture() },
      },
    },
    personaThinking: {
      // Read-aloud begins when the hook reports the first segment via PLAYBACK… ;
      // floor-reclaim handled in Task 7.
      entry: ({ context }) => context.deps.startPlayback(),
      on: {
        EXIT: { target: 'idle', actions: ({ context }) => { context.deps.stopPlayback(); context.deps.stopCapture(); } },
      },
    },
    sttFailed: {
      on: {
        RESUME: { target: 'listening' }, // Retry is the hook's job; the simplest recovery is to listen again
        EXIT: { target: 'idle', actions: ({ context }) => context.deps.stopCapture() },
      },
    },
```

Add `_utterance` to `LiveVoiceContext`:

```ts
  /** The container blob of the utterance being transcribed (PCM is in heldPcm). */
  _utterance: { blob: Blob; mimeType: string } | null;
```
…and to the context initialiser (`_utterance: null`). Import `mergePcm` from `./merge-pcm.js`. Extend `selectFloor`:

```ts
  if (snapshot.matches('userSpeaking')) return 'userSpeaking';
  if (snapshot.matches('transcribing')) return 'transcribing';
  if (snapshot.matches('personaThinking')) return 'personaThinking';
  if (snapshot.matches('personaSpeaking')) return 'personaSpeaking';
  if (snapshot.matches('held')) return 'held';
  if (snapshot.matches('sttFailed')) return 'sttFailed';
```

> Note: `personaSpeaking` and `held` states are completed in Tasks 6-7; `selectFloor` references them now so the selector is final.

- [ ] **Step 4: Run to verify the tests pass**

Run: `pnpm --filter @chatsundere/user-client exec bun test tests/lib/voice/live/live-voice-machine.test.ts`
Expected: PASS. (The `personaThinking` test passes because `startPlayback` is a no-op stub here.)

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/user-client exec biome check --write src tests
git add apps/user-client/src/lib/voice/live/live-voice-machine.ts apps/user-client/tests/lib/voice/live/live-voice-machine.test.ts
git commit -m "Add live-voice user floor: speak, fill, submit, cancel"
```

### Task 6: Hold-to-keep-talking + the unified Hold (pause)

**Files:** Modify `live-voice-machine.ts` + test.

**Two distinct concepts, do not conflate:**
- **PRESS_START/PRESS_END on the big button while on the user's floor** = *hold to keep talking*: buffer SPEECH_END deliveries instead of transcribing, pin the fill at 0, and on release transcribe the merged buffer.
- **HOLD event (the Hold/pause control)** = *the unified pause*: freeze everything (playback + mic + countdown), one `held` state, `RESUME` returns.

- [ ] **Step 1: Tests**

```ts
describe('liveVoiceMachine — hold to keep talking', () => {
  test('while holding, SPEECH_END buffers and stays on the user floor (no transcribe)', async () => {
    const sent: string[] = [];
    const actor = createActor(liveVoiceMachine, {
      input: { deps: deps({ sendMessage: (t) => sent.push(t) }) },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'PRESS_START' }); // thumb down — holding
    actor.send({ type: 'SPEECH_START' });
    actor.send({ type: 'SPEECH_END', pcm: new Float32Array([1, 2]), blob: new Blob(), mimeType: 'audio/wav' });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([]); // buffered, not sent
    expect(['userSpeaking', 'listening']).toContain(selectFloor(actor.getSnapshot()));
    expect(selectFill(actor.getSnapshot())).toBe(0); // pinned
  });

  test('PRESS_END after buffered speech merges and transcribes once', async () => {
    const sent: string[] = [];
    const actor = createActor(liveVoiceMachine, {
      input: { deps: deps({ transcribe: async () => 'merged turn', sendMessage: (t) => sent.push(t) }) },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'PRESS_START' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({ type: 'SPEECH_END', pcm: new Float32Array([1]), blob: new Blob(), mimeType: 'audio/wav' });
    actor.send({ type: 'SPEECH_END', pcm: new Float32Array([2]), blob: new Blob(), mimeType: 'audio/wav' });
    actor.send({ type: 'PRESS_END', heldMs: 1200 });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(['merged turn']);
  });
});

describe('liveVoiceMachine — unified Hold', () => {
  test('HOLD freezes to held; RESUME returns to listening; mic + playback paused', () => {
    let captureStops = 0;
    let playbackStops = 0;
    const actor = createActor(liveVoiceMachine, {
      input: { deps: deps({ stopCapture: () => captureStops++, stopPlayback: () => playbackStops++ }) },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'HOLD' });
    expect(selectFloor(actor.getSnapshot())).toBe('held');
    actor.send({ type: 'RESUME' });
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run the test file. Expected: FAIL — holding buffers not implemented; `held` not reached from `userSpeaking`.

- [ ] **Step 3: Implement**

Add `holding` tracking and the held-buffer branch. In `listening` and `userSpeaking`, handle `PRESS_START`:

```ts
        PRESS_START: { actions: assign({ holding: true, fillFraction: 0 }) },
        PRESS_END: { actions: assign({ holding: false }) },
```

In `userSpeaking`, make `SPEECH_END` guard on `holding`:

```ts
        SPEECH_END: [
          {
            guard: ({ context }) => context.holding,
            // Buffer and keep the floor; continuous VAD keeps listening.
            target: 'listening',
            actions: assign({
              fillFraction: 0,
              heldPcm: ({ context, event }) => [...context.heldPcm, event.pcm],
            }),
          },
          {
            target: 'transcribing',
            actions: assign({
              fillFraction: 0,
              heldPcm: ({ context, event }) => [...context.heldPcm, event.pcm],
              _utterance: ({ event }) => ({ blob: event.blob, mimeType: event.mimeType }),
            }),
          },
        ],
        PROGRESS: {
          // Pin the fill at 0 while holding; otherwise reflect the countdown.
          actions: assign({ fillFraction: ({ context, event }) => (context.holding ? 0 : event.fraction) }),
        },
```

In `listening`, handle `PRESS_END` after buffered speech — release transcribes the merged buffer if any:

```ts
        PRESS_END: [
          {
            guard: ({ context }) => context.heldPcm.length > 0,
            target: 'transcribing',
            actions: assign({ holding: false, _utterance: () => ({ blob: new Blob(), mimeType: 'audio/wav' }) }),
          },
          { actions: assign({ holding: false }) },
        ],
```

The `transcribing` invoke already merges `context.heldPcm` and WAV-encodes via the hook's `transcribe` (the hook builds a WAV from PCM when `mimeType` is `audio/wav` and the blob is empty — see Task 8). Add the `held` state:

```ts
    held: {
      entry: ({ context }) => { context.deps.stopPlayback(); context.deps.stopCapture(); },
      on: {
        RESUME: { target: 'listening' },
        EXIT: { target: 'idle' }, // capture already stopped on entry
      },
    },
```

Allow `HOLD` from `userSpeaking`, `personaThinking`, `personaSpeaking` (add `HOLD: { target: 'held' }` to each).

- [ ] **Step 4: Run to verify the tests pass**

Run the test file. Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/user-client exec biome check --write src tests
git add apps/user-client/src/lib/voice/live/live-voice-machine.ts apps/user-client/tests/lib/voice/live/live-voice-machine.test.ts
git commit -m "Add live-voice hold-to-keep-talking and unified Hold"
```

### Task 7: Persona's floor — speaking, barge, completion, failures

**Files:** Modify `live-voice-machine.ts` + test.

- [ ] **Step 1: Tests**

```ts
describe('liveVoiceMachine — persona floor', () => {
  test('PLAYBACK starts on personaThinking; the hook drives speaking via the same state', () => {
    let plays = 0;
    const actor = createActor(liveVoiceMachine, {
      input: { deps: deps({ startPlayback: () => plays++ }) },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({ type: 'SPEECH_END', pcm: new Float32Array([1]), blob: new Blob(), mimeType: 'audio/wav' });
    return new Promise<void>((res) => setTimeout(() => {
      expect(selectFloor(actor.getSnapshot())).toBe('personaThinking');
      expect(plays).toBe(1);
      res();
    }, 0));
  });

  test('PLAYBACK_DONE returns the floor to the user (listening)', async () => {
    const actor = createActor(liveVoiceMachine, { input: { deps: deps() } }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({ type: 'SPEECH_END', pcm: new Float32Array([1]), blob: new Blob(), mimeType: 'audio/wav' });
    await new Promise((r) => setTimeout(r, 0));
    actor.send({ type: 'PLAYBACK_DONE' });
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
  });

  test('BARGE stops playback and hands the floor back (listening)', async () => {
    let stops = 0;
    const actor = createActor(liveVoiceMachine, {
      input: { deps: deps({ stopPlayback: () => stops++ }) },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({ type: 'SPEECH_END', pcm: new Float32Array([1]), blob: new Blob(), mimeType: 'audio/wav' });
    await new Promise((r) => setTimeout(r, 0));
    actor.send({ type: 'BARGE' });
    expect(stops).toBe(1);
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
  });

  test('PLAYBACK_FAILED returns to listening (non-ejecting)', async () => {
    const actor = createActor(liveVoiceMachine, { input: { deps: deps() } }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({ type: 'SPEECH_END', pcm: new Float32Array([1]), blob: new Blob(), mimeType: 'audio/wav' });
    await new Promise((r) => setTimeout(r, 0));
    actor.send({ type: 'PLAYBACK_FAILED' });
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `PLAYBACK_DONE`/`BARGE` unhandled.

- [ ] **Step 3: Implement**

Add `personaSpeaking` and complete `personaThinking` transitions. The hook moves `personaThinking → personaSpeaking` by sending an internal event when the first segment plays; for the machine, both share the persona-floor handlers, so model `personaSpeaking` and add the same handlers to both:

```ts
    personaThinking: {
      entry: ({ context }) => context.deps.startPlayback(),
      on: {
        SPEECH_START: { target: 'personaSpeaking' }, // first audible segment (hook bridges; harmless if unused)
        BARGE: { target: 'listening', actions: ({ context }) => context.deps.stopPlayback() },
        PLAYBACK_DONE: { target: 'listening' },
        PLAYBACK_FAILED: { target: 'listening' },
        HOLD: { target: 'held' },
        EXIT: { target: 'idle', actions: ({ context }) => { context.deps.stopPlayback(); context.deps.stopCapture(); } },
      },
    },
    personaSpeaking: {
      on: {
        BARGE: { target: 'listening', actions: ({ context }) => context.deps.stopPlayback() },
        PLAYBACK_DONE: { target: 'listening' },
        PLAYBACK_FAILED: { target: 'listening' },
        HOLD: { target: 'held' },
        EXIT: { target: 'idle', actions: ({ context }) => { context.deps.stopPlayback(); context.deps.stopCapture(); } },
      },
    },
```

When the floor returns to `listening` from the persona, `startCapture` re-arms via the `listening` entry action (already present). Confirm `listening`'s `entry` runs on every (re-)entry — it does (a normal transition into `listening` runs its entry).

- [ ] **Step 4: Run to verify the tests pass** — PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/user-client exec biome check --write src tests
git add apps/user-client/src/lib/voice/live/live-voice-machine.ts apps/user-client/tests/lib/voice/live/live-voice-machine.test.ts
git commit -m "Add live-voice persona floor: speaking, barge, completion"
```

### Task 8: `useLiveVoice` — wire the machine to the real primitives

**Files:**
- Create: `apps/user-client/src/lib/voice/live/use-live-voice.ts`

**Context:** This hook owns one `liveVoiceMachine` actor and translates between it and the real systems, exactly as `useDictation` wraps `audioCapture` and `useVoicePlayback` wraps the voice machine. No new unit test (it is integration glue, device-verified in Phase 4); typecheck is the gate. Build deps once over refs (the established idiom).

Wiring contract:
- `startCapture` → `audioCapture.startContinuous({ onSpeechStart→SPEECH_START, onSpeechEnd→SPEECH_END (forward pcm+blob+mimeType), onMisfire→MISFIRE, onRedemptionProgress→PROGRESS, onVolumeChange→level meter }, { sensitivity, redemptionMs } from settings)`.
- `stopCapture` → `audioCapture.stopContinuous()`.
- `transcribe(pcm, blob, mimeType, signal)` → resolve STT lazily (cache the resolution like `useDictation`), then: if `mimeType === 'audio/wav'` and `blob.size === 0` (the held-merge path), build the blob with `float32ToWavBlob(pcm, 16000)`; otherwise pass the container blob. Call `resolution.transcribe(...)`.
- `sendMessage(text)` → the `onSend` arg passed from chat-page (`void onSend(text)`).
- `startPlayback()` → call into `useVoicePlayback`: read the latest persona reply message and `playMessage(message)`; subscribe to `voice.transportState` so that when it returns to `idle` after playing, send `PLAYBACK_DONE`; on `failed`, send `PLAYBACK_FAILED`.
- `stopPlayback()` → `voice.stop()`.

The hook exposes:

```ts
export interface LiveVoice {
  floor: Floor;
  fill: number; // 0..1
  level: number; // mic meter for the pulse
  available: boolean; // STT + TTS resolvable
  enter: () => void;
  exit: () => void;
  hold: () => void;
  resume: () => void;
  pressStart: () => void;
  pressEnd: () => void;
  tap: () => void; // resolves to CANCEL while transcribing, BARGE while persona floor, else no-op
  barge: () => void;
}
```

- [ ] **Step 1: Implement the hook** following `use-dictation.ts` (deps-over-refs, level coalescing via `requestAnimationFrame`, lazy STT resolution, `suppressNextClick` if you reuse pointer handlers) and `use-voice-playback.ts` (the playback subscription). Key skeleton:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useActorRef, useSelector } from '@xstate/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActorRefFrom } from 'xstate';
import { audioCapture } from '../dictation/capture.js';
import { resolveStt, type SttResolution } from '../dictation/resolve-stt.js';
import { REDEMPTION_MS_DEFAULT } from '../dictation/vad-presets.js';
import { float32ToWavBlob } from '../dictation/wav-encoder.js';
import type { VoicePlayback } from '../use-voice-playback.js';
import { type Floor, type LiveVoiceDeps, liveVoiceMachine, selectFill, selectFloor } from './live-voice-machine.js';

export interface LiveVoiceArgs {
  /** Send a transcribed turn (chat-page's onSend). */
  onSend: (text: string) => void;
  /** The shared read-aloud controller (chat-page's useVoicePlayback). */
  voice: VoicePlayback;
  /** The newest persona reply to read aloud, or null. The hook reads it at startPlayback time. */
  latestReply: () => { message: import('../../../boot/client-data-db.js').MessageRow } | null;
  /** VAD sensitivity / redemption from settings. */
  sensitivity: 'low' | 'medium' | 'high';
  redemptionMs: number;
}

export function useLiveVoice(args: LiveVoiceArgs): LiveVoice {
  const argsRef = useRef(args);
  argsRef.current = args;
  const actorRef = useRef<ActorRefFrom<typeof liveVoiceMachine> | null>(null);
  const sttRef = useRef<Extract<SttResolution, { ok: true }> | null>(null);
  const [level, setLevel] = useState(0);
  // …level coalescing exactly as use-dictation.ts (pushLevel/resetLevel)…

  const deps = useMemo<LiveVoiceDeps>(() => ({
    startCapture: () => {
      const a = argsRef.current;
      void audioCapture.startContinuous(
        {
          onSpeechStart: () => actorRef.current?.send({ type: 'SPEECH_START' }),
          onSpeechEnd: (audio) =>
            actorRef.current?.send({ type: 'SPEECH_END', pcm: audio.pcm, blob: audio.blob, mimeType: audio.mimeType }),
          onMisfire: () => actorRef.current?.send({ type: 'MISFIRE' }),
          onRedemptionProgress: (fraction) => actorRef.current?.send({ type: 'PROGRESS', fraction }),
          onVolumeChange: (l) => setLevel(l), // coalesce in the real impl
        },
        { sensitivity: a.sensitivity, redemptionMs: a.redemptionMs },
      ).catch(() => {/* permission/device — surface via `available`/gating in Phase 4 */});
    },
    stopCapture: () => audioCapture.stopContinuous(),
    transcribe: async (pcm, blob, mimeType, signal) => {
      let res = sttRef.current;
      if (!res) {
        const fresh = await resolveStt();
        if (fresh.ok) { sttRef.current = fresh; res = fresh; }
      }
      if (!res) throw new Error('live-voice: no STT resolution');
      const payload = mimeType === 'audio/wav' && blob.size === 0
        ? float32ToWavBlob(pcm, 16_000)
        : blob;
      return res.transcribe(payload, payload === blob ? mimeType : 'audio/wav', signal);
    },
    sendMessage: (text) => argsRef.current.onSend(text),
    startPlayback: () => {
      const reply = argsRef.current.latestReply();
      if (reply) void argsRef.current.voice.playMessage(reply.message);
    },
    stopPlayback: () => argsRef.current.voice.stop(),
  }), []);

  const actor = useActorRef(liveVoiceMachine, { input: { deps } });
  actorRef.current = actor;
  const floor = useSelector(actor, selectFloor);
  const fill = useSelector(actor, selectFill);

  // Bridge read-aloud completion → the machine.
  const transport = args.voice.transportState;
  const prevTransportRef = useRef(transport);
  useEffect(() => {
    const prev = prevTransportRef.current;
    prevTransportRef.current = transport;
    const snap = actorRef.current?.getSnapshot();
    if (!snap) return;
    if ((floor === 'personaThinking' || floor === 'personaSpeaking')) {
      if (transport === 'failed') actorRef.current?.send({ type: 'PLAYBACK_FAILED' });
      else if (prev !== 'idle' && transport === 'idle') actorRef.current?.send({ type: 'PLAYBACK_DONE' });
    }
  }, [transport, floor]);

  return {
    floor, fill, level,
    available: true, // refined in Phase 4 gating
    enter: () => actor.send({ type: 'ENTER' }),
    exit: () => actor.send({ type: 'EXIT' }),
    hold: () => actor.send({ type: 'HOLD' }),
    resume: () => actor.send({ type: 'RESUME' }),
    pressStart: () => actor.send({ type: 'PRESS_START' }),
    pressEnd: () => actor.send({ type: 'PRESS_END', heldMs: 0 }),
    tap: () => {
      if (floor === 'transcribing') actor.send({ type: 'CANCEL' });
      else if (floor === 'personaThinking' || floor === 'personaSpeaking') actor.send({ type: 'BARGE' });
      // listening / userSpeaking: no-op (you are already heard)
    },
    barge: () => actor.send({ type: 'BARGE' }),
  };
}
```

- [ ] **Step 2: Typecheck, lint**

```bash
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/user-client exec biome check --write src
```
Expected: clean. Fill in the level-coalescing and any `MessageRow` import paths to satisfy the type checker; do not leave `any`.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/lib/voice/live/use-live-voice.ts
git commit -m "Add useLiveVoice hook wiring the orchestrator to capture/STT/playback"
```

---

## Phase 3 — The live-voice surface

### Task 9: `LiveVoiceBar` — the big-button toolbar

**Files:**
- Create: `apps/user-client/src/components/chat/LiveVoiceBar.tsx`
- Test: `apps/user-client/tests/components/chat/LiveVoiceBar.test.tsx`

**Context:** Purely presentational (props in, callbacks out), exactly like `VoiceTransport.tsx` — reuse its `.voice-transport*` classes and the constant-Exit-right skeleton. The big button renders per `floor` (Spec §4); the fill is a CSS width on an inner element driven by `fill`. Glyphs are inline SVG with `aria-label` carrying the meaning (copy `PauseIcon`/`PlayIcon`/`SkipIcon`/`ExitIcon` from `VoiceTransport.tsx`; add a mic/interrupt glyph). British English labels.

Props:

```ts
export interface LiveVoiceBarProps {
  floor: Floor; // from selectFloor
  fill: number; // 0..1
  level: number; // mic meter for the pulse
  onHold: () => void;
  onResume: () => void;
  onSkip: () => void;
  onExit: () => void;
  onPressStart: () => void;
  onPressEnd: () => void;
  onTap: () => void;
}
```

- [ ] **Step 1: Write the failing test** (one assertion per Spec §4 row's reachable affordance)

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { LiveVoiceBar } from '../../../src/components/chat/LiveVoiceBar.js';

const base = {
  fill: 0, level: 0,
  onHold() {}, onResume() {}, onSkip() {}, onExit() {},
  onPressStart() {}, onPressEnd() {}, onTap() {},
};

describe('LiveVoiceBar', () => {
  test('Exit is present in every floor', () => {
    for (const floor of ['listening', 'userSpeaking', 'transcribing', 'personaSpeaking', 'held'] as const) {
      const { unmount } = render(<LiveVoiceBar {...base} floor={floor} />);
      expect(screen.getByRole('button', { name: /exit voice/i })).toBeTruthy();
      unmount();
    }
  });
  test('Skip is enabled only while the persona speaks', () => {
    const { rerender } = render(<LiveVoiceBar {...base} floor="listening" />);
    expect(screen.queryByRole('button', { name: /skip/i })).toBeNull();
    rerender(<LiveVoiceBar {...base} floor="personaSpeaking" />);
    expect(screen.getByRole('button', { name: /skip/i })).toBeTruthy();
  });
  test('the persona floor shows an interrupt affordance', () => {
    render(<LiveVoiceBar {...base} floor="personaSpeaking" />);
    expect(screen.getByRole('button', { name: /interrupt|take the floor/i })).toBeTruthy();
  });
  test('transcribing shows a cancel affordance', () => {
    render(<LiveVoiceBar {...base} floor="transcribing" />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
  });
  test('held shows Resume and the muted-mic note', () => {
    render(<LiveVoiceBar {...base} floor="held" />);
    expect(screen.getByRole('button', { name: /resume/i })).toBeTruthy();
    expect(screen.getByText(/held/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/components/chat/LiveVoiceBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `LiveVoiceBar`** rendering per `floor`:
  - Left region: **Hold** (floors `listening`/`userSpeaking`/`personaThinking`/`personaSpeaking`) or **Resume** (floor `held`); **Skip** only when `floor === 'personaSpeaking'`.
  - Centre big button: maps `floor` → affordance/`aria-label`/handler:
    - `listening` → "● listening" (no handler / no-op tap), `onPointerDown=onPressStart`, `onPointerUp=onPressEnd`.
    - `userSpeaking` → pulsing (scale/opacity from `level`), pointer handlers as above.
    - `transcribing` → "transcribing…" + `aria-label="Cancel this utterance"`, `onClick=onTap`.
    - `personaThinking`/`personaSpeaking` → `aria-label="Interrupt — take the floor"`, presence pulse, `onClick=onTap`.
    - `held` → frozen, struck-mic, the only persistent note ("Conversation held").
    - The fill is an absolutely-positioned inner div `style={{ width: \`${fill * 100}%\` }}` shown on `userSpeaking`.
  - Right: constant **Exit** (`aria-label="Exit voice"`, `onClick=onExit`).
  - Honour `prefers-reduced-motion` for the pulse/fill (CSS `@media`).

- [ ] **Step 4: Run to verify it passes** — PASS (5 tests).

- [ ] **Step 5: Add CSS** for `.live-voice-*` (big button, fill, pulse, struck-mic) in `apps/user-client/src/index.css`, alongside the existing `.voice-transport*` block. Pulse and fill behind `@media (prefers-reduced-motion: no-preference)`.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/user-client exec biome check --write src tests
git add apps/user-client/src/components/chat/LiveVoiceBar.tsx apps/user-client/tests/components/chat/LiveVoiceBar.test.tsx apps/user-client/src/index.css
git commit -m "Add LiveVoiceBar — the live-voice big-button toolbar"
```

### Task 10: The `isLiveVoice` store flag

**Files:**
- Modify: `apps/user-client/src/state/current-chat.store.ts`

- [ ] **Step 1:** Add `isLiveVoice: boolean;` to `CurrentChatStore` (near `isInteractionMode`) and `setLiveVoice: (on: boolean) => void;` to the actions. Add `isLiveVoice: false` to `initial`, and to the `InitialState` omit-list add `'setLiveVoice'`. Implement:

```ts
  setLiveVoice: (on) => set({ isLiveVoice: on }),
```

- [ ] **Step 2: Typecheck, lint, commit**

```bash
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/user-client exec biome check --write src
git add apps/user-client/src/state/current-chat.store.ts
git commit -m "Add isLiveVoice flag to the current-chat store"
```

---

## Phase 4 — Entry & wiring

### Task 11: Enable the cockpit live button

**Files:**
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx` (the `data-control="live"` button, lines 414-424)

**Context:** It is currently hard-disabled with a Block-4 tooltip. Wire it to toggle live voice, and apply disabled-with-reason (the same `voiceUnavailable` prop pattern the read-aloud button already uses at lines 429-431) so a user cannot enter a dead mode (Spec §7). Add two props to Cockpit: `onEnterLiveVoice: () => void` and reuse the existing `voiceUnavailable` prop.

- [ ] **Step 1:** Replace the disabled live button with an active one:

```tsx
        <button
          type="button"
          data-control="live"
          className="cockpit-control"
          onClick={p.onEnterLiveVoice}
          disabled={p.voiceUnavailable !== null}
          data-disabled={p.voiceUnavailable ? 'true' : undefined}
          aria-disabled={p.voiceUnavailable ? true : undefined}
          title={
            p.voiceUnavailable
              ? 'No voice provider — set one in Settings → Voice'
              : 'Live voice mode'
          }
          aria-label="Live voice mode"
        >
          <span className="wave-icon" aria-hidden="true">
            {/* keep the existing wave glyph markup */}
          </span>
        </button>
```

Add `onEnterLiveVoice: () => void;` to Cockpit's props interface. (`voiceUnavailable` is already threaded into Cockpit.)

- [ ] **Step 2: Typecheck, lint, commit**

```bash
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/user-client exec biome check --write src
git add apps/user-client/src/components/chat/Cockpit.tsx
git commit -m "Enable the cockpit live-voice button with disabled-over-hidden gating"
```

### Task 12: Wire live voice into the chat page

**Files:**
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx`

- [ ] **Step 1: Read the store flag and own the hook.** After the `useVoicePlayback` call (line 451) and the dictation block, add:

```tsx
  const isLiveVoice = useCurrentChatStore((s) => s.isLiveVoice);
  const setLiveVoice = useCurrentChatStore((s) => s.setLiveVoice);

  const liveVoice = useLiveVoice({
    onSend: (t) => void onSend(t),
    voice,
    latestReply: () => {
      const last = messages[messages.length - 1];
      return last && last.role === 'persona' ? { message: last } : null;
    },
    sensitivity: settings.data?.dictationSensitivity ?? 'medium',
    redemptionMs: settings.data?.dictationRedemptionMs ?? REDEMPTION_MS_DEFAULT,
  });

  // Enter/exit drive both the machine and the store flag (which hides the cockpit).
  const onEnterLiveVoice = useCallback(() => {
    setLiveVoice(true);
    liveVoice.enter();
  }, [setLiveVoice, liveVoice]);
  const onExitLiveVoice = useCallback(() => {
    liveVoice.exit();
    setLiveVoice(false);
  }, [setLiveVoice, liveVoice]);
```

Import `useLiveVoice` from `../../../lib/voice/live/use-live-voice.js` and `REDEMPTION_MS_DEFAULT` from `../../../lib/voice/dictation/vad-presets.js`. Verify `MessageRow.role` uses `'persona'` (check `client-data-db.ts`); adjust the literal if the schema differs.

- [ ] **Step 2: Render `LiveVoiceBar` instead of `VoiceTransport` while live.** Replace the `<VoiceTransport … />` block (lines 644-658) with:

```tsx
      {isLiveVoice ? (
        <LiveVoiceBar
          floor={liveVoice.floor}
          fill={liveVoice.fill}
          level={liveVoice.level}
          onHold={liveVoice.hold}
          onResume={liveVoice.resume}
          onSkip={voice.skip}
          onExit={onExitLiveVoice}
          onPressStart={liveVoice.pressStart}
          onPressEnd={liveVoice.pressEnd}
          onTap={liveVoice.tap}
        />
      ) : (
        <VoiceTransport
          /* …existing props unchanged… */
        />
      )}
```

Import `LiveVoiceBar`.

- [ ] **Step 3: Hide the cockpit while live (unless pinned).** Change the InteractionMode render guard (line 740) so the cockpit is suppressed in live mode unless the user pinned it:

```tsx
      {isInteractionMode && effectivePersona && offering && (!isLiveVoice || isPinned) ? (
        <InteractionMode /* … */ />
      ) : null}
```

Also pass `onEnterLiveVoice` down to `InteractionMode`/`Cockpit` (thread the prop through `InteractionMode`'s props to the `Cockpit` it renders).

- [ ] **Step 4: Pinned-cockpit VAD suppression.** When the composer is focused while live (pinned), suppress capture so the mic and keyboard do not contend (Spec §7). Add:

```tsx
  // While live + pinned, a focused composer must not also feed the mic.
  useEffect(() => {
    if (isLiveVoice && isPinned && inputFocused) liveVoice.hold();
  }, [isLiveVoice, isPinned, inputFocused, liveVoice]);
```

(Resume is the user's explicit action via the bar — do not auto-resume on blur, to avoid a surprising hot mic.)

- [ ] **Step 5: Exit live on chat change / unmount.** Add a cleanup so leaving the chat tears live voice down:

```tsx
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot teardown per chat id
  useEffect(() => {
    return () => {
      if (useCurrentChatStore.getState().isLiveVoice) {
        liveVoice.exit();
        setLiveVoice(false);
      }
    };
  }, [activeChatId]);
```

- [ ] **Step 6: Typecheck, lint, full client test, commit**

```bash
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/user-client exec biome check --write src
pnpm --filter @chatsundere/user-client exec vitest run
git add apps/user-client/src/routes/app/chat/chat-page.tsx apps/user-client/src/components/chat/InteractionMode.tsx
git commit -m "Wire live voice into the chat page (mode switch, gating, pinned suppression)"
```

Expected vitest: the live-voice baseline is the project's known 8 Node-localStorage failures (no more); a 9th means a real regression — investigate before proceeding.

### Task 13: Device verification & STATUS update

- [ ] **Step 1: Restart the dev server** (catalogue/lib changes are not HMR-picked): stop and re-run `pnpm dev`.

- [ ] **Step 2: Walk the Spec §12 manual-verification list on device.** In particular: enter live voice; speak → pause → watch the fill → (a) let it submit, (b) tap to buy time, (c) hold to keep talking; "no, wait —" cancel during transcribing; barge a read-aloud; Hold → struck-mic → Resume; no-provider greys the wave icon; permission-denied explains on the bar; pinned cockpit suppresses the mic on focus; reduced-motion degrades gracefully.

- [ ] **Step 3: Summon Larissa? No** — live voice touches no `auth/sync/proxy/crypto` path; it is frontend-only (capture stays client-side; STT/TTS use already-audited resolution). Skip the security gate per CLAUDE.md §9.1.

- [ ] **Step 4: Summon Laura (pre-squash light pass)** on the built diff to confirm the §4 affordances honour the approved intent.

- [ ] **Step 5: Update STATUS.** Move live voice from "Briefed/Doing now" to "Done" in `obsidian/STATUS-CLIENT-ONLY.md`; refresh the `Last updated:` line and the "Next session" block. Commit `[skip ci]`.

---

## Phase 5 — Carry-over (follow-on, separate squash)

Spec §9 — small, separable, deliberately after the core loop. Track as its own short plan once the loop is device-confirmed:
- Reuse the agent-agnostic **presence pulse** on the read-aloud / auto-read-aloud surfaces (the `SpectrumAnalyser` already pulses to TTS; extend the toolbar/affordance pulse semantics to match).
- Show the **"transcribing…"** indicator when the user dictates *during* auto-read-aloud (surface `useDictation`'s `uiState === 'transcribing'` on the toolbar).

These do not block v-scope; they polish the shared vocabulary.

---

## Self-review

**Spec coverage:**
- §2.1 hands-free → Task 5 (`listening` arms capture on entry; continuous VAD). ✓
- §2.2 mic-closed-during-read-aloud + manual barge → Tasks 7 (`personaSpeaking` BARGE), 9 (interrupt affordance). ✓
- §2.3 transcribing-cancel → Tasks 5 (CANCEL), 8 (`tap`→CANCEL), 9 (cancel affordance). ✓
- §2.4 unified Hold → Tasks 6 (`held`), 9 (Resume + note). ✓
- §2.5 agnostic pulse → Task 9 (presence pulse from `level`); carry-over Phase 5. ✓
- §4 state table → Tasks 5-7 (machine), 9 (surface). ✓ (`personaThinking`/`personaSpeaking` both carry persona-floor handlers.)
- §4 fill seam / grace → the fill zeroes on submit (Task 5) and is pinned while holding (Task 6); the "brief grace at the flip" is the `transcribing`→CANCEL being explicit (a tap mid-fill targets `userSpeaking`, never `transcribing`, because the state only flips on SPEECH_END). Note for the implementer: ensure the UI does not relabel the button to "cancel" until the machine is actually in `transcribing`.
- §5 Hold freezes all → Task 6 (`held` entry stops playback + capture). ✓
- §6 non-ejecting failures → Tasks 5 (`sttFailed`), 7 (`PLAYBACK_FAILED`→listening). ✓ (STT-failed Retry UI is minimal — `RESUME`→listening; a richer Retry can follow if device-testing wants it.)
- §7 gating → Tasks 11 (provider-disabled entry), 12 (pinned suppression); permission-denied surfaced via `available`/capture-catch (refine copy in Task 12 if needed). ✓
- §8 architecture → Phases 1-2. ✓
- §9 carry-over → Phase 5. ✓

**Placeholder scan:** no TBD/TODO; every code step shows code. The hook (Task 8) and Cockpit/InteractionMode prop-threading (Tasks 11-12) reference existing files the implementer must read — paths and line numbers given.

**Type consistency:** `Floor` is the single source of truth (machine → `selectFloor` → hook → `LiveVoiceBar`). `LiveVoiceDeps` method names match between machine (Task 4) and hook (Task 8). `onRedemptionProgress` matches between `capture.ts` (Task 2) and the hook (Task 8). `mergePcm` signature matches Tasks 3 and 5/6.

**Known soft edges flagged for the implementer:** (a) the STT-failed recovery is intentionally minimal (RESUME→listening) — a parked-audio Retry can be added if device use wants it; (b) `personaThinking`→`personaSpeaking` is bridged by the hook's transport subscription; the machine treats both identically, so the split is cosmetic for now (the bar may show "thinking…" vs the pulse using `transport`); (c) verify vad-web 0.0.30's `onFrameProcessed` probability shape before relying on `{ isSpeech }`.
