# Inner-Monologue Voice-UI Integration — Design Spec

**Date:** 2026-06-17
**Author:** Liz (with Chris)
**Status:** Approved (Chris brainstorm 2026-06-17). Laura spec-pass 2026-06-17 — no hard
defects; SOFT-1 ("Stop" not "Exit" in monologue mode) and SOFT-3 (calm natural-end
retirement + manual step) folded in; SOFT-2 (note copy) is an open taste call in §7.
Follows the inner-monologue easter egg
([`2026-06-17-tts-highpass-and-inner-monologue-design`](2026-06-17-tts-highpass-and-inner-monologue-design.md)).
**Builds on:** the voice-playback core (`audio-sink.ts`, `voice-machine.ts`,
`use-voice-playback.ts`), the audio toolbar (`VoiceTransport.tsx`), the spectrum
analyser (`SpectrumAnalyser.tsx`, `visualiser-noise.ts`), and `useMonologuePlayback`.

---

## 1. Purpose

The inner-monologue read button plays a chain-of-thought aloud through its own
isolated `AudioSink`, but surfaces **none** of the ambient voice UI that normal
read-aloud shows — no spectrum analyser, no toolbar. It therefore feels like a
foreign body next to read-aloud. This spec integrates monologue playback into the
same ambient surfaces, and fixes a related gap where the spectrum's "computing"
wave is missing during the initial synthesis of *any* read-aloud.

Three user-visible outcomes:

1. The spectrum analyser's wave appears while read-aloud is **being computed**
   (synthesising, before audio sounds) — today the spectrum is flat there.
2. The audio toolbar appears when the user reads a chain-of-thought aloud.
3. The spectrum analyser appears during chain-of-thought read-aloud, **including**
   its computing state.

## 2. Root cause & unifying mechanism

The three outcomes share one root: there is no precise *"playback is active but no
audio is sounding yet"* signal.

- `SpectrumAnalyser` renders the noise wave (`fillNoiseBins`) only for
  `transportState === 'waiting' || personaThinking`, and renders FFT for
  `'speaking'` (`SpectrumAnalyser.tsx:166-175`).
- The voice machine's playback region is `initial: 'speaking'`
  (`voice-machine.ts:229`); `'waiting'` is reached only for **mid-stream gaps**,
  not the initial synthesis. So when read-aloud is first triggered, `transportState`
  is `'speaking'` while audio is still being synthesised — the spectrum reads an
  empty FFT and shows a flat field.

The fix is one new signal plus one composition:

- **`isAudible`** — a frame-accurate boolean from `AudioSink`: is a source
  actually sounding right now. The spectrum shows the wave whenever playback is
  active **and not audible**, and FFT when audible. This deterministically covers
  read-aloud's initial-compute gap *and* monologue synthesis — no silence-detection
  heuristics.
- **Effective-source composition** — `chat-page` feeds the single `SpectrumAnalyser`
  and single `VoiceTransport` from the monologue when one is active, otherwise from
  the voice machine. Read-aloud and monologue are already mutually exclusive (only
  one plays at a time, enforced by the prior feature), so the switch is safe.

## 3. Component changes

### 3.1 `AudioSink` — `isAudible()`

Add `isAudible(): boolean` returning `this.source !== null` (a source exists and
has not been stopped/ended). Cheap, synchronous, safe to call every animation
frame. No other behaviour change.

### 3.2 `useMonologuePlayback` — surface state, analyser, pause/resume

The hook gains, alongside the existing `read`/`stop`/`activeId`/`disabledReason`:

- **`transportState: 'idle' | 'waiting' | 'speaking' | 'paused'`** — `'waiting'`
  while a chunk is being fetched/synthesised (`await resolution.fetchAudio`),
  `'speaking'` while `sink.play` runs, `'paused'` when paused, `'idle'` otherwise.
- **`getAnalyser: () => AnalyserNode | null`** — delegates to its own `AudioSink`.
  The analyser sits **after** the reverb chain (`buildChain` connects dry+wet into
  the analyser), so the spectrum reflects the post-effect, reverberant signal — the
  wave blooms with the tail. This is the deliberate choice (matches what is heard,
  consistent with read-aloud whose analyser is also post-filter).
- **`pause(): void` / `resume(): void`** — delegate to `AudioSink.pause()/resume()`
  (which suspend/resume the `AudioContext`; the sequential play loop's awaited
  `sink.play` promise stays pending across the suspend and continues on resume).
  `transportState` reflects `'paused'`.

`isAudible` is exposed too (delegating to the sink) so the effective-source
composition can pass it to the spectrum.

### 3.3 `SpectrumAnalyser` — wave when active-but-not-audible

Add an optional `isAudible?: () => boolean` accessor (read per frame, like
`getAnalyser`). The only change is the **bin selection inside the existing
`'speaking'` branch** (`SpectrumAnalyser.tsx:172-176`):

- Today: `transportState === 'speaking'` → `bins = getBins()` (FFT).
- New: `transportState === 'speaking'` → if `isAudible?.()` is `false`, use
  `fillNoiseBins` (the wave); otherwise `getBins()` (FFT).

Everything else is unchanged:

- The `'paused'` early-return branch (`:142`, frozen bins with a breathing
  opacity) is untouched and still takes precedence.
- The `visible` set (`transportState === 'speaking' || 'waiting' || personaThinking`)
  is unchanged — `'speaking'` already covers the initial-compute window, so no new
  visible state is needed; the wave simply replaces the empty FFT there.
- `'waiting'`/`personaThinking` still render the wave as today.

When `isAudible` is not supplied (or returns `true`), behaviour is exactly as
today, so any call site that does not opt in is unaffected. The monologue's
`transportState` (`'waiting'`/`'speaking'`/`'paused'`) maps directly onto these
existing branches — no SpectrumAnalyser state additions are needed for it.

### 3.4 `VoiceTransport` — `mode` prop

Add `mode?: 'read-aloud' | 'monologue'` (default `'read-aloud'`). In `'monologue'`
mode:

- **Hidden:** the Skip control, and any segment/read-aloud-mode/resume-offer/
  provider-skip affordances (the monologue has no segments, no mode, no resume).
- **Kept:** Pause/Resume, the right-slot exit control, the note line, and the overall
  layout/styling (visually identical to read-aloud — the "not a foreign body" requirement).
- **Right-slot label:** read-aloud labels this control **"Exit"** (`VoiceTransport.tsx:282`),
  whose semantics are "leave the voice surface / disarm auto-read". A monologue has no
  armed mode to leave — there is only one thought being read — so in `'monologue'` mode the
  control reads **"Stop"** (matching the pill button's own "Stop" title; one verb for one
  act). It still wires to `monologue.stop`. (Laura SOFT-1.)
- **Note copy:** during the monologue's computing/playback the note reads
  **"thinking aloud…"** (Chris's taste call, 2026-06-17) — a monologue-specific string
  gated on `mode==='monologue'`, echoing the easter egg's "the protagonist has a thought"
  character. Read-aloud's note is unchanged ("reading…").

All other VoiceTransport props that don't apply to a monologue are passed neutral
values (`resumeOffer: null`, `providerSkips: 0`, `autoReadOn: false`).

### 3.5 `chat-page` — compose the effective source

A single derived view selects the source for the spectrum and toolbar:

- `const monologueActive = monologue.activeId !== null`.
- **Spectrum:** when `monologueActive`, pass the monologue's `transportState`,
  `getAnalyser`, and `isAudible`; otherwise the voice machine's `transportState`,
  `getAnalyser`, and (new) `isAudible`. `personaThinking` stays as today (live-voice
  only; never true during a monologue).
- **Toolbar:** when `monologueActive`, render `VoiceTransport` with
  `mode='monologue'`, `state` = the monologue's `transportState`, and handlers
  `onPause → monologue.pause`, `onResume/onPlay → monologue.resume`,
  `onStop/onLeave → monologue.stop`; otherwise the existing read-aloud wiring
  unchanged.

`useVoicePlayback` exposes a new `getIsAudible: () => boolean` (delegating to its
`AudioSink.isAudible`) so the read-aloud path also gets the computing wave (#1).

## 4. Out of scope (YAGNI)

- No Skip/segment navigation for the monologue (it has no user-facing segments).
- No read-aloud-mode (paragraph/sentence) control for the monologue.
- No new spectrum styles or visualiser parameters — reuse `fillNoiseBins` as-is.
- No change to the monologue's audio effect chain, mutual-exclusion, or button.
- No dry-signal analyser tap — the spectrum reads the post-effect analyser (approved).

## 5. Testing

- `AudioSink.isAudible`, the monologue hook's playback, and the WebAudio paths are
  untestable under jsdom (no real audio) — covered by manual verification.
- If feasible without a real `AudioContext`, a small unit test on the
  effective-source selection (monologue-active → monologue source; idle → machine
  source) may be added; otherwise it is manual.
- The 8-failure Node-localStorage baseline must be unchanged.

## 6. Manual verification (Chris, on device)

1. Tap read-aloud on a message — during the initial "computing" delay the spectrum
   shows the **wave**, then transitions to FFT once audio sounds (no flat gap).
2. Open a chain-of-thought pill, tap the monologue button — the **toolbar appears**
   (mode-reduced: Pause/Resume + Stop, no Skip), and the **spectrum appears**, showing
   the wave during synthesis then the reverb-blooming FFT during playback.
3. Pause/Resume the monologue from the toolbar — playback freezes and continues;
   the spectrum freezes while paused.
4. Stop the monologue from the toolbar (right-slot now labelled **"Stop"**) — playback
   ends, toolbar and spectrum retire.
5. Let a monologue **finish naturally** (do not stop it) — confirm the toolbar and
   spectrum retire as calmly as they arrived (the spectrum's `FADE_RATE` envelope, the
   toolbar's state→idle retirement — the same as read-aloud's end-of-playback), with no
   abrupt pop-out. (Laura SOFT-3.)
6. Confirm the monologue toolbar is visually indistinguishable from the read-aloud
   toolbar except for the absent Skip/segment/mode controls and the "Stop" (not "Exit")
   right-slot label — no foreign-body feel.
7. Confirm normal read-aloud is unchanged (Skip, mode, resume, "Exit" still present).

## 7. Resolved taste note — the computing/playback note copy (Laura SOFT-2)

**Resolved (Chris, 2026-06-17): the monologue note reads "thinking aloud…".** Laura
flagged that reusing the plain "reading…" spends none of the easter egg's ethereal
"the protagonist has a thought" character. Chris chose the monologue-specific
**"thinking aloud…"**, gated on `mode==='monologue'`; read-aloud keeps "reading…". One
string, no structural cost.
