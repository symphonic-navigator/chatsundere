# TTS High-Pass Cleanup + Inner-Monologue Easter Egg — Design Spec

**Date:** 2026-06-17
**Author:** Liz (with Chris)
**Status:** Approved (Chris brainstorm 2026-06-17). Laura spec-pass 2026-06-17 —
no hard defects; four soft findings folded in (SOFT-1/2/3 button affordance & tooltip,
SOFT-4 plain-language filter labels).
**Builds on:** the voice-playback core (`audio-sink.ts`, `voice-machine.ts`,
`resolve-tts.ts`, `voice-cache.ts`), the `serviceKind: 'tts'` interface in
`packages/llm-unified`, and the `ReasoningPill` chain-of-thought affordance.

---

## 1. Purpose

Two small, intertwined audio features that share one insertion point in the
Web Audio graph:

1. **High-pass cleanup** — a gentle, user-selectable high-pass filter on all
   normal TTS playback. xAI TTS is slightly bass-heavy; carving a little room
   "down low" lets the user turn the volume up without the low end dominating.
2. **Inner-monologue easter egg** — an explicit, manual "read" affordance on a
   chain-of-thought trace that renders the model's reasoning with an
   **ethereal, otherworldly** treatment (reverb + high-pass): the cinematic
   "the protagonist has a thought" effect, deliberately *non-human* to honour
   that the companion is an entity on a different substrate, not a human brain.

Both features attach to the existing signal chain in `AudioSink`, which today is
`source → analyser → destination` (`audio-sink.ts:48`). No move away from Web
Audio is needed; both are node-graph additions.

---

## 2. Shared Foundation — Filter Profiles

`AudioSink.play()` gains a **filter-profile** parameter. The sink builds its
node graph from the profile; everything downstream of the source is profile-derived.

```
type VoiceFilterProfile =
  | { kind: 'plain' }                       // source → analyser  (today's behaviour)
  | { kind: 'highpass'; hz: 50 | 100 }      // source → highpass → analyser
  | { kind: 'monologue' };                  // source → §4 effect chain → analyser
```

The filter sits **before** the analyser, so the spectrum visualiser reflects what
the user actually hears.

`play(blob, opts)` where `opts = { profile: VoiceFilterProfile; signal?: AbortSignal }`.
The existing single-argument call sites in `use-voice-playback.ts` (lines 107,
117) pass a resolved profile (§3); the existing abort contract is unchanged.

---

## 3. Feature 1 — High-Pass Cleanup

### 3.1 User setting

A **global, behaviour-axis** setting (audio quality, independent of persona),
surfaced in *My Settings → Voice* (`VoiceSection.tsx`):

```
Auto (recommended)  ·  Off  ·  50 Hz  ·  100 Hz
```

- Default: **Auto**.
- All four states are always shown (disabled-over-hidden is not required here —
  none is ever unavailable; they are simply selectable).
- Each state carries a **plain-language one-liner** in the house style of the
  other `VoiceSection` controls, so a non-audio-literate (and explicitly ND) user
  is never asked to choose between naked numbers (Laura SOFT-4). Proposed copy
  (final phrasing is Chris's taste call):
  - Auto — "Cleans up bass-heavy voices automatically (recommended)"
  - Off — "No filtering"
  - 50 Hz — "Gentle low-end trim"
  - 100 Hz — "Stronger low-end trim"
- Persisted alongside the other voice settings.

### 3.2 Per-offering recommendation

`TtsOfferingMeta` (`packages/llm-unified/src/catalogue/types.ts:83`) gains:

```ts
/** Recommended high-pass cut-off for the "Auto" cleanup setting. Bass-heavy
 *  providers (xAI TTS) set 50; providers needing no cleanup leave it undefined. */
defaultHighpassHz?: 50 | 100;
```

- xAI TTS offerings (`providers/xai.ts`, and the Grok offering in
  `providers/nano-gpt.ts`) set `defaultHighpassHz: 50`.
- All other offerings leave it `undefined`.

### 3.3 Resolution

At playback time, resolve the active setting against the active offering:

- `Auto`   → `offering.defaultHighpassHz` present ⇒ `{ highpass: hz }`, else `{ plain }`
- `Off`    → `{ plain }`
- `50 Hz`  → `{ highpass: 50 }`
- `100 Hz` → `{ highpass: 100 }`

This is a **pure function** `resolveCleanupProfile(setting, offeringMeta)` and is
the primary unit-test surface for this feature.

### 3.4 DSP

A single `BiquadFilterNode`:

- `type = 'highpass'`
- `frequency = 50 | 100`
- `Q = 0.707` (Butterworth, maximally flat, 12 dB/octave)

Deliberately gentle ("not too steep"). When the profile is `plain`, the node is
omitted entirely (the graph is identical to today's).

### 3.5 Scope

Applies to **all** normal playback paths driven by the voice machine: manual
read-aloud, auto-read-aloud, and live voice. The inner monologue (§4) does
**not** use this setting — it carries its own self-contained chain.

---

## 4. Feature 2 — Inner-Monologue Easter Egg

### 4.1 Trigger & placement

A small icon button at the **top-right of the open `reasoning-pill-body`**
(`ReasoningPill.tsx:90`). Properties:

- **Only rendered when the pill is open** — discovered by choosing to look at the
  thought, never served unprompted. This is the easter-egg quality. The quietness
  is **positional** (it lives inside the opened thought), *not* interaction-gated:
  once the pill is open the button is a **visible, always-rendered icon** — never
  hover-only or long-press-revealed (Laura SOFT-1; mobile-first 380 px has no hover).
- **Present-but-disabled, not absent-then-appearing.** Whenever the pill is open
  the button is rendered; it is merely **disabled** until the reasoning group is
  complete (`isLive` / `isStreamingDraft`), then **enables in place**. It must not
  materialise from nothing the instant streaming ends — a control that pops into
  existence reads as a surprise; one that lights up reads as a promise kept
  (Laura SOFT-3).
- **No TTS offering configured** ⇒ button is **disabled with a remedy-bearing
  tooltip** — it names the way out, not just the lack, matching the existing
  `disabledHint` bar in `VoiceSection` (e.g. "Add a read-aloud voice in
  My Settings → Voice to hear this.") (Laura SOFT-2; constructive-error-handling).
- One button per reasoning group; it reads that group's text.

### 4.2 Hard rule — never automatic

The inner monologue is **never** part of auto-read-aloud or live voice. The only
path to hearing a chain-of-thought is this explicit, manual button. Chain-of-thought
is not subjected to any automatic vocalisation.

### 4.3 Isolation from the voice machine

Monologue playback runs through its **own** `AudioSink`, driven by a thin
dedicated hook (`useMonologuePlayback`), **separate** from the XState voice-machine
actor. CoT reading must not perturb the read-aloud / live-voice sequencing the
machine owns.

### 4.4 Mutual exclusion (one voice at a time)

- Starting a monologue **stops** any active read-aloud.
- While **live voice** mode is active, the monologue button is **disabled with a
  tooltip** ("not during live voice"). Live voice is a conversation, not a reading
  surface.

### 4.5 Effect chain — Family B (ethereal / otherworldly)

Starting values; device-tuned by Chris afterwards. Chain inside the `monologue`
profile:

- `BiquadFilterNode` `type='highpass'`, `frequency ≈ 280 Hz`, `Q ≈ 0.7` — thins
  the low end toward airy and distant (the opposite of the warm/intimate
  treatment; this is deliberate, per the anti-anthropomorphisation rationale).
- `ConvolverNode` with a **procedurally generated impulse response**:
  exponentially-decaying stereo noise, tail ≈ 2 s. No binary asset ships — the IR
  is synthesised at runtime into an `AudioBuffer`. (A diffuse reverb tail *is*,
  at its core, thousands of overlapping reflections ≈ exponentially-decaying
  noise; for "no real room" this is more fitting than a measured space.)
- Dry/wet mix ≈ 50/50 via two `GainNode`s summed into the analyser.
- **Optional, deferred:** a subtle detune/shimmer to reinforce "not one human
  voice". Held for a later tuning pass; not in the first build.

### 4.6 Synthesis

- Uses the **persona's active TTS offering** via the existing `resolve-tts`
  path — the same provider that would read messages aloud.
- The trace text is pre-processed to **plain text** (Markdown stripped). CoT
  traces carry no TEAL expression markup, so the passthrough hazard noted in the
  voice-playback work does not apply; plain stripping is correct here.
- Long traces are **chunked and played sequentially** through the monologue
  `AudioSink`.
- Synthesised audio is cached via the existing `voice-cache`, with a **length cap**
  so an unusually long trace cannot bloat the cache.

---

## 5. Out of Scope (YAGNI)

- No per-persona or per-chat override of the cleanup filter — it is global.
- No user-configurable monologue effect (no slider zoo) — the effect is omakase.
- No low-shelf / multi-band EQ — a single high-pass per profile is enough.
- No shipped impulse-response assets or reverb library.
- No walking-glow / per-sentence anchoring for the monologue — whole-trace
  playback (chunked only when length forces it).
- **No presence / voice-band boost yet.** A mid-band lift (≈ 2–4 kHz) for
  intelligibility in noisy contexts ("in the park", background noise) is a
  plausible future companion to the high-pass, but the exact band, gain, and
  whether it should be adaptive depend on field experience we do not yet have.
  Deliberately deferred until real user reports inform it.

---

## 6. Testing

- **Unit (pure functions):** `resolveCleanupProfile(setting, offeringMeta)` across
  all four settings × {offering with `defaultHighpassHz`, offering without}; the
  procedural-IR builder's buffer shape (channels, length, monotonic decay).
- `AudioSink` itself is not testable under jsdom (no real audio — see
  `audio-sink.ts:5`); behaviour is covered by manual verification.

## 7. Manual Verification (Chris, on device)

1. xAI TTS read-aloud with cleanup **Auto** — confirm the 50 Hz cut is engaged
   and that turning the volume up no longer over-emphasises the low end.
2. Same message with cleanup **Off**, **50 Hz**, **100 Hz** — confirm audible,
   gentle differences and no steep/thin artefacts.
3. Switch to a non-xAI TTS offering with cleanup **Auto** — confirm no filtering
   (Auto resolves to off).
4. Open a chain-of-thought pill on a reasoning model (e.g. GLM or DeepSeek
   configured as a companion), tap the monologue button — confirm the ethereal
   reverb + high-pass treatment, and that it sounds "in-head / otherworldly",
   not telephone-thin.
5. With read-aloud playing, tap the monologue button — confirm read-aloud stops.
6. Enter live voice mode — confirm the monologue button is disabled with its
   tooltip.
7. No TTS offering configured — confirm the monologue button is disabled with its
   tooltip.
8. Streaming reasoning (still `isLive`) — open the pill mid-stream and confirm the
   button is **present-but-disabled** (not absent), then **enables in place** when
   the group completes.
