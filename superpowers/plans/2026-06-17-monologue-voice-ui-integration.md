# Inner-Monologue Voice-UI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inner-monologue playback surface the same ambient voice UI as read-aloud — the spectrum analyser (with its "computing" wave) and the audio toolbar (reduced) — so it no longer feels like a foreign body, and fix the missing computing-wave during any read-aloud's initial synthesis.

**Architecture:** A frame-accurate `isAudible()` on `AudioSink` lets the `SpectrumAnalyser` show the synthetic wave while playback is active-but-not-yet-sounding (covers read-aloud's initial compute and monologue synthesis). `useMonologuePlayback` surfaces a `transportState`, `getAnalyser`, `isAudible`, and `pause`/`resume`. `chat-page` composes an "effective source" — when a monologue is active, the single `SpectrumAnalyser` and single `VoiceTransport` are fed from the monologue; otherwise from the voice machine. `VoiceTransport` gains a reduced `mode='monologue'`.

**Tech Stack:** TypeScript (strict), Web Audio API (`AnalyserNode`, `AudioContext`), React 18, Vitest + React Testing Library (user-client).

## Global Constraints

- British English in all code, comments, copy, commit messages.
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any` without an inline justification. No `!` non-null assertions (Biome bans them — the pre-commit gate runs Biome).
- The CI gate is `pnpm typecheck`; Turbo caches it, so run `pnpm typecheck --force` at each task gate. Run `pnpm --filter @chatsundere/user-client test` too.
- `AudioSink`, the WebAudio paths, the spectrum canvas/rAF loop, and the monologue hook's audio are untestable under jsdom — do NOT write tests for them; cover them via typecheck + manual verification. Only `VoiceTransport` (presentational) is unit-tested (Task 5).
- Expected Vitest baseline: the 8 Node-localStorage environmental failures. A 9th `stream-manager-store` failure is the known parallel-load flake — re-run that file alone to confirm. Any other new failure is real.
- Every package-public function carries a one-line JSDoc.
- Commit messages: free-form imperative, capitalised subject. Trailer `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. No `[skip ci]` (code commits). Commit on the current branch (`feature/tts-audio`); subagents never merge/push/switch branches.

**Spec:** `superpowers/specs/2026-06-17-monologue-voice-ui-integration-design.md`

---

### Task 1: `AudioSink.isAudible()`

**Files:**
- Modify: `apps/user-client/src/lib/voice/audio-sink.ts`

**Interfaces:**
- Produces: `AudioSink.isAudible(): boolean` — true while a source is currently sounding (a started, not-yet-ended/stopped `AudioBufferSourceNode` exists).

- [ ] **Step 1: Add the method**

In `audio-sink.ts`, add a public method (place it just after `getAnalyser()`):

```ts
  /** Whether a source is currently sounding — true between source.start() and its
   *  end/stop. Frame-safe (synchronous, allocation-free): the spectrum reads this
   *  every animation frame to choose the synthetic wave vs real FFT. */
  isAudible(): boolean {
    return this.source !== null;
  }
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck --force`
Expected: PASS (14/14 tasks).

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/lib/voice/audio-sink.ts
git commit -m "Add AudioSink.isAudible for the spectrum computing wave

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: `useMonologuePlayback` — transportState, analyser, isAudible, pause/resume

**Files:**
- Modify: `apps/user-client/src/lib/voice/use-monologue-playback.ts`

**Interfaces:**
- Consumes: `AudioSink.isAudible` (Task 1), `AudioSink.getAnalyser`/`pause`/`resume` (existing).
- Produces: the `MonologuePlayback` interface gains:
  - `transportState: 'idle' | 'waiting' | 'speaking' | 'paused'`
  - `getAnalyser: () => AnalyserNode | null`
  - `isAudible: () => boolean`
  - `pause: () => void`
  - `resume: () => void`

- [ ] **Step 1: Extend the interface**

In `use-monologue-playback.ts`, add to `interface MonologuePlayback` (keep the existing members):

```ts
  /** Playback phase, for the shared spectrum + toolbar: 'waiting' while a chunk
   *  is synthesising, 'speaking' while it plays, 'paused' when paused. */
  transportState: 'idle' | 'waiting' | 'speaking' | 'paused';
  /** The monologue AudioSink's analyser (post-effect), or null before first play. */
  getAnalyser: () => AnalyserNode | null;
  /** Whether the monologue is currently sounding (for the spectrum's wave/FFT choice). */
  isAudible: () => boolean;
  pause: () => void;
  resume: () => void;
```

- [ ] **Step 2: Add the transportState state and reset it in `stop`**

Add the state near the existing `activeId`/`disabledReason` states:

```ts
  const [transportState, setTransportState] = useState<
    'idle' | 'waiting' | 'speaking' | 'paused'
  >('idle');
```

In the `stop` callback, reset it (add the line alongside `setActiveId(null)`):

```ts
  const stop = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    sinkRef.current?.stop();
    setActiveId(null);
    setTransportState('idle');
  }, []);
```

- [ ] **Step 3: Drive transportState through the read loop**

In `read`, set `'waiting'` before each fetch and `'speaking'` before each play, and reset to `'idle'` in the `finally` (only when this controller is still the active one). The loop body becomes:

```ts
      try {
        for (let i = 0; i < chunks.length; i++) {
          if (controller.signal.aborted || !sink) break;
          const segment = chunkSegment(i, chunks[i] ?? '');
          setTransportState('waiting');
          const blob = await resolution.fetchAudio(segment, controller.signal);
          if (controller.signal.aborted) break;
          setTransportState('speaking');
          await sink.play(blob, { profile: { kind: 'monologue' }, signal: controller.signal });
        }
      } catch {
        // Synthesis/decode failure or abort — fail quiet for an easter egg.
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setActiveId(null);
          setTransportState('idle');
        }
      }
```

(The `setActiveId(id)` before the loop is unchanged.)

- [ ] **Step 4: Add pause/resume and the accessors; return them**

Add the callbacks near `stop`:

```ts
  const pause = useCallback((): void => {
    void sinkRef.current?.pause();
    setTransportState('paused');
  }, []);

  const resume = useCallback((): void => {
    void sinkRef.current?.resume();
    setTransportState('speaking');
  }, []);
```

Update the return statement:

```ts
  return {
    read,
    stop,
    activeId,
    disabledReason,
    transportState,
    getAnalyser: () => sinkRef.current?.getAnalyser() ?? null,
    isAudible: () => sinkRef.current?.isAudible() ?? false,
    pause,
    resume,
  };
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck --force`
Expected: PASS.
Run: `pnpm --filter @chatsundere/user-client test`
Expected: 8 baseline failures only.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/lib/voice/use-monologue-playback.ts
git commit -m "Surface transportState, analyser, isAudible and pause/resume from the monologue hook

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: `useVoicePlayback` — `getIsAudible`

**Files:**
- Modify: `apps/user-client/src/lib/voice/use-voice-playback.ts`

**Interfaces:**
- Consumes: `AudioSink.isAudible` (Task 1).
- Produces: `VoicePlayback.getIsAudible: () => boolean`.

- [ ] **Step 1: Add to the interface**

In `use-voice-playback.ts`, in `interface VoicePlayback`, after `getAnalyser`:

```ts
  /** Whether read-aloud is currently sounding — lets the spectrum show the
   *  synthetic wave during the initial synthesis (transport is 'speaking' before
   *  audio sounds) rather than a flat empty FFT. */
  getIsAudible: () => boolean;
```

- [ ] **Step 2: Implement in the return**

In the returned object (where `getAnalyser` is returned, near the end of the hook), add:

```ts
    getIsAudible: () => sinkRef.current?.isAudible() ?? false,
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck --force`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/lib/voice/use-voice-playback.ts
git commit -m "Expose getIsAudible from useVoicePlayback for the computing wave

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: `SpectrumAnalyser` — wave when active-but-not-audible

**Files:**
- Modify: `apps/user-client/src/components/voice/SpectrumAnalyser.tsx`

**Interfaces:**
- Consumes: an `isAudible` accessor (Tasks 2/3), supplied by `chat-page` (Task 6).
- Produces: `SpectrumAnalyser` accepts an optional `isAudible?: () => boolean` prop.

The only behavioural change is the bin selection inside the existing `'speaking'`
branch: when `isAudible()` returns false (synthesising, no audio yet), draw the
synthetic wave instead of the empty FFT. Everything else (the `'paused'` early
return, the `visible` set, the `'waiting'`/`personaThinking` wave) is unchanged.

- [ ] **Step 1: Add the prop**

In the `Props` interface (around line 19 where `transportState: TransportState;` is), add:

```ts
  /** Whether playback is currently sounding. When absent or true, behaviour is as
   *  today. When it returns false during 'speaking' (synthesis not yet audible),
   *  the synthetic wave is drawn instead of the empty FFT. */
  isAudible?: () => boolean;
```

Add `isAudible` to the destructured parameters of the component:

```ts
export function SpectrumAnalyser({ transportState, getAnalyser, isAudible, personaThinking = false }: Props) {
```

- [ ] **Step 2: Use it in the speaking branch**

Find the bin-selection block (around `SpectrumAnalyser.tsx:171-178`):

```ts
        let bins: Float32Array | null = null;
        if (transportState === 'speaking') {
          bins = accessors.getBins();
        } else if (waitingWave) {
          fillNoiseBins(noiseBufferRef.current, performance.now() / 1000);
          bins = noiseBufferRef.current;
        }
```

Replace the `'speaking'` branch so a not-yet-audible speaking state draws the wave:

```ts
        let bins: Float32Array | null = null;
        // 'speaking' is entered before the first audio actually sounds (read-aloud's
        // initial synthesis, and each monologue chunk's synthesis). While not yet
        // audible, draw the synthetic wave so the wait reads as presence, not a flat
        // dead field; once audible, draw the real FFT.
        if (transportState === 'speaking' && isAudible?.() === false) {
          fillNoiseBins(noiseBufferRef.current, performance.now() / 1000);
          bins = noiseBufferRef.current;
        } else if (transportState === 'speaking') {
          bins = accessors.getBins();
        } else if (waitingWave) {
          fillNoiseBins(noiseBufferRef.current, performance.now() / 1000);
          bins = noiseBufferRef.current;
        }
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck --force`
Expected: PASS.
Run: `pnpm --filter @chatsundere/user-client test`
Expected: 8 baseline failures only.

- [ ] **Step 4: Manual sanity (Chris, on device — recorded for later)**

Read-aloud on a message → the wave shows during the initial computing delay, then FFT once audio sounds. (Full manual verification is in the spec §6.)

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/voice/SpectrumAnalyser.tsx
git commit -m "Draw the spectrum wave while playback is active but not yet audible

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 5: `VoiceTransport` — reduced `mode='monologue'`

**Files:**
- Modify: `apps/user-client/src/components/chat/VoiceTransport.tsx`
- Test: `apps/user-client/tests/unit/voice-transport.test.tsx` (create if absent; if a file already exists, append the two tests)

**Interfaces:**
- Produces: `VoiceTransportProps.mode?: 'read-aloud' | 'monologue'` (default `'read-aloud'`). In `'monologue'` mode: Skip hidden; the note reads `'thinking aloud…'` during `'waiting'`/`'speaking'`; the right-slot control reads `'Stop'` (square glyph) and calls `onExitVoice`.

- [ ] **Step 1: Write the failing tests**

Create `apps/user-client/tests/unit/voice-transport.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VoiceTransport } from '../../src/components/chat/VoiceTransport.js';

const base = {
  resumeOffer: null,
  providerSkips: 0,
  autoReadOn: false,
  voiceUnavailable: null,
  onPause: vi.fn(),
  onResume: vi.fn(),
  onSkip: vi.fn(),
  onRetry: vi.fn(),
  onResumePlayback: vi.fn(),
  onStartOver: vi.fn(),
  onDismiss: vi.fn(),
  onExitVoice: vi.fn(),
} as const;

describe('<VoiceTransport> monologue mode', () => {
  it('hides Skip, labels the exit "Stop", and shows the thinking-aloud note', () => {
    render(<VoiceTransport {...base} mode="monologue" state="speaking" />);
    expect(screen.queryByLabelText('Skip this part')).toBeNull();
    expect(screen.getByText('Stop')).toBeInTheDocument();
    expect(screen.queryByText('Exit')).toBeNull();
    expect(screen.getByText('thinking aloud…')).toBeInTheDocument();
  });

  it('default read-aloud mode still shows Skip and Exit', () => {
    render(<VoiceTransport {...base} state="speaking" />);
    expect(screen.getByLabelText('Skip this part')).toBeInTheDocument();
    expect(screen.getByText('Exit')).toBeInTheDocument();
    expect(screen.queryByText('thinking aloud…')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @chatsundere/user-client test voice-transport`
Expected: FAIL — `mode` prop does not exist / "Stop" and "thinking aloud…" not found.

- [ ] **Step 3: Add the `mode` prop**

In `VoiceTransportProps`, add:

```ts
  /** 'monologue' renders the reduced inner-monologue toolbar: no Skip, a
   *  "thinking aloud…" note, and a "Stop" right-slot. Default 'read-aloud'. */
  mode?: 'read-aloud' | 'monologue';
```

- [ ] **Step 4: Add a StopIcon**

Add alongside the other glyph components (e.g. after `ExitIcon`):

```tsx
function StopIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
```

- [ ] **Step 5: Gate Skip, the note, and the right slot on mode**

At the top of the component body (after `const armed = …` and the existing derived consts), add:

```ts
  const monologue = p.mode === 'monologue';
```

Change `showSkip` so it is suppressed in monologue mode:

```ts
  const showSkip =
    !monologue &&
    (p.state === 'speaking' ||
      p.state === 'waiting' ||
      p.state === 'paused' ||
      p.state === 'failed' ||
      armed);
```

Change `note` so monologue mode uses its own copy (a monologue is only ever
`waiting`/`speaking`/`paused`/`idle`; the read-aloud notice cascade does not apply):

```ts
  const note = monologue
    ? p.state === 'waiting' || p.state === 'speaking'
      ? 'thinking aloud…'
      : ''
    : p.state === 'waiting'
      ? 'reading…'
      : p.state === 'failed'
        ? "Couldn't read this part aloud"
        : p.state === 'ended-partial'
          ? "Couldn't finish reading aloud — Retry?"
          : unavailableArmed
            ? unavailableNote(p.voiceUnavailable)
            : p.providerSkips > 0
              ? skipNote(p.providerSkips)
              : '';
```

Replace the right-slot button (the `<button className="voice-transport-exit" …>` block, around lines 282-290) so monologue mode renders a Stop:

```tsx
        <button
          type="button"
          className="voice-transport-exit"
          aria-label={monologue ? 'Stop' : rightIsDismiss ? 'Dismiss' : 'Exit voice'}
          onClick={monologue ? p.onExitVoice : rightIsDismiss ? p.onDismiss : p.onExitVoice}
        >
          {monologue ? <StopIcon /> : rightIsDismiss ? <DismissIcon /> : <ExitIcon />}
          <span className="voice-transport-label">
            {monologue ? 'Stop' : rightIsDismiss ? 'Dismiss' : 'Exit'}
          </span>
        </button>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client test voice-transport`
Expected: PASS (2 tests).
Then: `pnpm typecheck --force`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/chat/VoiceTransport.tsx apps/user-client/tests/unit/voice-transport.test.tsx
git commit -m "Add reduced monologue mode to the voice toolbar

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 6: `chat-page` — compose the effective source

**Files:**
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx`

**Interfaces:**
- Consumes: `monologue.transportState`/`getAnalyser`/`isAudible`/`pause`/`resume`/`stop`/`activeId` (Task 2), `voice.getIsAudible` (Task 3), `SpectrumAnalyser.isAudible` (Task 4), `VoiceTransport.mode` (Task 5). `monologue` and `monologueController` already exist in this file from the prior feature.

- [ ] **Step 1: Derive the effective spectrum source**

Near the `monologueController` definition (around line 462), add:

```ts
  const monologueActive = monologue.activeId !== null;
```

- [ ] **Step 2: Feed the SpectrumAnalyser from the effective source**

Replace the `<SpectrumAnalyser … />` render (around lines 580-584):

```tsx
      <SpectrumAnalyser
        transportState={monologueActive ? monologue.transportState : voice.transportState}
        getAnalyser={monologueActive ? monologue.getAnalyser : voice.getAnalyser}
        isAudible={monologueActive ? monologue.isAudible : voice.getIsAudible}
        personaThinking={isLiveVoice && liveVoice.floor === 'personaThinking'}
      />
```

(`personaThinking` is never true during a monologue — the monologue button is
disabled in live voice — so it stays wired to the live-voice floor as today.)

- [ ] **Step 3: Render the monologue toolbar when a monologue is active**

The toolbar lives in the `isLiveVoice ? <LiveVoiceBar/> : <VoiceTransport read-aloud/>`
ternary (around lines 732-748). Extend the `else` branch so an active monologue
renders the reduced toolbar. Replace the `) : (` … `<VoiceTransport … />` … `)}`
block with:

```tsx
      ) : monologueActive ? (
        <VoiceTransport
          mode="monologue"
          state={monologue.transportState}
          resumeOffer={null}
          providerSkips={0}
          autoReadOn={false}
          voiceUnavailable={null}
          onPause={monologue.pause}
          onResume={monologue.resume}
          onSkip={() => undefined}
          onRetry={() => undefined}
          onResumePlayback={() => undefined}
          onStartOver={() => undefined}
          onDismiss={monologue.stop}
          onExitVoice={monologue.stop}
        />
      ) : (
        <VoiceTransport
          state={voice.transportState}
          resumeOffer={resumeParagraphLabel ? { paragraphLabel: resumeParagraphLabel } : null}
          providerSkips={voice.providerSkips}
          autoReadOn={autoReadAloud}
          voiceUnavailable={voiceUnavailable}
          onPause={voice.pause}
          onResume={voice.resumeAudio}
          onSkip={voice.skip}
          onRetry={voice.retry}
          onResumePlayback={voice.resume}
          onStartOver={voice.startOver}
          onDismiss={voice.dismissPartial}
          onExitVoice={onExitVoice}
        />
      )}
```

The no-op handlers (`onSkip`/`onRetry`/`onResumePlayback`/`onStartOver`) are never
reachable in monologue mode (Skip hidden; no failed/ended-partial/resume states), but
are required by the prop type.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck --force`
Expected: PASS.
Run: `pnpm --filter @chatsundere/user-client test`
Expected: 8 baseline failures only.

- [ ] **Step 5: Manual verification (Chris, on device)**

Run the spec §6 checklist: read-aloud computing wave; monologue shows toolbar
(Pause/Resume + Stop, no Skip) + spectrum (wave during synthesis, reverb-blooming
FFT during playback); Pause/Resume; Stop; natural-end calm retirement; read-aloud
unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/routes/app/chat/chat-page.tsx
git commit -m "Feed the spectrum and toolbar from the active monologue

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** §2/§3.1 isAudible → Tasks 1/3/4. §3.2 monologue surface → Task 2. §3.3 spectrum wave rule → Task 4. §3.4 VoiceTransport mode (Skip hidden, "Stop" not "Exit", "thinking aloud…" note) → Task 5. §3.5 effective-source composition → Task 6. §6 manual verification → Tasks 4/6. §7 note copy "thinking aloud…" → Task 5.
- **Type consistency:** `transportState: 'idle'|'waiting'|'speaking'|'paused'` identical in Tasks 2 & 6. `isAudible: () => boolean` identical across Tasks 1/2/3/4/6. `getAnalyser: () => AnalyserNode | null` matches the existing `VoicePlayback.getAnalyser`. `mode: 'read-aloud'|'monologue'` matches between Tasks 5 & 6.
- **Audit gate:** user-client only — no `auth/sync/proxy/crypto`. No Larissa. Laura's spec-pass folded into the spec (SOFT-1 "Stop", SOFT-3 calm retirement); a light pre-squash Laura pass on the built toolbar is the lead's call.
- **Mutual exclusion safety:** read-aloud and monologue are already mutually exclusive (prior feature's symmetric guard), so `monologueActive` is a clean single-owner switch — the spectrum/toolbar never represent two sources at once.
