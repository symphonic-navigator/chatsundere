# Voice Playback Core — read-aloud, segmentation, cache, first TTS provider

**Date:** 2026-06-11
**Status:** Laura spec-pass complete (2 hard findings fixed in-spec, 5 soft
notes incorporated) — awaiting Chris's review
**Part of:** the voice design weekend (roleplay → TEAL → **audio state**)
**Related:** [TEAL design](2026-06-11-teal-voice-expression-language-design.md),
[Roleplay design](2026-06-11-roleplay-mode-and-user-greeting-design.md),
ADR 0034 (XState for the voice domain)

---

## 1. Purpose and background

Chatsundere's voice subproject arrives in three specs:

1. **This spec — Voice Playback Core**: read-aloud of persona messages with two
   interleave modes, a real state machine, segment highlighting, persistent
   audio caching, and one real TTS provider (Mistral, direct).
2. **Spec 2 — Dictation**: speech-to-text as a prompt source, including the
   hold-listen control and the recording-format chain.
3. **Spec 3 — Live Voice Mode**: the orchestration of both — barge-in
   (default off), auto-read, pause/resume across the conversation loop.

The deliberate strategy is **structure before providers**: the state machine,
segmentation, and cache are built and tested first; providers plug into a
stable interface. The reference implementation in `../chatsune` was studied in
full; its single biggest lesson is negative — voice features grown ad hoc end
up with *two* parallel state machines (`voicePipeline` + `bargeController`)
observing each other through callbacks. This core exists so that Spec 3 never
needs a second machine.

Three earlier decisions feed straight in:

- **Roleplay mode** (landed 2026-06-11) gives narration structure for free:
  `*asterisk narration*` versus everything else. No quote-parsing heuristics.
- **TEAL** (landed 2026-06-11) is the expression vocabulary. Its v1 *is* the
  xAI snapshot, so the future xAI TTS path passes tags through natively; the
  Mistral path strips them using the same vocabulary.
- **The feasibility verdict** (2026-06-10): segments are derived at runtime,
  never stored; **one segmentation function is the single source of truth**
  for both the spoken plaintext and the highlight spans.

## 2. Scope

### 2.1 In scope

- Read-aloud control on persona messages.
- Two interleave modes: **paragraph-by-paragraph** (default) and **smart
  sentence-by-sentence**.
- Dual voice in roleplay mode only: narration (`*…*`) speaks with a separate
  narrator voice; outside roleplay there is no narrator concept at all.
- XState statechart for playback (ADR 0034), chat-scoped.
- Segment highlight (glow in/out) following playback in the chat stream.
- Persistent per-segment audio cache in IndexedDB (Dexie), LRU by byte
  budget, writes count as use.
- Mistral TTS as the first provider, **direct** (Mistral sends CORS headers —
  no proxy involvement), as a `serviceKind: 'tts'` offering in llm-unified.
- Per-persona voice configuration (`voice`, `narratorVoice`) + a global
  interleave-mode setting (Dexie v21).
- Position memory: leaving the chat stops playback and remembers the
  position for the session.

### 2.2 Out of scope (and where it goes)

- Dictation / STT — Spec 2.
- Live voice mode, barge-in, hold-listen, auto-read after a response —
  Spec 3.
- xAI and nano-gpt TTS — separate provider-onboarding sessions against the
  interface this spec defines (TEAL passthrough is designed for here, built
  there).
- Tap-a-segment-to-replay — future; the stable segment addressing introduced
  here (`messageId` + segment index) is its foundation.
- Reading user messages aloud — not offered. Persona messages only.

## 3. Architecture

Four layers, dependency-ordered:

```
packages/llm-unified        serviceKind 'tts', Mistral offering, TEAL hook
        ↓
apps/user-client/src/lib/voice/
    segmentation.ts         pure functions — THE single source of truth
    voice-machine.ts        XState statechart + actors
    audio-sink.ts           thin Web Audio wrapper
    voice-cache.ts          Dexie LRU blob cache
        ↓
stores / React              machine bound via @xstate/react, chat-scoped
        ↓
UI                          read-aloud control, glow, settings sections
```

### 3.1 llm-unified — `serviceKind: 'tts'`

Follows the TTI precedent exactly: a new service kind, a Mistral offering
with a curated voice catalogue, and a config type.

```ts
interface TtsResult {
  blob: Blob          // encoded audio as returned by the provider
  mimeType: string    // recorded verbatim; playback decodes, cache stores
}

synthesise(text: string, voice: string, signal: AbortSignal): Promise<TtsResult>
```

The engine returns the **encoded blob, never PCM** — this is the cache
precondition (PCM at 24 kHz mono ≈ 5.7 MB/min; encoded audio is roughly an
order of magnitude smaller). Decoding happens at playback time in the sink.

**TEAL translator hook.** Each TTS offering declares how it treats TEAL:

- `mistral`: **strip** — remove all v1 tags (inline and wrapping) from the
  spoken text, reusing the TEAL vocabulary and the shared `code-mask.ts`.
- `xai` (later): **passthrough** — TEAL v1 is the xAI snapshot.

The hook lives in llm-unified beside the offering, so a provider's tag
treatment is part of its curation, not client guesswork.

**Format strategy.** We cache whatever the provider returns and record its
`mimeType`. Mistral empirically returned MP3 in chatsune — MP3 decodes
everywhere via `decodeAudioData`. Opus is preferred **per provider,
opportunistically**, never as a global rule: Safari's `decodeAudioData`
cannot decode ogg/webm-Opus, so a global Opus mandate would immediately
require fallback machinery this spec does not need. The format probe is part
of provider onboarding (empirical truth over docs). The chatsune Opus
preference concerned the *recording* upload chain and returns in Spec 2.

### 3.2 `segmentation.ts` — the single source of truth

Pure functions, no I/O, densest test coverage in the unit.

```ts
interface SpeechSegment {
  segmentId: string              // `${messageId}:${index}` — stable, replay-ready
  spokenText: string             // markdown-stripped, TEAL handled per provider hook
  blockIndex: number             // which content block (paragraph) it belongs to
  charRange: [number, number]    // range within the block, for sentence-level glow
  voice: 'dialogue' | 'narrator' // narrator only ever emitted in roleplay mode
}

segmentMessage(blocks: ContentBlock[], opts: {
  mode: 'paragraph' | 'sentence'
  roleplay: boolean
}): SpeechSegment[]
```

Rules:

- **Paragraph mode** cuts at content-block boundaries. One block, one
  segment (subject to the roleplay voice cut below).
- **Sentence mode** cuts *within* blocks using native `Intl.Segmenter`
  (`granularity: 'sentence'`), then merges short results forward (minimum
  effective length: 20 characters for the first segment, 30 thereafter —
  chatsune's empirically tuned guards). Chatsune's streaming sentence
  splitter — eight interleaved hand-rolled scanners — is deliberately **not
  ported**; during streaming (Spec 3) segmentation only ever happens at
  completed-paragraph boundaries, and sentence mode subdivides paragraphs
  that are already complete. The "sentence boundary inside a half-streamed
  markdown construct" problem therefore does not exist in this design.
- **Roleplay mode** additionally cuts at asterisk-narration boundaries and
  labels `*…*` spans `narrator`. Outside roleplay, everything is
  `dialogue` and asterisks are ordinary text.
- **Spoken-text derivation** strips, in order: fenced/inline code (replaced
  with nothing — code is never read aloud), markdown links (keep the
  label), headings/emphasis markers, list markers, blockquote markers,
  standalone URLs, and emoji. **TEAL tags are retained** — `spokenText` is
  canonical and provider-agnostic; the provider's TEAL hook (§3.1) is
  applied by the TTS layer immediately before `synthesise`. The cache key
  hashes the canonical `spokenText` (provider and voice are separate key
  components, so strip-vs-passthrough never collides). Segments whose
  spoken text is empty after stripping are dropped (their blocks simply
  glow-skip).
- `blockIndex`/`charRange` always refer to the **rendered** content so the
  glow layer needs no second mapping pass. Drift between spoken text and
  highlight spans is the classic failure mode; deriving both from one
  function call is the whole point of this module.

### 3.3 `voice-machine.ts` — the XState statechart

One machine per playback session, chat-scoped (ADR 0034). Sketch:

```
idle
 └─ PLAY(messageId, segments) → active
active  (parallel)
 ├─ playback:  speaking ──SEGMENT_DONE──▶ speaking (next) … ─▶ done
 └─ fetcher:   fetching segment n+1 (actor: cache → synthesise)
active ──PAUSE──▶ paused ──RESUME──▶ active
active ──STOP──▶ idle
active ──LEAVE_CHAT──▶ idle  (records { messageId, segmentIndex } first)
fetch failure ──▶ failed(segmentIndex) ──RETRY──▶ active │ ──SKIP──▶ active (n+1)
```

- **Prefetch one ahead**: while segment *n* plays, the fetcher actor
  resolves *n+1* (cache hit or live synthesis). Synthesis requests are
  XState actors — leaving the owning state **automatically aborts** them
  (the `AbortSignal` is wired into `synthesise`). Stop, leave-chat, and
  failure paths get cancellation for free instead of by discipline.
- **Pause** suspends the `AudioContext` (sample-accurate freeze, chatsune's
  `suspend` semantics — resume continues mid-word). It does not tear down
  sources or the queue.
- Mode and voice are read **at PLAY time**; changing the interleave mode or
  a persona voice mid-playback affects the next PLAY, never the running one
  (least astonishment, and no mid-flight segment remapping).
- The machine survives Reading↔Interaction mode switches and scrolling
  untouched. Navigating away from the chat sends `LEAVE_CHAT`.
- The machine exposes `currentSegmentId` and its state value as React
  selectors (`@xstate/react`); the glow layer and the controls subscribe to
  exactly that — no parallel UI state.

### 3.4 `audio-sink.ts`

A deliberately thin wrapper: `decodeAudioData(blob)` → `AudioBufferSourceNode`
→ `onended` fires `SEGMENT_DONE` into the machine. Owns the lazily created
`AudioContext` and its `suspend()`/`resume()`. Nothing else lives here — no
queue, no state. (Speed/pitch modulation à la chatsune's SoundTouch worklet
is consciously not in v1.)

### 3.5 `voice-cache.ts` — persistent LRU blob cache

Dexie table `voiceAudio` (schema bump §6):

```ts
interface VoiceAudioRow {
  key: string        // hash(spokenText, provider, model, voice)
  blob: Blob
  mimeType: string
  bytes: number
  lastUsedAt: number // updated on read AND on write
}
```

- The key deliberately excludes the message id: a regenerated reply whose
  paragraph is unchanged hits the cache; edited text invalidates itself; the
  same sentence in two chats is synthesised once.
- **LRU by byte budget**: `VOICE_CACHE_OPTS = { maxBytes: 64 * 1024 * 1024 }`
  (device-tunable constant). On every write, evict oldest-`lastUsedAt` rows
  until the total fits. Reads and writes both touch `lastUsedAt`, so a burst
  of new synthesis evicts the *least recently heard* entries — Chris's
  explicit requirement.
- A cache `get` that fails to decode at playback time deletes the row and
  falls through to live synthesis — the user never sees a poisoned entry.

## 4. UI

Mechanics-first; styling stays minimal for Chris's pass.

- **Read-aloud control** on every persona message — it **starts** playback,
  nothing more. Primary home: **Reading Mode** (chatting is ~80 % reading;
  navigation and consumption belong there). It is revealed by the existing
  tap-to-expand message rail.
- **Persistent transport** (Laura spec-pass, hard finding): the per-message
  control starts playback; a **transport governs it**. While the machine is
  `active`, `paused`, or `failed`, a single always-visible affordance
  (play/pause · stop) is bound to the machine — **independent of
  `expandedMessageId`, scrolling, and the mode**. Reading Mode hosts it in
  the `ReadingToolStrip` (the `position:fixed`-in-transform trap is already
  solved there); Interaction Mode gets an equivalent compact surface. The
  audio deliberately outlives the message rail (§3.3), so its controls must
  too — without this, collapsing a message strands the user with running
  audio and no reachable stop.
- **Resume on return** (Laura spec-pass, hard finding): on entering a chat
  with a same-session remembered position, the transport surfaces
  **Resume · ¶k** with a secondary **Start over** — a first-class
  invitation, not a property of an expanded message the user must
  rediscover. Resume is offered only while a same-session position exists;
  after a reload the transport simply does not appear and the per-message
  control returns to its plain play state (no stale Resume that secretly
  starts over).
- **One canonical restart**: mid-playback the transport offers *Stop* only —
  restarting is just playing again from idle; on return the pair is
  *Resume* / *Start over*. No third restart affordance anywhere.
- **No TTS provider configured / no persona voice** → the control renders
  **disabled with a tooltip** (disabled over hidden). Tooltip tone is
  differentiated: these two are **actionable invitations** naming the fix
  ("Set a voice in My Settings"), whereas the nothing-readable case (§5) is
  a calm statement of fact — the user must never go hunting in settings for
  a "problem" that is just a code block.
- **Glow**: the block (paragraph mode) or span (sentence mode, via
  `charRange`) carrying `currentSegmentId` glows in and out with a CSS
  transition. The playback glow is a **steady tracking indicator, not an
  organic effect**: fixed intensity, one calm in/out per segment, no
  per-segment random motion, no layout shift at 380 px, and it degrades to
  a static tint under `prefers-reduced-motion`. (The house "organic
  variation" rule is authored for sparse moments of presence; a highlight
  firing dozens of times per reply is exactly what the neurodivergent
  audience finds taxing.) Paragraph glow rides the existing
  `markdown-components` block-wrapper precedent; sentence glow wraps the
  range in a span at render time.
- **Settings**:
  - My Settings → new **Voice** section: interleave mode
    (paragraph default — omakase; sentence as the alternative). The section
    shows the configured TTS provider state.
  - Persona editor: `voice` picker; `narratorVoice` picker **visible only
    when roleplay mode is on** for that persona (it has no meaning
    otherwise), defaulting to the dialogue voice.

## 5. Error handling

Constructive throughout (the *dere* half):

- **Synthesis failure mid-playback**: the machine parks in
  `failed(segmentIndex)`; the position is preserved; a compact note with
  **Retry** (re-synthesise this segment) and **Skip** (advance to the next)
  appears **on the persistent transport** (§4 — not on the expanded-message
  rail, which may be collapsed). No silent stop, no lost position.
- **Skip off the end**: if Skip from the final failed segment reaches
  `done`, the transport closes with a one-line constructive note
  ("Couldn't finish reading aloud — Retry?") instead of a bare stop — a
  partial read-through is acknowledged, never silently terminated.
- **All-segments-empty** (e.g. a message that is one code block): the
  control is disabled for that message with a tooltip ("nothing to read
  aloud here").
- **Cache decode failure**: evict, re-synthesise, carry on (§3.5).
- Mistral being unreachable behaves exactly like synthesis failure — there
  is no separate offline path in v1.

## 6. Storage

- **Dexie v21** (v20 belongs to roleplay; **re-verify the head version at
  plan time** per the parallel-version-ownership rule):
  - new table `voiceAudio` (§3.5), indexed on `key` and `lastUsedAt`;
  - `SettingsRow.voiceMode: 'paragraph' | 'sentence'` (default `paragraph`);
  - `PersonaRow.voice?: string`, `PersonaRow.narratorVoice?: string`
    (provider-voice ids; unset → read-aloud control disabled for that
    persona with the constructive tooltip).
- Position memory is an **in-memory session map** (`chatId → { messageId,
  segmentIndex }`), deliberately not persisted: surviving a reload is not
  worth a schema field; restarting from the beginning after a reload is
  acceptable.

## 7. Testing

- `segmentation.ts` — the densest suite in the unit (pure functions):
  paragraph cuts, sentence cuts via `Intl.Segmenter` incl. the min-length
  merge, roleplay asterisk voice cuts, TEAL strip vs identify, markdown/code
  stripping, empty-segment dropping, charRange correctness against rendered
  content.
- `voice-machine.ts` — event-sequence tests with mocked actors:
  play→pause→resume continuity, stop, LEAVE_CHAT records position and aborts
  the in-flight fetch (assert the `AbortSignal` fired), prefetch one-ahead,
  failure→retry, failure→skip, mode changes apply at next PLAY only.
- `voice-cache.ts` — LRU eviction by byte budget, write-counts-as-use
  ordering, decode-failure eviction path.
- llm-unified Mistral TTS — structural tests via `bun test`; live behaviour
  verified per curation discipline (provider keys never enter CI).
- Glow components — vitest component tests (segment id in → classed
  block/span out).
- `audio-sink.ts` — manual verification only (jsdom has no real audio);
  kept thin precisely so this is acceptable.

## 8. Manual verification (Chris, on device)

Restart `pnpm dev` first — `packages/llm-unified` changes.

1. Configure Mistral TTS in My Settings, give a persona a voice; open a chat
   with a long multi-paragraph reply → tap read-aloud in Reading Mode → it
   speaks paragraph by paragraph, the playing paragraph glows in and out.
2. Switch the Voice setting to sentence mode → play another message → it
   speaks sentence by sentence, the glow walks sentence spans.
3. Roleplay persona with a distinct narrator voice → a reply with asterisk
   narration alternates voices at the asterisk boundaries; a non-roleplay
   persona never switches voice.
4. Pause mid-word → resume → it continues exactly where it stopped (not at
   the segment start). Stop → from-the-beginning restarts.
5. While playing, switch Reading↔Interaction mode and scroll — playback is
   undisturbed **and the transport stays visible and operable in both
   modes**; collapse the speaking message (tap another message) → audio
   continues and pause/stop remain one tap away on the transport. Navigate
   to the Entrance Hall — playback stops. Return to the chat → the
   transport offers **Resume · ¶k** with *Start over* beside it.
6. Play the same message twice — the second run starts audibly instantly
   and the network tab shows no synthesis requests (cache hit).
7. Regenerate a reply that repeats a paragraph verbatim → that paragraph
   plays from cache (no request), changed paragraphs synthesise fresh.
8. Enable flight mode mid-playback → the constructive failure note appears
   with Retry and Skip; Skip advances; disabling flight mode + Retry heals.
9. A message containing a TEAL tag (`[laugh]`, `<whisper>`) is spoken
   without the tag text being read out; a message that is only a code block
   has a disabled read-aloud control with the explanatory tooltip.
10. Remove the persona's voice → the control disables with the tooltip
    naming the missing configuration.
11. Reload the app mid-listen → no Resume is offered anywhere; the
    per-message control is back to plain play (position memory is
    session-only and honest about it).
12. With `prefers-reduced-motion` enabled (OS setting), play a message →
    the glow degrades to a static tint, no pulsing.

## 9. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Three-spec decomposition (core → dictation → live voice) | one scope per session; dictation shares almost nothing with playback |
| D2 | XState for the whole voice domain, from Spec 1 | Spec 3 (barge ∥ mic ∥ playback) is the textbook statechart case; retrofitting later would rebuild this core — ADR 0034 |
| D3 | Paragraph mode is the default | naturalness beats latency (Chris); sentence-by-sentence sounds disjoint across sentence boundaries |
| D4 | Sentence mode via `Intl.Segmenter` inside completed paragraphs; chatsune's streaming sentencer not ported | removes the most fragile component of the reference implementation entirely |
| D5 | Dual voice exists only in roleplay mode | roleplay's asterisk narration provides the structure for free; outside roleplay a narrator has no meaning |
| D6 | Engines return encoded blobs, never PCM | cache precondition; PCM is ~10× larger |
| D7 | Cache key = hash(spokenText, provider, model, voice), not messageId | regeneration reuse, self-invalidation on edit, cross-chat dedup |
| D8 | LRU by byte budget, read **and** write touch `lastUsedAt` | Chris's explicit requirement: new writes evict the least recently *heard* |
| D9 | Opus per provider opportunistically, never globally | Safari `decodeAudioData` cannot decode ogg/webm-Opus; the chatsune Opus memory was the recording side (returns in Spec 2) |
| D10 | Playback survives mode switches, dies on chat leave (position remembered, in-memory) | Chris's call; simplest state that preserves the listening flow |
| D11 | Mode/voice changes apply at next PLAY, never mid-flight | least astonishment; no mid-flight remapping |
| D12 | Mistral first, direct (CORS open), xAI/nano-gpt via later onboarding sessions | simplest provider proves the pipeline end-to-end; relieves the proxy |
| D13 | No speed/pitch modulation in v1 | scope discipline; chatsune's SoundTouch path adds latency and complexity with no current ask |
| D14 | Persistent transport governs playback, independent of the tap-to-expand rail; per-message control only starts it | Laura spec-pass hard findings 1+2 — the audio outlives the message rail, so its controls must too; also carries Resume-on-return and the failure Retry/Skip |
| D15 | Playback glow is a steady tracking indicator (fixed intensity, no organic variation, reduced-motion fallback) | Laura spec-pass — continuous randomised motion is taxing for the ND audience; "organic variation" is for sparse moments of presence |
