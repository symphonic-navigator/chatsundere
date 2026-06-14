# Spectrum Analyser — Design Spec

**Date:** 2026-06-14
**Author:** Liz (with Chris)
**Status:** Approved for planning
**Feature area:** `apps/user-client` — voice domain
**Position in the voice trilogy:** the **second** "zwischenfeature" between
**Spec 2 (auto-read-aloud, landed)** and **Spec 3 (live voice: mic, barging,
orchestration)**. Auto-read-aloud built the streaming-interleave substrate; this
spec adds the **visual** layer over the same TTS playback — a frequency-driven
spectrum analyser — so the ambient voice presence is built and device-proven
before mic capture arrives. It is a near-verbatim **port** of chatsune's voice
visualiser, adapted to chatsundere's three integration seams (data source,
colour, no sidebar).

---

## 1. Summary

Add an ambient **spectrum analyser** to the chat view: while the persona's TTS
plays, a semi-transparent canvas equaliser — vertically centred over the message
column, tinted in the active mindspace's accent colour — pulses to the live
audio frequencies. Between spoken paragraphs (the `waiting` state) it shows a
gentle idle shimmer rather than freezing. It is purely decorative
(`pointer-events: none`); all transport control stays in the existing cockpit.

The rendering core is ported essentially verbatim from chatsune's proven
implementation (`visualiserRenderers`, `visualiserBucketing`, `visualiserNoise`,
`useTtsFrequencyData`). Only three seams are adapted, plus a set of deliberate
scope cuts.

## 2. Goals / Non-goals

**Goals**

- A frequency-accurate canvas equaliser driven by the live TTS `AnalyserNode`.
- Tinted in the active mindspace accent (`--mindspace-accent`), consistent with
  the `StreamingOrb` and the ambient colour system.
- Idle shimmer while voice mode is on but no audio plays (`waiting`/armed).
- User settings (Settings → Voice): enable, style, opacity, bar count.
- Occluded automatically by any view opened over the chat (lightbox, sheets,
  modals).
- Honours `prefers-reduced-motion` (analyser rests).

**Non-goals**

- No microphone, capture, or input visualisation — that is Spec 3.
- No transcription dots (they signal STT; Spec 3).
- No tap-to-pause / screen-region gesture. Transport stays in the cockpit. (A
  richer in-canvas interaction is a noted idea for the later UI/UX uplift, out
  of scope here.)
- No `glass` style (dropped on Chris's call — poor visual result).
- No redemption-pie / countdown / barge-phase machinery (chatsune cruft tied to
  its live-voice migration).

## 3. Decisions taken during brainstorming

| Question | Decision |
|---|---|
| Pause affordance | **Cockpit only**, no screen-region gesture. Analyser is decorative (`pointer-events: none`). |
| Bar colour | **`mindspace.palette.accent`** via the `--mindspace-accent` CSS var — consistent with `StreamingOrb`. Not `persona.colour`. |
| Layering | Bars **over** the text, semi-transparent so reading is unharmed. Not behind. |
| Styles | **`sharp` / `soft` / `glow`**, default **`soft`**. `glass` dropped. |
| Settings scope | **Full** port (enable, style, opacity, barCount) in Settings → Voice. |
| Height | Slightly **taller** than chatsune (`MAX_HEIGHT_FRACTION` 0.28 → ~0.36) and a touch more transparent, to read as ambient. |

## 4. Architecture & file layout

All under `apps/user-client/src/`.

**Ported (near-verbatim, British-English identifiers preserved where already so):**

- `lib/voice/visualiser-bucketing.ts` — log-frequency bucketing of FFT bins.
  Unchanged.
- `lib/voice/visualiser-noise.ts` — deterministic idle-noise bin filler.
  Unchanged.
- `lib/voice/visualiser-renderers.ts` — the per-style draw functions.
  **Cut:** the `glass` branches and the transcription-dots functions
  (`drawTranscriptionDots`, `dotLayout`, `dotPulse`, `drawDots*`).
- `lib/voice/use-tts-frequency-data.ts` — bridges the playback `AnalyserNode` to
  log-bucketed, smoothed bins. **Adapted:** reads `sink.getAnalyser()` instead
  of the old `audioPlayback` singleton.

**New:**

- `components/voice/SpectrumAnalyser.tsx` — the fixed canvas + RAF loop,
  adapted from chatsune's `VoiceVisualiser.tsx`. Subscribes to the voice-machine
  state for play/idle, reads settings, reads `--mindspace-accent`, draws.
- `lib/voice/use-analyser-bounds.ts` — a small `ResizeObserver` hook returning
  the message-column bounds (`textColumn`) for centring. `chatview` is simply the
  viewport (no sidebar).

**Modified:**

- `lib/voice/audio-sink.ts` — insert the `AnalyserNode` (see §5).
- `lib/voice/voice-machine.ts` / its selectors — add `selectIsSpeaking` (or
  equivalent) so the analyser can distinguish `speaking` from `waiting`/`idle`.
- `routes/app/chat/chat-page.tsx` — mount `<SpectrumAnalyser>`.
- `boot/client-data-db.ts` — `SettingsRow` fields + **Dexie v25** migration.
- The Settings → Voice section component — the new controls.

## 5. Data flow

**AnalyserNode insertion (`AudioSink`).** Today: `source → ctx.destination`.
Change to `source → analyser → ctx.destination`. The analyser is created lazily
on the same `AudioContext` (`ensureCtx`), `fftSize = 256` (matching chatsune, so
the bucketing constants carry over unchanged), `smoothingTimeConstant` left at
the Web Audio default (our own exponential smoothing sits on top in
`use-tts-frequency-data`). Expose `getAnalyser(): AnalyserNode | null` (null
before the first `play()` creates the context). The analyser persists across
`play()` calls; each new `source` connects into the same analyser. `stop()` /
`dispose()` semantics unchanged.

**Frequency bins.** `use-tts-frequency-data.ts` calls `sink.getAnalyser()`,
`getByteFrequencyData`, then `bucketIntoLogBins` + per-frame exponential
smoothing — identical to chatsune. The hook needs a handle to the `AudioSink`
instance owned by `useVoicePlayback`; it is threaded down (prop or context) to
`SpectrumAnalyser`.

**Play / idle source-of-truth.** Driven by the **voice-machine** state, not an
audio singleton:

- `speaking` → real bins from the analyser.
- voice mode on but not speaking (`waiting`, or armed/auto-read-on between
  generations) → idle-noise bins.
- `idle` / voice mode off → loop parks (no RAF), canvas cleared.

The RAF loop resumes on machine-state transitions into a visible state. The
existing fade envelopes (ramp-in/out at `FADE_RATE`) are preserved so handovers
between real-bins and idle-noise stay smooth.

## 6. Geometry, visual & layering

- **Mount:** inside `chat-page.tsx` only (the analyser exists solely where TTS
  plays — not a global element).
- **Canvas:** `position: fixed; inset: 0; width/height: 100%;
  pointer-events: none; z-index: 1`. DPR clamped to 1 (soft decorative shapes;
  matches chatsune). Buffer sized from `getBoundingClientRect`.
- **Occlusion:** overlays opened over the chat (lightbox, sheets, the MCP
  approval modal) render at `z-50` / as modals, well above `z-1`, so they cover
  the analyser for free. No explicit hide logic needed.
- **Geometry:** ported `barLayout` — vertically centred (`cy = height/2`),
  horizontal extent clamped to `≤ 1.2 × textColumn`, never wider than the
  viewport. `textColumn` from `use-analyser-bounds`; `chatview` = viewport.
- **Colour:** read `--mindspace-accent` (hex) once per frame (cheap), convert to
  rgb + a brightened variant, exactly as chatsune did with the persona colour.
  Fallback to a neutral default if the var is unset.
- **Adaptation vs chatsune:** `MAX_HEIGHT_FRACTION` ~0.36 (taller), default
  opacity unchanged (0.5) but the overall read is more ambient. Bars sit **over**
  the text; semi-transparency preserves legibility (confirmed with Chris).

## 7. Settings & persistence

New `SettingsRow` fields (**Dexie v25**, backfilled with defaults):

| Field | Type | Default | Clamp |
|---|---|---|---|
| `spectrumEnabled` | `boolean` | `true` | — |
| `spectrumStyle` | `'sharp' \| 'soft' \| 'glow'` | `'soft'` | enum |
| `spectrumOpacity` | `number` | `0.5` | `[0.05, 0.80]` |
| `spectrumBarCount` | `number` | `24` | `[16, 96]`, integer |

- Read via the existing settings query (same path as `autoReadAloud`).
- UI in **Settings → Voice**: an enable toggle, a 3-way style selector
  (sharp / soft / glow), and two sliders (opacity, bar count). Changes apply
  live.
- **Behaviour-axis** setting — global, not per-persona/chat — consistent with
  the content/behaviour model.

## 8. Accessibility

- `prefers-reduced-motion: reduce` → the analyser rests (RAF runs but draws
  nothing / clears), live-subscribed via `matchMedia` exactly as chatsune.
- Canvas is `aria-hidden` (purely decorative; the spoken content and its glow
  tracking carry the meaning).

## 9. Scope cuts (explicit)

Dropped from the chatsune port, each with rationale:

- `glass` style — poor visual result (Chris).
- Transcription dots — signal STT; arrive with Spec 3 (mic).
- Redemption-pie + countdown + `pauseRedemptionStore` — chatsune's live-voice
  migration scaffolding; not present here.
- Barge / pipeline-phase ORing (`useVoicePipeline`, `usePhase`) — chatsune
  dual-phase migration cruft; chatsundere has one machine.
- `VoiceVisualiserHitStrip` + `visualiserPauseStore` — pause lives in the
  cockpit; no screen-region gesture.

## 10. Testing

- **Unit (Vitest, ported):** `visualiser-bucketing` (log-bucket boundaries, the
  coarse-FFT fallback branch), `visualiser-noise` (deterministic output),
  settings clamping (opacity/barCount bounds, style enum).
- **`AudioSink`:** a light test that `getAnalyser()` returns a node after
  `play()` where jsdom permits; otherwise covered manually.
- Renderer/canvas frames are not meaningfully testable in jsdom → covered by the
  manual-verification steps, per chatsune precedent and CLAUDE.md (manual
  verification beats automated coverage for UX features).

## 11. Manual verification (device)

Chris runs these after a `pnpm dev` restart (catalogue/lib edits need it):

1. Voice mode on → send a message → persona speaks → bars swing in the mindspace
   accent colour, vertically centred over the message column, semi-transparent,
   text stays legible.
2. Multi-paragraph reply → between paragraphs (`waiting`) the bars show idle
   shimmer, not a frozen/blank canvas.
3. Settings → Voice: switch style (sharp/soft/glow), drag opacity, drag bar
   count → each change is visible live on the next spoken reply.
4. Toggle the analyser off → canvas clears, no residual motion, RAF parked.
5. Voice mode off → no analyser at all.
6. Open a lightbox / sheet / MCP approval over the chat → the analyser is fully
   occluded; closing it restores the analyser.
7. OS `prefers-reduced-motion: reduce` → analyser rests (no bar motion) while
   audio still plays.
8. Different mindspace (different accent) → bars adopt that mindspace's colour.

## 12. Gates & audits

- `pnpm typecheck --force`, Vitest (user-client), `pnpm run build --force`,
  Biome — all green before squash.
- **Not a Larissa path** — client-only, no new network egress.
- **Laura:** touches a user-reachable flow (a new Settings → Voice subsection and
  an ambient behaviour). Spec-pass on this document; light pre-squash pass on the
  built flow.

## 13. References

- chatsune source: `chatsune/frontend/src/features/voice/` —
  `components/VoiceVisualiser.tsx`, `components/VoiceVisualiserHitStrip.tsx`,
  `infrastructure/{visualiserRenderers,visualiserBucketing,visualiserNoise,useTtsFrequencyData}.ts`,
  `stores/voiceSettingsStore.ts`.
- Prior spec: [[2026-06-13-auto-read-aloud-design]] (the substrate this builds
  on).
- Status: `obsidian/STATUS-CLIENT-ONLY.md` (the spectrum analyser was named as
  the next zwischenfeature).
