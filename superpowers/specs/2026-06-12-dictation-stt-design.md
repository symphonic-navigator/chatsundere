# Dictation / STT — speech as a prompt source

**Date:** 2026-06-12
**Status:** Laura spec-pass complete (2 hard findings: 1 fixed in-spec
(transcription cancel/timeout), 1 deferred with Chris sign-off (mic
invisibility with text — see ux-deferrals.md); 4 soft notes: 2 incorporated,
2 consciously kept) — awaiting Chris's review
**Part of:** the voice design weekend (roleplay → TEAL → playback core → **dictation**)
**Related:** [Voice Playback Core design](2026-06-11-voice-playback-core-design.md),
ADR 0034 (XState for the voice domain)

---

## 1. Purpose and background

Spec 2 of the audio-state trilogy (core → **dictation** → live voice). The user
speaks instead of typing: push-to-talk for short utterances, a VAD-driven
listening session for longer dictation with thinking pauses. Mistral Voxtral
transcribes; the transcript lands editable in the cockpit draft (or, opt-in,
sends immediately).

Context that shapes this spec:

- **The NGO board decision (2026-06-12, unanimous):** once this STT base lands,
  xAI TTS supersedes Mistral TTS; **Mistral stays for STT only**. The
  `serviceKind: 'stt'` interface must therefore make a later xAI STT offering a
  pure catalogue add, exactly as `serviceKind: 'tts'` did for TTS providers.
- **The reference implementation in `../chatsune`** is complete and
  field-tested: Silero VAD via `@ricky0123/vad-web`, a three-level sensitivity
  preset table, a separate user-tunable redemption (silence-tolerance) window,
  PTT and continuous capture, misfire handling, and the Opus/AAC-with-WAV-
  fallback recording chain. We port its infrastructure, not its state handling
  (chatsune's negative lesson — ad-hoc state grown around callbacks — is why
  ADR 0034 exists).
- **One deliberate divergence from chatsune:** Chatsundere is client-only, so
  the STT call goes **direct from the browser to Mistral** (chatsune proxied
  through its backend, which held the API key). A CORS probe gates this — see
  §10.

## 2. Scope

### 2.1 In scope

- **Push-to-talk:** hold the cockpit button, speak, release → transcribe.
- **VAD dictation session:** tap the cockpit button, speak in multiple
  utterances with pauses; each completed utterance is transcribed and appended
  to the draft; tap again to stop listening.
- The **three-level VAD sensitivity** (low / medium / high) and the
  **redemption window** (silence tolerance, user-tunable slider) — chatsune's
  preset table ported 1:1.
- **Auto-send toggle** (default off): a completed transcription sends
  immediately instead of landing in the draft.
- `serviceKind: 'stt'` in llm-unified with the **Voxtral STT offering**
  (`voxtral-mini-latest`), direct from the client.
- A small **XState v5 dictation machine** (ADR 0034) plus capture
  infrastructure ported from chatsune.
- Microphone-level feedback on the button (glow follows the mic level).
- A new **Dictation** group in My Settings → Voice.

### 2.2 Out of scope (and where it goes)

- **Barge-in, auto-read of replies, conversation orchestration** → Spec 3
  (Live Voice Mode).
- **Dictation in reading mode or in persona-editor fields** → not planned; the
  cockpit draft is the single dictation surface.
- **Voice commands** ("send", "voice off") → not planned for Chatsundere.
- **A language picker** → omakase: Mistral auto-detects; no setting.
- **Audio persistence** → none. Dictation audio is throwaway; nothing touches
  Dexie or the artefact system.
- **xAI STT** → a later catalogue add against the interface this spec creates.

## 3. Interaction model

### 3.1 The button — DualActionBtn becomes three-fold

One button, strict priority, **no mixed mode** (Chris's call: typing and
dictating never interleave; the user either types or dictates a message):

1. **Inference streaming** → Stop (unchanged today; later also TTS-stop in
   Spec 3).
2. **Capture active** (PTT held or VAD session listening) → the button is the
   recording control; tapping it ends a VAD session. The capture state owns
   the button even after the first transcript lands in the draft — otherwise
   a running VAD session would have no stop control.
3. **Draft has text** → Send.
4. **Draft empty** → Mic. Tap starts a VAD session; hold is PTT.

Restarting dictation while text sits in the draft is deliberately impossible
(send or clear first), and the mic is not shown as a disabled affordance in
that state — both accepted edges (Laura hard finding, deferred with Chris's
sign-off), logged in `obsidian/insights/ux-deferrals.md`.

### 3.2 Gesture disambiguation — no audio lost

Capture starts at `pointerdown` immediately. If the pointer is released within
~300 ms the press was a tap: the already-running capture continues seamlessly
as a VAD session. A longer hold is PTT: release ends the capture and the whole
recording goes to STT as one utterance. No press-then-decide latency, no
clipped first syllable.

### 3.3 VAD session semantics

- Silero (local, in-browser) detects utterance boundaries using the
  sensitivity preset and the redemption window.
- Each completed utterance is transcribed **while the session keeps
  listening** — the next utterance may be captured while the previous one is
  still at the STT provider. Transcripts append to the draft in completion
  order, joined with a single space.
- **Misfire** (noise burst too short to be speech — Silero fires speech-start
  but never speech-end): silent revert, no error surface.
- The session ends on button tap or on leaving the chat. A failed
  transcription does not end the session — only the affected utterance is at
  stake (§6).
- Transcripts always append at the **end** of the draft, regardless of the
  caret position — editing mid-session is allowed and never has a late
  transcript land at the caret (Laura spec-pass, soft finding).
- **No transcription is ever un-exitable:** while a transcription is in
  flight after a capture ended, the button shows a Cancel affordance —
  cancelling aborts the STT actor and returns to a usable draft. A request
  that hangs beyond a transport timeout (~30 s) routes into the §6
  Retry/Discard surface instead of spinning (Laura spec-pass, hard finding).
  A held PTT capture is controlled by its own gesture: release ends it;
  sliding off / Escape discards it.

### 3.4 Auto-send

`dictationAutoSend` (default **off**):

- **Off:** transcripts land editable in the draft (dictation in the literal
  sense). The user sends with the send button or Enter.
- **On:** PTT release → transcribe → send as a message. In a VAD session every
  completed utterance sends as its own message; the session keeps listening.
- Enabling the toggle shows a one-line in-context note in settings — "Each
  utterance sends immediately; there is no correction step" — so the user
  opts in with eyes open (Laura spec-pass, soft finding).

### 3.5 Collision with read-aloud

Starting any capture **stops** an active read-aloud playback (the speaker
would dictate into the mic). Consistent with the established
mode-change-stops-the-read behaviour.

## 4. Architecture

### 4.1 llm-unified — `serviceKind: 'stt'`

The TTS precedent, mirrored:

- `SttOfferingMeta` in the catalogue types (id, label, model, provider ref,
  `corsHint`, accepted-format notes).
- One launch offering: **Voxtral STT** (`voxtral-mini-latest`) on the Mistral
  provider.
- Wire: `POST {base}/v1/audio/transcriptions`, multipart form (`file`,
  `model`; `language` omitted → auto-detect), Bearer auth, response
  `{ text }`.
- **Direct from the client**, gated on the CORS probe (§10). If the endpoint
  turns out CORS-closed, the call routes via the authenticated CORS proxy
  using the existing `corsHint` mechanism (the xAI TTI precedent); everything
  else in this spec is unaffected.
- Filename/format hint chain as in chatsune: `recording.webm` / `recording.m4a`
  / `recording.wav` derived from the blob MIME type.

### 4.2 Capture — `lib/voice/dictation/capture.ts`

Port of chatsune's `audioCapture` (infrastructure only, no store coupling):

- **PTT path:** 16 kHz AudioContext + PCM accumulation; MediaRecorder
  (Opus/AAC where available) runs alongside for the upload blob; WAV encoded
  from PCM as the tier-3 fallback.
- **VAD path:** `@ricky0123/vad-web` `MicVAD` (Silero), preset-driven
  (`vad-presets.ts`, chatsune's table 1:1 including the comment explaining why
  `minSpeechFrames` is identical for medium and high), redemption window in ms
  from settings.
- Callbacks: `onSpeechStart`, `onSpeechEnd(audio)`, `onMisfire`,
  `onVolumeChange(level)`.
- **VAD assets from CDN:** vad-web loads ONNX Runtime WASM + the Silero model
  (~14 MB, browser-cached) from jsdelivr, pinned versions. chatsune's
  empirical finding (Vite blocks `.mjs` from `public/`) plus our embeddings
  precedent (ORT-wasm already on jsdelivr) make CDN the pragmatic choice.
  Engine code only — no audio ever leaves the browser for VAD. Service-worker
  interaction checked at plan time against the embeddings gotcha list.

### 4.3 The dictation machine — `lib/voice/dictation/dictation-machine.ts`

XState v5 (ADR 0034 — XState for the voice domain only). Deliberately small:

- States: `idle` → `capturing` (substates `ptt` | `vad`) → `idle`.
- Transcription runs in **spawned actors** (one per utterance), so a VAD
  session never blocks on a slow STT round-trip; actors auto-abort on STOP
  and on leaving the chat.
- Failure substate per §6 with the audio blob retained in context for Retry.
- Auto-send branches in the actor-completion action: append to draft vs
  dispatch send.
- The machine is chat-scoped like the playback machine; the two machines do
  not communicate in Spec 2 beyond the §3.5 stop call (Spec 3 orchestrates).

### 4.4 Glue

- `use-dictation.ts` — hook binding the machine to Cockpit/DualActionBtn
  (the `use-voice-playback` pattern).
- `resolve-stt.ts` — offering/provider resolution, mirror of `resolve-tts.ts`
  including provider-boundary error logging.

## 5. UI

- **Mic state** (draft empty, STT resolvable): mic glyph on DualActionBtn.
- **No STT available** (no enabled Mistral provider): mic rendered
  **disabled with tooltip** — "Add a Mistral provider in My Settings to
  dictate" (disabled over hidden).
- **Capture state:** the button pulses organically; **glow intensity follows
  the mic level** via `onVolumeChange` (answers "is it hearing me?" without a
  dedicated element). `prefers-reduced-motion`: static tint, no pulse.
- **Input placeholder** while capturing: "Listening…"; while a transcription
  is in flight after the session ended: "Transcribing…".
- **My Settings → Voice** gains a **Dictation** group: sensitivity
  (low / medium / high, default medium), pause-tolerance slider (0.6 s–11.5 s,
  default ≈1.7 s, chatsune's bounds), auto-send toggle, and a provider status
  line (the TTS status-line pattern). No visualiser, no overlay — restraint;
  Spec 3 gets the stage.

## 6. Error handling (constructive, the *dere* way)

- **STT call fails** (network, 429, 5xx): the audio blob is retained; a note
  above the input offers "Couldn't transcribe — **Retry** · Discard". No
  silent loss. Retry re-sends the same blob; Discard drops the failed
  utterance — a VAD session that is still listening keeps listening, a PTT
  capture returns to idle.
- **Deterministic 4xx ≠ 429** (content refusal — not expected for STT per the
  NGO's read, but the TTS hardening taught us to branch): same Retry/Discard
  surface, message names the provider's refusal honestly ("The voice provider
  declined to transcribe this recording").
- **Microphone permission denied:** constructive note with the next step
  ("Allow microphone access in your browser settings, then try again");
  button returns to mic state.
- **No microphone device / capture init failure:** same surface, honest text.
- **Misfire:** silent (§3.3).

## 7. Storage

- **Dexie:** three settings fields — `dictationSensitivity`,
  `dictationRedemptionMs`, `dictationAutoSend` — expected **v22** (head is
  v21; re-verify at plan time per the parallel-version-ownership rule).
- **No audio storage** anywhere. Blobs live in machine context for at most one
  Retry cycle.

## 8. Privacy and egress

Two new egress notes for `obsidian/insights/security-deferrals.md`:

1. **Recorded speech audio to Mistral** — user-initiated (explicit button
   gesture per utterance/session), direct, no storage server-side per
   Mistral's API terms; the same class as spoken-text-to-TTS but in the other
   direction and strictly more sensitive (raw voice).
2. **VAD engine assets from jsdelivr** — code only (ONNX Runtime + Silero
   model), pinned versions, browser-cached; no user data in either direction.

VAD itself runs entirely locally. Not a Larissa path (client-only, no
auth/sync/proxy/crypto) — judgement call recorded here.

## 9. Testing

- **Machine unit tests** (vitest, mocked capture + STT actors): PTT
  happy path, VAD multi-utterance append order, tap-vs-hold disambiguation,
  misfire revert, Retry/Discard with retained blob, auto-send branching,
  stop-on-leave-chat, read-aloud stop call.
- **DualActionBtn component tests:** four-state morph priority + the
  disabled-with-tooltip STT-less state.
- **`resolve-stt` unit tests** (mirror of resolve-tts).
- **llm-unified offering-shape tests** (bun) for `serviceKind: 'stt'`.
- `getUserMedia` / `MicVAD` fully mocked in jsdom; **live STT validation is
  manual** (provider keys never enter CI, per the curation rule).

## 10. CORS probe (gate before build)

A console probe run by Chris with his Mistral key, before the plan locks
"direct":

1. Generate a one-second silent WAV in the console (no fixture needed).
2. `fetch('https://api.mistral.ai/v1/audio/transcriptions', { method: 'POST',
   body: FormData(file, model) })` with Bearer auth, from the app origin.
3. Read: CORS verdict (preflight + response headers) **and** format
   acceptance for `audio/wav`; repeat with a MediaRecorder `webm/opus` blob
   for the compressed path.

Outcome recorded in this spec's §4.1 before implementation. CORS-closed →
`corsHint` proxy routing, nothing else changes.

## 11. Manual verification (Chris, on device)

Restart `pnpm dev` first (packages/llm-unified changes; Vite HMR ignores
`packages/*`). Needs an enabled Mistral provider.

1. Empty draft → button shows the mic. Hold it, speak one sentence, release →
   "Transcribing…" → the sentence lands in the draft, editable; button morphs
   to Send.
2. Tap the mic, speak two sentences with a genuine thinking pause between
   them, tap again → both sentences in the draft in order, one space joined.
3. While a VAD session listens, watch the button glow track your voice level;
   stay silent → glow settles.
4. Sensitivity low vs high: at high, quiet speech that passed at low no longer
   triggers (or vice versa — the difference is audible in behaviour).
5. Raise the pause-tolerance slider to several seconds → a long mid-sentence
   pause no longer splits the utterance.
6. Auto-send on: PTT release sends immediately; in a VAD session each
   utterance becomes its own message while listening continues.
7. Deny the mic permission in the browser → constructive note, no dead-end;
   re-allow → works.
8. Flight mode mid-utterance → "Couldn't transcribe — Retry · Discard"; back
   online, Retry → the text arrives; the recording was not lost.
8b. While "Transcribing…" is in flight (throttle the network to make it
    visible) → the button offers Cancel; cancelling returns to a usable
    draft with no orphaned state.
9. Start a read-aloud, then tap the mic → playback stops, capture starts.
10. With no Mistral provider enabled → the mic is visible but disabled with
    the settings-pointing tooltip.
11. Type text manually → button is Send; no dictation path while text is
    present (expected, the accepted edge).
12. `prefers-reduced-motion`: capture state shows a static tint, no pulse.

## 12. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | One button, no mixed mode | Chris: typing and dictating never interleave; simplest possible mental model |
| D2 | Capture owns the button while active | a running VAD session must keep its stop control even once text landed |
| D3 | Restart-with-text impossible | accepted edge (WhatsApp model), logged in ux-deferrals |
| D4 | Capture starts at pointerdown | tap/hold disambiguation without clipping the first syllable |
| D5 | Transcripts append, space-joined | multi-utterance dictation = one message by default |
| D6 | Auto-send default off | the draft is the safe default; STT errors get a correction window |
| D7 | Sensitivity presets ported 1:1 | field-tested values incl. the medium=high `minSpeechFrames` finding |
| D8 | No language picker | omakase — Voxtral auto-detects |
| D9 | No audio persistence | dictation audio is throwaway; privacy posture |
| D10 | VAD assets from CDN | Vite-`public/`-blocks-`.mjs` finding + embeddings precedent |
| D11 | XState machine, chat-scoped | ADR 0034; Spec 3 orchestrates both machines |
| D12 | Mistral direct, probe-gated | client-only architecture; `corsHint` proxy as the fallback |
| D13 | Starting capture stops read-aloud | the speaker must not dictate into the mic |
| D14 | In-flight transcription cancellable; hung requests time out into Retry/Discard | Laura hard finding — no dead-ends |
| D15 | No disabled-mic affordance while text is present | Chris sign-off, ux-deferrals 2026-06-12 — single-button purity (WhatsApp precedent) |
