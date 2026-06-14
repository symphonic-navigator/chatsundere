# Live Voice Mode — Design Spec

**Date:** 2026-06-14
**Author:** Liz (with Chris)
**Status:** Drafted — pending Chris spec review + Laura state-table confirmation
**Builds on:** [`2026-06-14-audio-toolbar-design`](2026-06-14-audio-toolbar-design.md)
(the toolbar is the deliberate command-centre foundation; this spec realises its
"expression (d) = live voice"), and the read-aloud / auto-read-aloud / dictation
stack already shipped (`voice-machine.ts`, `dictation/*`, `capture.ts`).
**Supersedes:** the read-aloud-over-VAD orchestration debt logged in
[`ux-deferrals.md`](../../obsidian/insights/ux-deferrals.md) (2026-06-12).

---

## 1. Purpose

Live Voice is a **hands-free, turn-based conversation mode**. Entering it is a
felt **mode switch**, not an overlay: the chat *becomes* a voice conversation.
The audio toolbar — already cockpit-independent and space-reserving — becomes the
**sole command surface**, and one large, thumb-friendly button carries the whole
turn-taking interaction so the user can converse without aiming (the
"phone on the washing machine, hands full, plaudering while cooking" scenario
that the toolbar was dimensioned for).

The design's organising idea is a **stage metaphor**: at any moment the floor
belongs either to **the user** (microphone open, VAD listening) or to **the
persona** (microphone closed, reading aloud). The big button always tells the
user *whose* floor it is, and is always the way to take the floor back.

### 1.1 Why so much behaviour on so few controls

The mode deliberately packs four user intents — *keep talking*, *buy more time*,
*cancel what I just said*, *interrupt the persona* — onto a single large target.
This is only legible because **the button never asks the user to remember a
mode**: each state renders a distinct affordance that *names the tap it offers
right now*. The overload is tolerable precisely because the target is large, the
escape (Exit) is a constant fixpoint, and the lean-back task forbids aiming. A
control the user must *aim at* could not carry this load; a control the user
*thumbs* can, provided every state is self-describing. That self-description is
the load-bearing requirement of this whole spec.

---

## 2. Resolved design decisions

These were settled with Chris in the 2026-06-14 brainstorm (and pass a Laura
spec-pass on the concept). They are the spec's axioms; the rest follows.

1. **Hands-free by default.** Once in the mode, VAD listens continuously. The big
   button is *passive* at rest; the user simply speaks. (Not tap-to-begin.)
2. **Microphone closed while the persona speaks; manual-only barge.** There is
   **no automatic barging** — users hate being cut off for a cough or a swear
   (Chris's Discord research). During read-aloud the mic is closed (no echo, less
   battery) and the big button morphs into a *visible* "interrupt" state; a thumb
   tap stops the persona and opens the floor.
3. **An utterance can be cancelled mid-transcription.** A tap during
   "transcribing…" discards the utterance before it reaches the model — the
   frequent "no, wait —" moment. The engine already supports this (`CANCEL` in
   `drainingVad`); only the surface was missing it.
4. **Pause is a single "Hold".** One control stills the *whole* conversation —
   playback frozen, mic muted, countdown frozen — as one legible state, rather
   than a playback-pause plus a separate mic-mute. In live voice there is no
   meaningful "pause the persona but keep my mic hot".
5. **Pulsation has one agent-agnostic meaning:** "live audio presence right
   now". *Who* is speaking is established by the surrounding state, not by the
   pulse. This lets the pulse idiom be reused on the read-aloud surfaces without
   meaning two opposite things.

---

## 3. Toolbar layout in live voice

The toolbar's slot skeleton (right slot = constant escape) is inherited
unchanged. In live voice the slots resolve to:

```
[ Hold ] [ Skip ]   [ ─────  BIG TURN BUTTON  ───── ]   [ Exit ]
  left      left            centre (max width)            right (fixpoint)
```

- **Exit** (right, constant): leaves live voice mode. Never moves. The one
  context-correct escape, exactly as the toolbar spec defines it.
- **Hold** (left): the unified pause (§5). Becomes **Resume** while held.
- **Skip** (left): skips the current read-aloud segment — enabled only while the
  persona is speaking (or on a failed/`waiting` read); disabled otherwise. This
  is the existing `voice.skip()`; it serves the "skip the boring 'as an AI…'
  passage" win and needs no new machine capability.
- **Big turn button** (centre, dominant ≥56 px): the turn-taking control whose
  meaning is given per state by §4.

The note line sits above the row and is rendered only when it has something to
say (compact by default), per the toolbar's post-device amendment.

---

## 4. The state table — the heart

One row per live-voice state. "Mic" is whether the microphone is capturing.
"Tap" / "Hold" are the big button's gestures. Skip and Exit per §3. The note
line is empty unless stated (the *dere* default — the open toolbar and the
button's own affordance are signal enough).

| Phase | Big button shows | Tap | Hold | Mic | Skip | Note line |
|---|---|---|---|---|---|---|
| **Listening** — your floor, nothing captured | calm "● listening" (no pulse) | no-op (you are already heard) | hold the mic open pre-emptively | open | disabled | — |
| **You speaking** — VAD capturing | pulse (agnostic = live presence) | no-op | keep mic open through upcoming pauses | open | disabled | — |
| **Speech pause** — redemption countdown | **fills from the left** → auto-submit when full | reset fill to 0 (buy more time) | pin fill at 0 while held; release restarts from 0 | open | disabled | — |
| **Transcribing** — STT in flight | "transcribing…" animation | **cancel** this utterance (discard) | — | closed | disabled | — (or "transcribing…") |
| **Persona thinking** — awaiting first token/segment | "interrupt" affordance + presence pulse | **reclaim the floor** (abort the pending reply, open mic) | — | closed | disabled | — (or "thinking…") |
| **Persona speaking** — reading aloud | "interrupt" affordance + presence pulse | **barge** (stop TTS, open mic, you are up) | — | closed | **enabled** | — |
| **Held** — the unified pause (§5) | frozen; red, struck-through mic | Resume | — | **muted** | per prior phase | "Conversation held" |

**Reversible micro-states (no row of their own):**

- **Misfire** (a noise burst Silero retracts before it counts as speech): the
  button may have begun a presence pulse on speech-start; it reverts to
  *Listening* with no note. The user is never left believing they were heard.
- **Empty / silent utterance** (the silent-WAV path delivers an empty
  transcript, which the emit layer drops): the button cycles
  Transcribing → Listening with nothing else happening. Defined as a deliberate
  no-op so it never reads as a swallow.

**Floor-control rule.** The floor is the user's in *Listening / You speaking /
Speech pause*, and the persona's in *Thinking / Persona speaking*. Submitting an
utterance (auto-submit or Hold-release) hands the floor to the persona; a barge
or floor-reclaim hands it back. The big button's affordance is *always* the
floor signal: "● listening" / pulse = your floor; "interrupt" = the persona's.

**The one adjacent-seam to get right: Speech pause → Transcribing.** These two
phases sit back-to-back on the same button with *opposite* intents — a tap in
*Speech pause* means "buy more time", a tap in *Transcribing* means "cancel".
The state-distinct affordance is the mitigation, but a lean-back user thumbing
mid-pause cannot see a phase boundary that flips under their descending thumb. So
the fill → transcribing transition must be **unmistakable** (the fill visibly
completing and the affordance changing are not optional polish here, they are the
disambiguator), and the orchestrator should apply a **brief grace** at the flip
so a tap that *began* while the fill was running resolves as "buy more time",
never as "cancel". This is the single residual cost of the overload, narrowed to
one seam; everywhere else the phases are far enough apart that a mis-timed tap is
harmless.

---

## 5. "Hold" — the unified pause

A single control stills the **entire** conversation, whatever the current phase:

- read-aloud playback is frozen (the existing `gate: frozen`),
- the microphone is muted,
- a running redemption countdown is frozen,

…and the toolbar shows **one** held state — a red, struck-through-microphone
indicator that honestly says "I am not listening to you right now". **Resume**
returns to the phase the conversation was in. There is no separate playback-pause
versus mic-mute: pausing a live conversation *is* both, and presenting it as one
state is the omakase choice. (This is the one narrow place the red-pulse +
struck-mic motif from Chris's original idea lives on — as the *Held* signal.)

---

## 6. Error and edge states — all non-ejecting

A failure in the loop must never throw the user out of the mode. Each surfaces on
the sole toolbar surface and offers the constructive next step (the
*constructive-error-handling* tenet).

- **STT fails (transient — network / 5xx / timeout):** note
  "Couldn't hear that — Retry?" with **Retry** (re-sends the same audio) and
  **Discard** in the left region. The user may also just speak again. Stays in
  the mode. (Engine: the dictation machine's `failed` state.)
- **TTS fails (transient):** note "Couldn't read that aloud — Retry?". The reply
  text is already in the chat, so Retry is optional; otherwise the loop returns
  to *Listening*. (Engine: the voice machine's `failed` / `RETRY`.)
- **Content refusal (the Voxtral-403 pattern, a deterministic 4xx):**
  - a persona TTS segment refused → auto-skip with an honest note, exactly as
    read-aloud does today (`isContentRefusal` / `providerSkips`);
  - a user STT recording refused → an honest "couldn't process that audio" note.
  Never silent, never ejecting. Retry stays allowed (a context-scored verdict can
  flip on a second pass).

---

## 7. Entry and gating

The mode is entered from the cockpit's "live" control (the wave icon,
`data-control="live"`, currently disabled with a Block-4 tooltip). Because entry
*hides the cockpit*, the dead-cockpitless-mode must be unreachable.

- **No voice provider configured** → the entry control is **disabled with a
  reason** ("No voice provider — set one in Settings → Voice"), per
  *disabled over hidden*. The user can never enter a mode that cannot work.
- **Microphone permission denied / not yet granted** → handled on the toolbar
  itself (now the sole surface): the note line carries the constructive hint
  ("Allow microphone access in your browser to use voice") and the big button is
  greyed-with-reason rather than live-but-dead. Exit is always present. (The
  permission copy mirrors the cockpit's existing dictation copy, which is no
  longer visible once the cockpit is hidden.)
- **Pinned cockpit** (the power-user escape that keeps typing / uploads
  available): while the composer holds focus or a draft, **VAD is suppressed**
  (no mixed-mode capture) until blur / send — the microphone and the keyboard
  never contend for the user's words. This carries the Spec-2 no-mixed-mode rule
  into live voice.

The entry transition should *affirm* the new mode (the big talk button arriving
where the cockpit was), not merely subtract the cockpit — the felt mode switch is
carried by what *appears*, per the toolbar spec §1.1. The exact motion is a
design-language decision.

---

## 8. Architecture — reuse versus genuinely-new

Honest calibration: the *toolbar surface* delta is small, and the *primitives*
are reused, but the **orchestration loop is new**. "Smallest possible delta"
holds for the surface, not for the engine beneath it.

**Reused as-is:**

- `capture.startContinuous` (continuous VAD), `resolve-stt` (transcription),
  the `voice-machine` (read-aloud playback incl. Skip / Retry / `failed` /
  `waiting` / `providerSkips`), and the audio toolbar as the surface.

**Genuinely new (the work "smallest delta" under-counts):**

1. **Fill-progress instrumentation in the capture layer.** `vad-web` owns the
   redemption window internally and exposes *no* "X % through the silence"
   signal. The fill-from-left countdown (§4) needs new instrumentation — a
   silence timer driven from `onFrameProcessed`, or an equivalent — to drive the
   visible fill. (chatsune's countdown pie came from its own grace-frame logic,
   not a portable widget; we re-instrument rather than port.)
2. **"Hold suppresses submit."** `vad-web` fires `onSpeechEnd` on its own after
   `redemptionMs`. Pinning the fill at 0 while the button is held requires
   buffering / merging across hold phases so the session does not auto-submit
   mid-hold (chatsune's `heldAudioRef` pattern). The release re-arms the
   countdown.
3. **The turn-taking orchestrator.** A new live-voice machine composes the
   primitives into the stage loop (listen → capture → transcribe → send →
   think → read aloud → listen), with manual barge and floor control. The
   existing `dictation-machine` does **not** fit 1:1 — its gesture model is
   tap = VAD / hold = PTT, whereas live voice is continuous-VAD with
   hold = keep-mic-open and tap = buy-time / cancel / barge. The orchestrator is
   new; the capture, STT, and playback it drives are not.

The orchestrator owns the floor state and the microphone lifecycle (open on the
user's floor, closed on the persona's), and is the single owner of "which
toolbar row is showing".

---

## 9. Carry-over to existing surfaces (Chris-requested)

Two idioms established here are reused on the already-shipped surfaces, with the
agent-agnostic semantics of decision §2.5:

- the **presence pulse** also animates the read-aloud / auto-read-aloud surfaces
  while the persona speaks (pulse = live audio presence; the surface's state
  says who);
- the **"transcribing…" indicator** also appears when the user dictates *during*
  auto-read-aloud mode.

These are small, separable follow-ons; the plan may sequence them after the
core loop.

---

## 10. Non-goals

- **No automatic barging.** Manual, thumb-initiated only (decision §2.2).
- **No second active voice session.** One conversation at a time, as today.
- **No new persisted settings** beyond the existing VAD sensitivity / redemption
  (already in My Settings → Voice). Live voice reads the same values.
- **No drag, no gestures** beyond tap / hold on the one button (CLAUDE.md §14).
- **No change to the wire format or to TTS segmentation.**
- **No styling lock-in.** Exact motion, glyphs, fill rendering, and the entry
  affirmation are deferred to the design-language pass (mechanics first).

---

## 11. Testing

- **Unit (Vitest):** the new orchestrator machine, driven by mocked deps as the
  existing voice / dictation machines are — assert each §4 row's transitions
  (floor handover on submit, barge → mic open, transcribing-tap → discard,
  Hold → all-frozen → Resume → prior phase), and every §6 non-ejecting failure
  path. The fill-progress instrumentation gets unit coverage on the silence
  timer (reset-on-speech, pin-on-hold, fire-on-window-elapsed).
- **Presentational (Vitest):** the toolbar rows of §4 — correct big-button
  affordance, Skip enabled only while the persona speaks, note text per failure,
  greyed-with-reason on permission/provider gating.
- **Not in CI:** no live provider calls (provider keys never enter CI); the
  end-to-end loop is manual verification.

## 12. Manual verification (Chris, on device)

- The washing-machine scenario: hold a whole exchange thumbing only the big
  button, no aiming; Hold and Exit reachable without looking.
- Speak → pause → watch the fill → (a) let it submit, (b) tap to buy time,
  (c) hold to keep talking; each behaves per §4.
- "No, wait —": tap during transcribing discards the utterance; it never reaches
  the model.
- Persona reading aloud: tap to barge → TTS stops, mic opens, you are up; Skip
  jumps a paragraph without barging.
- Hold mid-exchange → everything stills, struck-mic shows → Resume returns to the
  same phase.
- Manual-only barge feels deliberate, never a dead mic: while the persona reads,
  the button visibly says "the floor is the persona's".
- Entry with no voice provider → the wave icon is disabled with a reason (never a
  dead cockpitless mode).
- Entry with mic permission denied → the toolbar explains and routes to a fix;
  Exit always works.
- Pinned cockpit: typing a draft suppresses the mic; sending / blurring re-arms
  it.
- Reduced motion: the fill and pulse degrade gracefully; meaning is never carried
  by motion alone.

## 13. Open questions / deferrals

- **Fill-progress source** (`onFrameProcessed` vs a parallel silence timer) is an
  implementation choice for the plan; both must yield a monotonic 0→1 the UI can
  read each frame.
- **Entry-affirmation motion** and all glyph / fill rendering: design-language
  pass.
- **Pulsation reuse on read-aloud surfaces** (§9): may land as a follow-on after
  the core loop; the plan sequences it.
