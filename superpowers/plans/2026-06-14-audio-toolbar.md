# Audio Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rededicate the floating `VoiceTransport` into a space-reserving, cockpit-independent **audio toolbar** with large thumb-friendly controls, a fixed button skeleton (left action · Skip · right Leave/Dismiss), Skip as a first-class control, an armed-state "ready" indicator, and a slide-in mode-switch — laying the foundation for the future cockpitless live-voice mode.

**Architecture:** The component stays purely presentational (props in, callbacks out). The "Raus"/Leave action becomes one holistic `onExitVoice` callback the chat page wires (`voice.stop()` + turn auto-read off if armed), which retires the `stopHint` machinery entirely. The CSS converts `.voice-transport` from `position: absolute` (floating) to a real flex-child of `.chat-page` (like `.cockpit`/`.affordance`), so the read region (`.chat-stream`) gives up height instead of being overlapped.

**Tech Stack:** React 18 + TypeScript (strict), Vitest + `@testing-library/react`, Tailwind v4 / hand-written CSS in `index.css`, XState voice machine (unchanged).

**Spec:** [`superpowers/specs/2026-06-14-audio-toolbar-design.md`](../specs/2026-06-14-audio-toolbar-design.md)

**Out of scope (do NOT build):** the hold-to-talk button, barging, mic orchestration (Spec 3); any change to the voice machine's state set or TTS segmentation; new persisted settings. The dormant `voiceStopHintSeen` setting field is left in place (YAGNI — no migration).

**Files touched:**
- Modify: `apps/user-client/src/components/chat/VoiceTransport.tsx` — new prop shape + fixed skeleton, Skip everywhere, ready indicator, waiting controls, Leave/Dismiss split.
- Modify: `apps/user-client/tests/components/chat/VoiceTransport.test.tsx` — rewrite to the new contract.
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx` — holistic `onExitVoice`, pass `autoReadOn` + `voiceUnavailable`, remove `stopHint`.
- Modify: `apps/user-client/src/index.css` — `.voice-transport` → flex-child, big buttons, note line reserved height, slide-in, reduced-motion.

---

## Task 1: Rework the VoiceTransport component (TDD)

**Files:**
- Modify: `apps/user-client/src/components/chat/VoiceTransport.tsx`
- Test: `apps/user-client/tests/components/chat/VoiceTransport.test.tsx`

- [ ] **Step 1: Replace the test file with the new contract (red)**

Overwrite `apps/user-client/tests/components/chat/VoiceTransport.test.tsx` with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VoiceTransport } from '../../../src/components/chat/VoiceTransport.js';

// Callbacks plus the non-callback defaults every render needs; explicit props
// after the spread override (e.g. `autoReadOn` for the armed tests).
function props() {
  return {
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
  };
}

describe('VoiceTransport visibility', () => {
  it('renders null when idle, not armed, no offer, no skips', () => {
    const { container } = render(<VoiceTransport state="idle" {...props()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders when auto-read is armed (idle but voice mode on)', () => {
    render(<VoiceTransport state="idle" {...props()} autoReadOn />);
    expect(screen.getByText(/next reply reads itself/i)).toBeInTheDocument();
  });
});

describe('VoiceTransport playing states', () => {
  it('speaking shows Pause + Skip and a constant Leave; wires them', () => {
    const p = props();
    render(<VoiceTransport state="speaking" {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Pause reading/ }));
    fireEvent.click(screen.getByRole('button', { name: /Skip this part/ }));
    fireEvent.click(screen.getByRole('button', { name: /Leave voice/ }));
    expect(p.onPause).toHaveBeenCalledTimes(1);
    expect(p.onSkip).toHaveBeenCalledTimes(1);
    expect(p.onExitVoice).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Dismiss/ })).toBeNull();
  });

  it('waiting shows Pause + Skip live plus the reading… note', () => {
    const p = props();
    render(<VoiceTransport state="waiting" {...p} />);
    expect(screen.getByText(/reading…/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pause reading/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Skip this part/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Leave voice/ })).toBeInTheDocument();
  });

  it('paused shows Resume + Skip + Leave', () => {
    const p = props();
    render(<VoiceTransport state="paused" {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Resume reading/ }));
    expect(p.onResume).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Skip this part/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Leave voice/ })).toBeInTheDocument();
  });
});

describe('VoiceTransport armed states', () => {
  it('armed shows a ready indicator, a DISABLED Skip, and Leave (no greyed Pause)', () => {
    const p = props();
    render(<VoiceTransport state="idle" {...p} autoReadOn />);
    expect(screen.getByText(/ready/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Skip this part/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Pause reading/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Leave voice/ }));
    expect(p.onExitVoice).toHaveBeenCalledTimes(1);
  });

  it('armed-but-unavailable shows a greyed Pause + the reason, never silently hides', () => {
    const p = props();
    render(<VoiceTransport state="idle" {...p} autoReadOn voiceUnavailable="no-voice" />);
    expect(screen.getByText(/Voice unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pause reading/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Leave voice/ })).toBeInTheDocument();
  });
});

describe('VoiceTransport recovery + notices', () => {
  it('failed shows note + Retry + Skip + Leave', () => {
    const p = props();
    render(<VoiceTransport state="failed" {...p} />);
    expect(screen.getByText(/Couldn't read this part aloud/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry reading/ }));
    fireEvent.click(screen.getByRole('button', { name: /Skip this part/ }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
    expect(p.onSkip).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Leave voice/ })).toBeInTheDocument();
  });

  it('ended-partial shows note + Retry, and Dismiss (not Leave)', () => {
    const p = props();
    render(<VoiceTransport state="ended-partial" {...p} />);
    expect(screen.getByText(/Couldn't finish reading aloud/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry reading/ }));
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
    expect(p.onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Leave voice/ })).toBeNull();
  });

  it('skip note shows mid-speaking with NO Dismiss (Leave stays)', () => {
    const p = props();
    render(<VoiceTransport state="speaking" {...p} providerSkips={1} />);
    expect(screen.getByText(/Skipped a passage the voice provider declined/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dismiss/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Leave voice/ })).toBeInTheDocument();
  });

  it('idle with skipped passages shows the plural note + Dismiss (not Leave)', () => {
    const p = props();
    render(<VoiceTransport state="idle" {...p} providerSkips={2} />);
    expect(screen.getByText(/Skipped 2 passages the voice provider declined/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));
    expect(p.onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Leave voice/ })).toBeNull();
  });

  it('idle + resume offer shows Resume · ¶k, Start over, and Leave declines', () => {
    const p = props();
    render(<VoiceTransport state="idle" {...p} resumeOffer={{ paragraphLabel: '¶3' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Resume reading from ¶3/ }));
    fireEvent.click(screen.getByRole('button', { name: /Start over/ }));
    fireEvent.click(screen.getByRole('button', { name: /Leave voice/ }));
    expect(p.onResumePlayback).toHaveBeenCalledTimes(1);
    expect(p.onStartOver).toHaveBeenCalledTimes(1);
    expect(p.onExitVoice).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Resume · ¶3')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail (red)**

Run: `cd apps/user-client && pnpm vitest run tests/components/chat/VoiceTransport.test.tsx`
Expected: FAIL — the component still has the old props (`onStop`, `stopHint`), so `Leave voice`/`ready`/armed assertions error.

- [ ] **Step 3: Replace the component with the new contract (green)**

Overwrite `apps/user-client/src/components/chat/VoiceTransport.tsx` with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { DisabledReason } from '../../lib/voice/use-voice-playback.js';
import type { TransportState } from '../../lib/voice/voice-machine.js';

export interface VoiceTransportProps {
  state: TransportState;
  /** When set (idle), the on-return resume offer is shown. The caller derives
   *  `paragraphLabel` (e.g. '¶3') from the remembered index. */
  resumeOffer: { paragraphLabel: string } | null;
  /** Count of segments the provider declined and the read auto-skipped past. */
  providerSkips: number;
  /** True when auto-read-aloud is on — drives the armed/ready surface at idle so
   *  "toolbar visible" and "the next reply reads itself" are the same fact. */
  autoReadOn: boolean;
  /** Non-null when voice is unavailable while armed; shown greyed-with-reason
   *  rather than silently retracting (disabled over hidden). */
  voiceUnavailable: DisabledReason;
  onPause: () => void;
  onResume: () => void;
  onSkip: () => void;
  onRetry: () => void;
  /** Resume playback from the remembered position (the on-return offer). */
  onResumePlayback: () => void;
  /** Discard the resume offer and start the message from the beginning. */
  onStartOver: () => void;
  /** Dismiss a purely-informational terminal notice (partial-finish / skip note). */
  onDismiss: () => void;
  /** The holistic voice-surface exit ("Leave"): stop this playback and, if
   *  auto-read is armed, turn it off. One context-correct escape — what retires
   *  the old Stop-vs-toggle stop hint. */
  onExitVoice: () => void;
}

function unavailableNote(reason: DisabledReason): string {
  return reason === 'no-provider'
    ? 'Voice unavailable — no provider configured'
    : 'Voice unavailable — this persona has no voice';
}

function skipNote(n: number): string {
  return n === 1
    ? 'Skipped a passage the voice provider declined'
    : `Skipped ${n} passages the voice provider declined`;
}

/**
 * The persistent audio toolbar (spec 2026-06-14). A space-reserving, cockpit-
 * independent control surface for voice playback. Fixed skeleton: a note line
 * (reserved height) above a button row whose RIGHT slot is a constant escape
 * ("Leave" / "Dismiss") and whose LEFT region carries the contextual playback
 * actions plus an always-present Skip while something is or can be playing.
 *
 * Purely presentational: props in, callbacks out. It imports no playback hook —
 * the chat page owns {@link useVoicePlayback} and wires it here, including the
 * holistic {@link VoiceTransportProps.onExitVoice}.
 */
export function VoiceTransport(p: VoiceTransportProps): JSX.Element | null {
  const armed =
    p.state === 'idle' && p.autoReadOn && p.resumeOffer === null && p.providerSkips === 0;
  const readyArmed = armed && p.voiceUnavailable === null;
  const unavailableArmed = armed && p.voiceUnavailable !== null;

  const visible =
    p.state !== 'idle' || armed || p.resumeOffer !== null || p.providerSkips > 0;
  if (!visible) return null;

  // Right slot: Dismiss for purely-informational terminal notices (nothing to
  // leave); Leave (holistic exit) in every state with a session/offer/armed mode.
  const rightIsDismiss =
    p.state === 'ended-partial' || (p.state === 'idle' && p.providerSkips > 0 && !armed);

  const showSkip =
    p.state === 'speaking' ||
    p.state === 'waiting' ||
    p.state === 'paused' ||
    p.state === 'failed' ||
    armed;

  const note =
    p.state === 'waiting'
      ? 'reading…'
      : p.state === 'failed'
        ? "Couldn't read this part aloud"
        : p.state === 'ended-partial'
          ? "Couldn't finish reading aloud — Retry?"
          : unavailableArmed
            ? unavailableNote(p.voiceUnavailable)
            : readyArmed
              ? 'voice mode on — next reply reads itself'
              : p.providerSkips > 0
                ? skipNote(p.providerSkips)
                : '';

  return (
    <section className="voice-transport" aria-label="Voice playback">
      {/* Note line: always rendered (reserved height) so the buttons never reflow. */}
      <div className="voice-transport-note" aria-live="polite">
        <span>{note}</span>
        {p.resumeOffer ? (
          <button
            type="button"
            className="voice-transport-startover"
            aria-label="Start over from the beginning"
            onClick={p.onStartOver}
          >
            Start over
          </button>
        ) : null}
      </div>

      <div className="voice-transport-row">
        <div className="voice-transport-left">
          {p.state === 'speaking' || p.state === 'waiting' ? (
            <button
              type="button"
              className="voice-transport-btn"
              aria-label="Pause reading"
              onClick={p.onPause}
            >
              Pause
            </button>
          ) : null}

          {p.state === 'paused' ? (
            <button
              type="button"
              className="voice-transport-btn"
              aria-label="Resume reading"
              onClick={p.onResume}
            >
              Resume
            </button>
          ) : null}

          {p.state === 'failed' || p.state === 'ended-partial' ? (
            <button
              type="button"
              className="voice-transport-btn"
              aria-label="Retry reading"
              onClick={p.onRetry}
            >
              Retry
            </button>
          ) : null}

          {p.resumeOffer ? (
            <button
              type="button"
              className="voice-transport-btn"
              aria-label={`Resume reading from ${p.resumeOffer.paragraphLabel}`}
              onClick={p.onResumePlayback}
            >
              {`Resume · ${p.resumeOffer.paragraphLabel}`}
            </button>
          ) : null}

          {/* Armed-and-available: a distinct calm "ready" indicator, NOT a greyed
              Pause glyph (a disabled ⏸ reads as "paused"). Spec §3.1a. */}
          {readyArmed ? (
            <span className="voice-transport-ready" aria-label="Voice mode armed">
              ● ready
            </span>
          ) : null}

          {/* Armed-but-unavailable: honest greyed Pause (the capability really is
              off), distinct from the ready dot above. */}
          {unavailableArmed ? (
            <button type="button" className="voice-transport-btn" aria-label="Pause reading" disabled>
              Pause
            </button>
          ) : null}

          {showSkip ? (
            <button
              type="button"
              className="voice-transport-btn"
              aria-label="Skip this part"
              onClick={p.onSkip}
              disabled={armed}
            >
              Skip
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="voice-transport-exit"
          aria-label={rightIsDismiss ? 'Dismiss' : 'Leave voice'}
          onClick={rightIsDismiss ? p.onDismiss : p.onExitVoice}
        >
          {rightIsDismiss ? 'Dismiss' : 'Leave'}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass (green)**

Run: `cd apps/user-client && pnpm vitest run tests/components/chat/VoiceTransport.test.tsx`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat/VoiceTransport.tsx apps/user-client/tests/components/chat/VoiceTransport.test.tsx
git commit -m "Rework VoiceTransport into the audio toolbar contract"
```

---

## Task 2: Wire the holistic exit in the chat page

**Files:**
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx` (voice wiring ~lines 460-469, render ~645-659)

- [ ] **Step 1: Replace the stop-hint state with the holistic exit**

In `chat-page.tsx`, find this block (around lines 460-469):

```tsx
  const voiceUnavailable = voice.disabledReason;
  // One-shot hint shown the first time the user taps Stop while auto-read is on.
  const [stopHint, setStopHint] = useState(false);
  const onVoiceStop = useCallback(() => {
    voice.stop();
    if ((settings.data?.autoReadAloud ?? false) && !(settings.data?.voiceStopHintSeen ?? true)) {
      setStopHint(true);
      void updateSettings.mutateAsync({ voiceStopHintSeen: true });
    }
  }, [voice, settings.data?.autoReadAloud, settings.data?.voiceStopHintSeen, updateSettings]);
```

Replace it with:

```tsx
  const voiceUnavailable = voice.disabledReason;
  // "Leave" is the one holistic voice-surface exit: stop this playback and, if
  // auto-read is armed, turn it off too. This is what makes the toolbar the
  // single context-correct escape — and what retires the old Stop-vs-toggle hint.
  const onExitVoice = useCallback(() => {
    voice.stop();
    if (autoReadAloud) void onToggleAutoRead(false);
  }, [voice, autoReadAloud, onToggleAutoRead]);
```

- [ ] **Step 2: Update the VoiceTransport render call**

Find the `<VoiceTransport ... />` block (around lines 645-659) and replace it with:

```tsx
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
```

- [ ] **Step 3: Remove the now-unused `useState` import if it is unused**

Run: `cd apps/user-client && pnpm exec biome check --write src/routes/app/chat/chat-page.tsx`
Then verify `useState` is still used elsewhere in the file:

Run: `rg -n "useState" src/routes/app/chat/chat-page.tsx`
Expected: other `useState` call sites remain (e.g. `setStopHint` was not the only one — `tocOpen`, `branchPointId`, etc. use `useState`). Do NOT remove the import if any remain. If biome flags an unused symbol, address only that.

- [ ] **Step 4: Typecheck the change**

Run: `cd /home/chris/workspace/chatsundere && pnpm typecheck --force`
Expected: PASS — no references to `stopHint`, `onVoiceStop`, `setStopHint`, or `onDismissStopHint` remain; `VoiceTransport` is called with the new props only.

If typecheck reports a leftover `stopHint`/`setStopHint` reference, search and remove it:
Run: `rg -n "stopHint|onVoiceStop|onDismissStopHint" apps/user-client/src`
Expected after fix: no matches in `src` (the setting field `voiceStopHintSeen` may still exist in the settings schema — leave it dormant; do not migrate it away).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/chat/chat-page.tsx
git commit -m "Wire holistic voice exit, retire the stop hint"
```

---

## Task 3: Convert the toolbar CSS from floating to space-reserving

**Files:**
- Modify: `apps/user-client/src/index.css` (the `.voice-transport` block, ~lines 886-938)

- [ ] **Step 1: Replace the `.voice-transport` CSS block**

In `index.css`, replace the whole block from the `/* ===== Voice transport ===== */` comment through `.voice-transport-note { ... }` (lines ~886-938) with:

```css
/* ===== Audio toolbar (voice transport) =====
 * A real flex-child of .chat-page (like .cockpit / .affordance), NOT floating:
 * flex-shrink: 0 + order keeps it pinned above the cockpit (order 1000) in
 * interaction mode and above the affordance band (order 999) in reading mode,
 * and .chat-stream gives up height for it instead of being overlapped. The
 * slide-in is the felt mode switch (spec §1.1). Functional layout only — Chris
 * owns the styling pass (final button copy, exact sizing, colours). */
.voice-transport {
  position: relative;
  flex-shrink: 0;
  order: 998;
  z-index: 7;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.6rem 0.75rem calc(0.6rem + env(safe-area-inset-bottom, 0px));
  background: rgba(10, 10, 10, 0.95);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(12px);
  animation: voice-transport-in 200ms ease;
}
@keyframes voice-transport-in {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
/* The note line keeps a reserved height even when empty, so populating it never
 * reflows the buttons. */
.voice-transport-note {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 1.1rem;
  font-size: 0.8rem;
  color: var(--color-paper-muted, #8a8a8a);
}
.voice-transport-startover {
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--color-paper-muted, #8a8a8a);
  text-decoration: underline;
  font-size: 0.8rem;
  cursor: pointer;
}
.voice-transport-row {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
}
.voice-transport-left {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
  flex: 1 1 auto;
}
/* Large, thumb-friendly controls (>=56px) — the clumsy-mode / hold-to-talk
 * target size, deliberately bigger than the cockpit transport buttons. */
.voice-transport-btn,
.voice-transport-exit {
  min-height: 56px;
  flex: 1 1 0;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.75rem;
  color: var(--color-paper-soft, #e6e6e6);
  font-size: 0.95rem;
  cursor: pointer;
}
.voice-transport-exit {
  flex: 0 0 30%;
}
.voice-transport-btn:hover,
.voice-transport-exit:hover {
  border-color: rgba(201, 168, 76, 0.5);
}
.voice-transport-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.voice-transport-ready {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0;
  min-height: 56px;
  font-size: 0.95rem;
  color: var(--color-paper-muted, #8a8a8a);
}
@media (prefers-reduced-motion: reduce) {
  .voice-transport {
    animation: none;
  }
}
```

Note: the old mode-scoped offset rules
`.chat-page[data-mode="interaction"] .voice-transport` and
`.chat-page[data-mode="reading"] .voice-transport` are removed by this
replacement — a space-reserving flex-child needs no bottom-offset tuning. If
either selector survives elsewhere, delete it.

- [ ] **Step 2: Verify the stale mode-scoped selectors are gone**

Run: `rg -n 'data-mode="(interaction|reading)"\] \.voice-transport' apps/user-client/src/index.css`
Expected: no matches.

- [ ] **Step 3: Build the client to confirm the CSS compiles**

Run: `cd /home/chris/workspace/chatsundere && pnpm run build --force`
Expected: PASS (9/9 or current package count); no CSS/TS errors.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/index.css
git commit -m "Make the audio toolbar a space-reserving flex-child"
```

---

## Task 4: Full gate + manual verification

**Files:** none (verification only).

- [ ] **Step 1: Biome**

Run: `cd /home/chris/workspace/chatsundere && pnpm exec biome check apps/user-client/src apps/user-client/tests`
Expected: no errors (Biome bans `!`; the component uses none).

- [ ] **Step 2: Typecheck (forced — the turbo cache must not mask a test-touching change)**

Run: `pnpm typecheck --force`
Expected: PASS across all packages.

- [ ] **Step 3: Full user-client vitest (not just the touched test dir)**

Run: `cd apps/user-client && pnpm vitest run`
Expected: the 8 known Node-localStorage baseline failures only (unchanged); everything else green. If a 9th failure appears, investigate before proceeding — do not wave it through as "pre-existing".

- [ ] **Step 4: Build**

Run: `cd /home/chris/workspace/chatsundere && pnpm run build --force`
Expected: PASS.

- [ ] **Step 5: Manual verification (Chris, on device — restart `pnpm dev` first)**

These are device-tested by Chris; list them for him in the squash note:
1. Start a read-aloud → the toolbar **slides in** and `.chat-stream` shrinks (no message text occluded behind it).
2. Open the cockpit while reading → toolbar is **stacked above** the cockpit; both visible; read region clears both.
3. Tap **Leave** while reading → playback stops, toolbar slides away, cockpit (if open) untouched.
4. Turn on auto-read, let a reply finish → toolbar **stays** with the **● ready** indicator, Skip greyed, note "voice mode on — next reply reads itself".
5. Tap **Leave** in the armed state → open the cockpit → the auto-read toggle reads **OFF** (the mirror is live).
6. `prefers-reduced-motion` on → toolbar appears **hard**, note line populated on first paint.
7. Mid-read, tap **Skip** past an "as an AI…" paragraph → it advances a segment.
8. Reachability: **Leave** sits in the same corner across speaking / paused / failed (it never moves).

- [ ] **Step 6: Update STATUS + commit the doc**

Update `obsidian/STATUS-CLIENT-ONLY.md`: move the audio-toolbar concept from "next" to "done", note the device-verification pending, point to this plan + spec, and record that `stopHint` is retired and `voiceStopHintSeen` is left dormant. Commit with `[skip ci]`.

---

## Self-Review notes (filled by author)

- **Spec coverage:** §2 state identity → Task 1 (visibility + armed). §3 frame (Skip everywhere, Leave/Dismiss split, ready indicator, note line) → Task 1. §3.2 holistic exit + retire stopHint → Task 2. §4 space-reserving + stacked-above-cockpit + slide-in + reduced-motion + §4.3 budget → Task 3. §3.1a ready-not-greyed-Pause → Task 1 (component + test). §5 retirements → Task 2 (stopHint) + Task 3 (floating CSS). §8 testing → Tasks 1 + 4. All covered.
- **Type consistency:** `onExitVoice`, `autoReadOn`, `voiceUnavailable: DisabledReason` used identically in component, test props, and chat-page wiring. `voice.disabledReason` is `DisabledReason` (use-voice-playback.ts:24,54) — matches the prop type.
- **No placeholders:** every step has real code/commands.
```
