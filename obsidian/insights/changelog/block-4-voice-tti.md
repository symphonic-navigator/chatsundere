# Changelog — Block 4 · Voice & TTI

> Archived from `STATUS-CLIENT-ONLY.md` on 2026-06-18 (STATUS reorg).
> Reverse-chronological. Chapter index: [[README]].


## Session log

**Earlier (2026-06-14) — AUDIO TOOLBAR LANDED** (squash `19b9223` on
master, **NOT pushed**, **device-confirmed by Chris on multiple sizes** — "richtig
toll von der Bedienung her", "wunderschön"). The realisation of Chris's
control-bar concept and the foundation for Spec 3's cockpitless live-voice mode —
and we are now **live-voice ready** (Chris has a "hold to keep talking" button
concept for the next session). The floating `VoiceTransport` is rededicated into a
**space-reserving, cockpit-independent audio toolbar**: a flex-child of
`.chat-page` (order 998) that **shrinks the read region instead of overlapping
it** and stacks **above** the cockpit in interaction mode. **Icon + label
controls** (inline SVG, playback cluster left, **Exit** pinned right with
space-between, "leave space free"); the right slot is a constant escape
(**Exit** / **Dismiss**). **Skip is first-class wherever something plays** (the
"skip the boring passage" win). Visibility tracks an **active voice session**
(playing / auto-read **armed** / resume offer): armed shows a distinct **● ready**
indicator (not a greyed Pause — §3.1a), armed-but-unavailable shows a greyed
Pause + reason. The holistic **Exit** stops playback and turns auto-read off
when armed — which **retires the old one-shot stop hint** (`voiceStopHintSeen`
left dormant in the settings schema). The **note line collapses when empty**
(post-device: the auto-read explanatory text dropped, toolbar stays compact;
honesty-critical notices still surface). Slides in as a felt mode switch; rests
under `prefers-reduced-motion`.

**Two device-found bugs fixed in this unit:** (1) **Skip was a no-op mid-read** —
the voice machine only handled `SKIP` in the `failed` state; now handled in
`speaking` too (mirrors `onDone`: next segment / clean idle when stream complete /
park in waiting), covering `paused`. 3 new machine tests. (2) **Toolbar sat below
the cockpit** — the cockpit's `order:1000` was inert because its focus-capture
wrapper was a normal block; gave the wrapper `display:contents` so the order
hoists to the `.chat-page` column. Built **subagent-driven** then iterated inline
on Chris's device feedback (icons+labels, compact note, Exit). **Laura: no hard
defects** across spec-pass + pre-squash + final sweep; soft notes (reduced-motion
note-on-first-paint narrowing) logged in [[insights/ux-deferrals]], Chris-signed.
Not a Larissa path (client-only, no egress). Gates: `pnpm typecheck --force`
**14/14**; `pnpm run build --force` **9/9**; biome clean; voice-machine **19/19** +
`VoiceTransport` **12/12**; full user-client vitest baseline unchanged (8
Node-localStorage + 1 known stream-manager flake). Spec/plan (with post-device
amendments): [[../../../superpowers/specs/2026-06-14-audio-toolbar-design]],
[[../../../superpowers/plans/2026-06-14-audio-toolbar]]. **Next:** Chris pushes the
master backlog on his word → then **Spec 3 (live voice)** plugs the hold-to-talk
button into the toolbar's slot frame (no infrastructure rebuild — the space and
cockpit-independence already exist; Chris brings the button concept).
**Earlier (2026-06-14) — SPECTRUM ANALYSER LANDED** (squash `3279cba` on
master, **NOT pushed**, **device-confirmed by Chris** — "ganz toll, ich finds
super"). The **second** of the two "zwischenfeatures" before Spec 3 (live voice).
An ambient canvas equaliser over the chat that pulses to the persona's TTS during
read-aloud, tinted in the active **mindspace accent**, ported from chatsune and
adapted to chatsundere's seams: an **AnalyserNode** inserted into `AudioSink`
(`source → analyser → destination`, fftSize 256); play/idle driven by the voice
machine's **`transportState`** (`speaking` → live bins, `waiting` → idle shimmer,
`paused` → frozen breath, else → park); colour reactively from the mindspace
store; geometry centred on `.chat-stream` (no sidebar → `chatview` = viewport). A
**spectral-tilt** compensation (`visualiser-tilt.ts`, `BASS_GAIN 0.45` /
`TREBLE_GAIN 1.3`, device-tuned with Chris) flattens speech's bass-heavy spectrum
so the low bars stop saturating. **Decorative only** (`pointer-events: none`,
`z-1`, occluded for free by `z-50` overlays); transport stays in the cockpit —
**Chris has a solved pause-UX idea for live voice** ("wird genial", to design
together next context). Settings (enable / style sharp·soft·glow default soft /
opacity / barCount) persist via **Dexie v25**; rests under
`prefers-reduced-motion` AND the global `animationsEnabled` switch. Built
**subagent-driven** (10 TDD tasks, two-stage review each + final holistic + Laura
pre-squash — all APPROVED; the full-suite gate caught one stale verno=24 test
assertion the migration task missed). Not a Larissa path (client-only, no
egress). Gates: `pnpm typecheck --force` **14/14**; user-client vitest **8
baseline** Node-localStorage failures (unchanged) / 1661 pass; `pnpm run build
--force` **9/9**; biome clean. Spec/plan:
[[../../../superpowers/specs/2026-06-14-spectrum-analyser-design]],
[[../../../superpowers/plans/2026-06-14-spectrum-analyser]]. **Laura:** no hard defects;
SOFT-1 (off-state sub-controls collapse) → kept + logged in
[[insights/ux-deferrals]]; SOFT-2 (global `animationsEnabled` has no user-facing
UI) → [[insights/follow-ups-index]]. **Next:** Chris pushes the master backlog →
then **Spec 3 (live voice)** — the final voice unit (mic, barging, orchestration).
**Chris's pause-UX concept for it — NOW BUILT as the audio toolbar (squash
`3cfda8a`, see top entry).** It superseded both the deferred in-canvas
tap-to-pause gesture (Pause-Geste brainstorm) and the cockpit-only stopgap the
spectrum analyser shipped with, exactly as planned, and is the agreed home for
all voice transport in Spec 3.
**Earlier (2026-06-13)** — **AUTO-READ-ALOUD VOICE MODE LANDED**
(squash `e39c70b` on master, **NOT pushed**, **device-confirmed by Chris 2026-06-14**). The
first of two "zwischenfeatures" before Spec 3 (live voice), chosen over the
spectrum analyzer because it is the architectural bridge — the interleaving of
LLM inference and TTS. A global, persisted cockpit **voice-mode toggle**: while
on, every newly generated persona reply **reads itself aloud as it streams**,
paragraph by paragraph. **One `committedPrefix` view** (paragraphs closed by a
blank line, fence-aware) drives BOTH the TTS segments AND a **progressive
markdown render** — committed paragraphs settle into final markdown with the glow
tracking, the open tail stays raw; segment ids and glow anchors align **by
construction** (same coalesced view, mirroring `stream-engine.appendText`), which
dissolves the streaming-vs-finalised block-index problem. The XState voice
machine gained a streaming **`waiting`** state (the seam Spec 3's mic+barging
attaches to); an **auto-read driver inside `useVoicePlayback`** feeds it
PLAY/SEGMENTS_UPDATED/STREAM_DONE off the stream-manager draft (length/done
dedup, supersede-on-new-draft, mode-off STOP). **Laura H1+H2 incorporated:**
touch-reachable disabled reason on the cockpit toggle (tap reveals + routes to
Settings → Voice, not hover-only `title`) AND the manual read button; `aria-disabled`
for AT; a calm **"reading…"** note during the silent `waiting`; a **one-shot
first-Stop hint**. Settings gain `autoReadAloud` + `voiceStopHintSeen` (**Dexie
v24**). Built **subagent-driven** (10 TDD tasks, two-stage review each — the
reviews caught a real off-by-one in `committedTextLength`, a machine test gap,
per-token dispatch churn, and a Critical missing `currentMessageId` forward; the
full-suite gate caught verno head-assertions in `tests/unit` the per-task suites
missed). Final holistic (Opus) + Laura pre-squash: **PASS, ready to squash**.
Not a Larissa path (client-only, no new egress). Gates: `pnpm typecheck --force`
**14/14**; user-client vitest **1647 pass / 8 fail** (unchanged Node-26
localStorage baseline); `pnpm run build --force` **9/9**; biome clean on all
feature files (one pre-existing `index.css` quote nit on master is unrelated).
Spec/plan: [[../../../superpowers/specs/2026-06-13-auto-read-aloud-design]],
[[../../../superpowers/plans/2026-06-13-auto-read-aloud]]. **Device test (spec §11,
nine steps + 3a; restart `pnpm dev`):** toggle lights / greyed-with-tap-reveal;
reply speaks after the first paragraph closes while later ones stream, glow
tracks; multi-paragraph follows + waits silently ("reading…") without a premature
finish; opener auto-reads; new send stops current; Stop keeps mode on (+ one-shot
hint once); mode-off silences; toggling on mid-convo does not read history; code
block reads prose + skips fence without stutter. **Two Laura soft notes (for
Chris to arbitrate):** manual read button discloses the reason but offers no
route-to-Settings (asymmetric with the toggle, spec-conformant); "reading…" leans
on static copy — a breathing/pulse cue is the natural home (styling pass).
**Next:** Chris device-tests → pushes the master backlog → then the **second
zwischenfeature: the spectrum analyzer** (port from chatsune's frontend, taller,
semi-transparent background in the mindspace colour) → then **Spec 3 (live
voice)**.
**Earlier (2026-06-13) — READ-ALOUD HIGHLIGHT TRACKING FIXED**
(single squash on master, **NOT pushed**; **DEVICE-CONFIRMED by Chris** — read a
full long structured kitten/Mistral message aloud end-to-end, the glow tracks
correctly throughout: "es läuft wirklich exzellent"). Chris reported the
playback glow getting stuck, vanishing, and "Nachschleifen" (a block highlighted
that is no longer playing). **Systematic debugging + a browser-console anchor
dump from Chris's live session** killed an early wrong "mode-divergence" theory
and pinned FOUR distinct root causes. **RC1** — segment ids are block-qualified
only (`block:ord`, NOT message-unique) and `ChatStream` passed `currentSegmentId`
to every message → phantom glow on same-id segments of other messages → fixed
with a `currentMessageId` gate (machine selector `selectCurrentMessageId` → hook
→ ChatStream routes the id only to the playing message). **RC2** — the glow class
is toggled imperatively on ReactMarkdown-owned DOM; the async shiki load
re-renders `MarkdownContent` without changing the effect deps, silently dropping
the class → fixed by subscribing `MessageBlock` to `useHighlighter` (+
`useLayoutEffect`) so it re-applies on the freshly-built nodes. **RC4** — one
spoken segment can render as several sibling top-level elements (an intro/heading
line glued to a list with NO blank line is ONE raw paragraph → ONE audio, but
`<p>` + `<ul>` both carry the same id); `querySelector` matched only the first →
`querySelectorAll` glows every element of the segment. **RC5** — a loose list
(blank-line-separated items) is several raw paragraphs → several segments nested
in ONE `<ol>`; the top-level-only anchor pass left items 2..N unanchored so their
glow vanished (observed at "2. Concurrency ohne Koordination") → `rehype-voice-
anchor` now anchors each `<li>` by its own paragraph when items span >1 raw
paragraph (tight lists keep the whole-element glow; list items never wrap
sentence spans — the marker shifts offsets — degrading to a calm whole-item
glow). Not a Larissa path (frontend), not a Laura path (correctness, no
reachability change). TDD: failing test first for RC1 (cross-message,
`ChatStream.glow.test.tsx`) and RC4/RC5 (`MessageBlock.glow.test.tsx`). Gates:
`pnpm typecheck --force` **14/14**; user-client vitest **1610 pass / 8 fail**
(unchanged Node-26-localStorage baseline); biome clean. **Segmentation pacing**
(heading+list read as one breath) left AS-IS on Chris's explicit call — fließtext
is the main use case and the movement is welcome, not a bug. **Next:** Chris
pushes, then `/clear`, then a "zwischenfeature" (two, actually) on the way to
live voice mode (Spec 3).
**Earlier 2026-06-12 (late night) — VOICE PREFETCH CANCEL-REFETCH
RACE FIXED** (single commit on master, **NOT pushed**; root cause
DEVICE-CONFIRMED by Chris the same evening). Chris reported "every ~6th
nano-gpt speech generation fails" + an audible pause. **Systematic debugging,
probes before theories:** 28/28 live nano-gpt `/audio/speech` probes green
(12 serial back-to-back, 6 concurrent pairs mimicking the machine, realistic
long/TEAL/umlaut payloads; ~11 s synthesis for ~520 chars) → **no rate limit,
nothing upstream fails**. The console stack pinned it: the "failures" were the
**documented benign prefetch race** — the machine cancels the in-flight
prefetch actor when the current segment finishes playing first
(`voice-machine.ts` exit), `fetch` throws AbortError (`status: null` in the
boundary log — not a SpeechSynthesisError), and `playSegment` then re-ran the
SAME synthesis from scratch: doubled upstream calls (paid twice) and up to the
full synthesis time of audible silence on long segments. Confirmed live by
Chris via new instrumentation (the quiet "benign prefetch race" info line +
"the same pause — genau das!"). **Fix: in-flight dedup in the fetch layer**
(`resolve-tts.ts`) — a per-resolution `Map<cacheKey, {promise, retain}>`;
concurrent `fetchAudio` calls for one key share a single upstream request, and
the underlying fetch aborts only when EVERY consumer has aborted (a real
STOP), never on a mere segment advance. The XState machine is untouched (its
abort-on-exit semantics from Spec 1 stay). Pause shrinks from full synthesis
time to the remaining time; no doubled calls. Boundary log now carries
`error: "Name: Message"` so real failures are never guess-work again. Not a
Larissa path (no new egress), not a Laura path (no flow change — transport
optimisation). TDD: 4 new dedup tests in `tests/lib/voice/resolve-tts.test.ts`
(join, survive-one-abort, abort-only-when-all-gone, failure-clears-slot) + the
mock now mirrors `SpeechSynthesisError`. Gates: `pnpm typecheck --force`
**14/14**; user-client vitest **1606 pass / 8 fail** (unchanged
Node-26-localStorage baseline); `pnpm run build --force` **9/9**; biome clean.
**Device test:** read a roleplay chat with long paragraphs aloud via nano-gpt —
the inter-segment pause shortens noticeably, console shows at most quiet
`[voice-tts]` info lines (no red), and a STOP mid-synthesis still cancels
(network tab: request aborted). **Next:** unchanged — Chris device-tests the
backlog (xAI voice §11 + Mistral model instructions ✓ confirmed) → Liz pushes
on his word; then Spec 3 (live voice).
**Earlier 2026-06-12 (night) — xAI VOICE ONBOARDING LANDED**
(squashed onto master `e1df483`, **NOT pushed**; **NOT yet device-verified**).
The snack-sized session before Spec 3, exactly as planned: **Grok TTS + Grok
STT, each via two paths** (xAI direct + nano-gpt) as four new
`serviceKind: 'tts'/'stt'` offerings, and **Mistral Voxtral TTS removed from
the GUI** (board decision honoured; code/registry/tests stay for a possible
Mistral comeback). **Live probes first, code second** (all serial, keys from
`keys/`, full log in [[models/grok-voice]]): xAI's voice endpoints are
**CORS-wildcard-open** (unlike chat → new per-offering `corsOverride:
'direct'`); `POST /tts` takes `{text, voice_id, language:'auto'}` (no model
field) → binary MP3; `GET /tts/voices` is **unpaginated** with `voice_id` and
**lowercase IDs** (`ara/eve/leo/rex/sal`) that nano-gpt also accepts → **one
voice-ID namespace, lossless path switching**; nano-gpt audio takes **Bearer**
(chatsune's x-api-key was habit → planned auth override dropped); nano-gpt STT
**400s on webm** but takes identical bytes as `audio/x-matroska` (INS-054
re-proven → `spoofWebmAsMatroska`, needed for PTT-on-Chrome, VAD is WAV);
the Voxtral-403 **moderation canary passed both paths** + TEAL smoke 200 →
`contentModerated: false`, `teal: 'passthrough'` everywhere (TEAL v1 IS the
xAI snapshot — the day-one hook pays off). Client side: **per-offering
transports** (`mistral-speech`/`xai-native`/`openai-speech`;
`openai-transcriptions`/`xai-native` + exhaustive `wireFor` dispatch +
non-audio-response cache-poisoning guard), a pure **slot selector**
(`select-offering.ts`: explicit settings ref wins; null = curated auto-default
— TTS xAI→nano-gpt, **STT Mistral-first** as the EU-privacy default, Chris's
call; Mistral TTS never pickable/auto-resolved), **Dexie v23**
(`ttsOffering`/`sttOffering`), the shared `voice-transport.ts` resolution
helper, a per-offering-keyed VoicePicker memo (static five-voice list for
nano-gpt, no network), and **two slot pickers in My Settings → Voice**
("Read-aloud voice" / "Speech-to-text" — all five Laura spec-pass notes
landed verbatim: subtitles, pinned provider-named disabled hints, **egress
notes at every entry** ("Sends microphone audio to xAI (US)" …), visible
"(auto)" default that always names the actual speaker even on stale picks,
and the calm slot-switch notice). `TtsModerationNotice` follows the *selected*
offering (vanishes on Grok, mechanism stays). Built **subagent-driven** in an
isolated worktree (9 tasks + per-task spec/quality reviews + a fix round —
the worktree run also caught Task 5's missed `tests/unit` verno bumps against
the master baseline — + final holistic review **READY TO SQUASH**, its two
Minors fixed in-branch). **Laura pre-squash: PASS, no hard defects**; her one
deferral-candidate (disabled slot rows not keyboard-focusable) logged in
[[insights/ux-deferrals]] for the Spec 3 accessibility pass. Two new egress
classes (spoken text → xAI/nano-gpt; mic audio → xAI/nano-gpt, conscious
opt-in) logged in [[insights/security-deferrals]] — not a Larissa path
(client-only). Gates (Liz-verified on the branch tip + typecheck re-run on
master after squash, full-tree capture confirmed): `pnpm typecheck --force`
**14/14**; `pnpm run build --force` **9/9**; llm-unified `bun test` **372/0**;
user-client vitest **1601 pass / 8 fail** (the unchanged Node-26-localStorage
baseline trio). Spec/plan:
[[../../../superpowers/specs/2026-06-12-xai-voice-onboarding-design]],
[[../../../superpowers/plans/2026-06-12-xai-voice-onboarding]]. **Device test
(spec §11, eleven steps; restart `pnpm dev` — packages/llm-unified changed;
no new npm deps):** slot pickers + egress notes; "(auto)" defaults (xAI for
voice, Mistral for dictation); Grok voice happy path with walking glow; TEAL
passthrough audible ([laugh]/whisper); the "eintauchen" canary reads without
a skip; path switch to nano-gpt incl. slot-switch note + same voice; xAI and
nano-gpt dictation (PTT webm spoof + VAD wav); disabled-with-hint on a
disabled provider; moderation warning gone; orphaned Mistral voice heals via
re-pick. **Next:** Chris device-tests → Liz pushes the master backlog on his
word; then **Spec 3 (live voice: barging, auto-read, orchestration — inherits
the three logged ux-deferral seams)**.
**Earlier 2026-06-12 (late evening) — DICTATION/STT LANDED &
DEVICE-CONFIRMED** (squashed onto master `3deb242` + device-finding fix
`acc9092`; **Chris pushes the backlog himself**; re-test confirmed 2026-06-12:
"das haut jetzt hin, das ist super"). **NEXT SESSION (Chris's call): xAI
TTS + STT onboarding** — a snack-sized session BEFORE Spec 3. Community
feedback on Mistral Voxtral TTS: **39:0 for dropping it** ("hau sie raus die
Comstocker"), confirming the unanimous board decision; **Mistral STT stays**
(transcription is uncensored — device-proven) and xAI STT lands beside it as
a second `serviceKind: 'stt'` offering. xAI TTS is the prize: TEAL v1 IS the
xAI snapshot, so expression tags travel **passthrough** (`teal:
'passthrough'` — the hook built into TtsOfferingMeta from day one); route
direct or via nano-gpt per [ADR 0032] — probe at curation time (/curate).
After that: **Spec 3 (live voice: barging, auto-read, orchestration —
inherits the two logged ux-deferral seams)**. First device test of dictation: **Device finding #1
(systematic-debugging):** tap-to-stop right after speaking — the normal gesture —
landed inside Silero's redemption window (default 1.7 s) and `stopContinuous`
**discarded the in-flight utterance** → almost every single-utterance dictation
lost ("worked once" = Chris happened to wait out the window). The Task-8
adversarial review had flagged exactly this as a "spec-level UX question" — it
was the main case, not an edge. Fix `acc9092`: the stop-tap now **ends and
flushes** the in-flight utterance (capture finalises + delivers, mirroring
stopPTT's always-deliver contract incl. silent-WAV fallback for empty blobs +
a `vadDeliveryPending` window closing the sibling deferred-delivery race); the
machine's TAP guard drains via the new `hasInFlightUtterance` dep (the F1
drainingVad SPEECH_END handler consumes the flush). Spec §3.3 + D16 updated
(no-silent-loss). Gates after fix: typecheck 14/14, focused suites 73/73, full
vitest at the 8-baseline. Spec 2 of the
voice trilogy: speech as a prompt source. **One cockpit button, no mixed mode**
(Chris's call): DualActionBtn morphs `stop > capture > transcribing > send > mic`
— hold = PTT, tap = VAD dictation session (Silero via `@ricky0123/vad-web`,
**chatsune's empirically-tuned sensitivity presets + redemption window ported
1:1** — user-praised values, never library defaults); utterances transcribed by
the new **`serviceKind: 'stt'` Voxtral offering** (`voxtral-mini-latest`,
multipart FormData transport, **direct** — Chris's console probe 2026-06-12:
HTTP 200 from the app origin, ~375 prompt tokens/audio-second). **XState
dictation machine** (ADR 0034) with spawned per-utterance transcription actors
(completion-order emission, a VAD session survives a failed utterance,
cancel/timeout exits everywhere — Laura's spec-pass hard finding); the
`useDictation` hook owns the gesture model (tap/hold at 300 ms with capture from
pointerdown, **synthetic-click suppression** + scratch-utterance suppression +
**hot-mic LEAVE when the cockpit collapses** — the last three were
holistic-review catches that would have killed the feature on first device
contact). Constructive error notes incl. the honest provider-refusal copy
("the voice provider declined…", deterministic 4xx≠408/429); **Dictation group
in My Settings → Voice** (sensitivity low/medium/high, pause-tolerance slider
0.6–11.5 s, auto-send with eyes-open note); **Dexie v22**; **no audio
persistence anywhere** (blobs live one Retry cycle in machine context). Built
**subagent-driven** in an isolated worktree (13 tasks + per-task spec/quality
reviews + adversarial machine/hook reviews + a final **holistic review whose
NOT-READY verdict found the gesture-click race (C1/C1b), the orphaned hot mic
(I1), the silently-lost parked failure (I2) and the missing refusal copy (I3) —
all fixed in-branch and adversarially re-verified: FIXES SOUND**). **Laura
pre-squash: PASS, no hard defects** (her inert-X soft note fixed in-branch:
Cancel = Discard in the failed state; 2 deferrals logged in
[[insights/ux-deferrals]]: pointer-only dictation, read-aloud-over-hot-mic —
both inherited by Spec 3). New egress class (**recorded microphone audio to
Mistral, user-initiated, no persistence**) + VAD CDN assets logged in
[[insights/security-deferrals]] — not a Larissa path (client-only). Gates
(Liz-verified on master after squash, full-tree capture confirmed): `pnpm
typecheck --force` **14/14**; `pnpm run build --force` **9/9**; llm-unified
`bun test` **362/0**; user-client vitest **1563 pass / 8 fail** (the unchanged
baseline trio — root-caused this session as **Node 26's experimental
`localStorage`**, environmental, not code). Spec/plan:
[[../../../superpowers/specs/2026-06-12-dictation-stt-design]],
[[../../../superpowers/plans/2026-06-12-dictation-stt]]. **Device test (spec §11,
twelve steps + 8b; run `pnpm install` once — vad-web is new — and restart
`pnpm dev` — packages/llm-unified changed; first VAD use downloads ~14 MB
engine assets from jsdelivr, then browser-cached):** PTT hold→draft; VAD
two-sentence session with thinking pause; level glow; sensitivity low/high
felt; pause-tolerance slider; auto-send on (incl. mid-stream fallback to
draft); permission-deny constructive note; flight-mode Retry with retained
audio; Cancel mid-transcription; read-aloud stops on mic tap; no-provider
disabled tooltip; reduced-motion static glow. **Next:** Chris device-tests →
Liz pushes the master backlog on his word; then **Spec 3 (live voice:
barging, auto-read, orchestration — inherits the two logged seams)** and
**xAI TTS onboarding** (supersedes Mistral TTS per the board decision).
**Earlier 2026-06-12 — VOICE TTS HARDENING SQUASHED** (master
`657e1d1`, **NOT pushed**; **DEVICE-CONFIRMED by Chris 2026-06-12** — squashed on
his word; gates re-verified at squash time: `pnpm typecheck --force` 14/14, biome
clean on the 15 changed files). **NGO board decision (2026-06-12, unanimous):**
once the dictation/STT base lands, **xAI TTS (direct or via nano-gpt) supersedes
Mistral TTS** — Mistral stays for **STT only** (the Voxtral TTS moderation
finding sealed it; Mistral is informed). Hardening details follow.
**Earlier 2026-06-12 — VOICE TTS HARDENING** (squashed `657e1d1`, see above). First device
test of the voice-playback core surfaced three issues, fixed inline this session
(systematic-debugging) plus two follow-on asks. **(1) Mode-desync glow:** toggling
read-aloud mode (paragraph↔sentence) mid-play desynced the machine's frozen
`${block}:${ordinal}` segment-id namespace from the renderer's live-re-segmented
spans → glow fell out. Fix (Chris's call): a mode/roleplay change while active
**STOPs the read** + drops the now-stale (mode-relative) resume offer
(`use-voice-playback.ts`). **(2) "Couldn't read this part aloud" = Mistral Voxtral
403 content-moderation** on benign German ("…direkt eintauchen…"), device-confirmed
in Mistral AI Studio ("eintauchen"→"beginnen" passes); **context-score based**
(paragraph context masks it, isolated sentence trips it) — NOT rate-limit (the
gathered HTTP status killed that hypothesis — evidence over guessing). Endpoint-
specific: Mistral CHAT models write explicit content fine → see
[[project_voxtral_tts_moderates]]. Fix (Chris's call): the voice machine `onError`
now branches — deterministic 4xx≠429 (content refusal) **auto-skips + counts the
skip + keeps reading**, honest transport note ("Skipped a passage the voice
provider declined", live + at idle with Dismiss; STOP/LEAVE_CHAT clear it);
transient (429/5xx/network/twice-failed decode) still halts with Retry/Skip.
Provider-boundary + catch-all error logging added (`resolve-tts.ts`,
`voice-machine.ts`). **(3) Voice picker showed the raw voice ID when collapsed**
(voices load lazily on open, but the trigger needs the name) → eager session-
memoised name resolution on mount (`VoicePicker.tsx`). **Plus a censorship
warning:** new `TtsOfferingMeta.contentModerated` flag (Voxtral=true) +
`TtsModerationNotice` in My Settings → Voice AND the persona editor — the
"transparency over refusal" stance. **Symptom "voice changes impossible" closed as
a misread** — `voiceId` is already in the cache key (device-confirmed: Amy 2→Jane
Neutral switched fine). Gates (Liz-verified): `pnpm typecheck --force` 14/14;
llm-unified `bun test` 354/0; user-client vitest 1481 pass / 8 fail (the unchanged
cockpit-draft/chat-page/chat-route baseline — chat-page failure re-verified
pre-existing via stash); biome clean; +6 new tests. Not a Larissa path
(client-only, no new egress). Laura: judgement-call skip (corrective bugfix +
honest notes). **NGO angle:** Chris (Obmann, Second Circuit) raising the Voxtral
moderation with Mistral; board may drop Mistral TTS once xAI TTS lands (keeping
Mistral STT, likely uncensored). **Device test (restart `pnpm dev` — llm-unified
changed):** (a) persona editor + My Settings → Voice show the moderation warning;
(b) collapsed voice picker shows the NAME not the id; (c) the "eintauchen" sentence
in sentence mode → auto-skipped, read continues, "Skipped a passage" note → Stop
clears it; (d) toggle mode mid-read → stops cleanly, restart reads correctly in the
new mode. **Next:** Chris device-tests → Liz squashes on his word + records the
squash here (the [[project_voxtral_tts_moderates]] finding is already in memory);
then the voice weekend continues (Spec 2 dictation/STT, Spec 3 live voice;
xAI/nano-gpt TTS onboarding — the freedom-oriented TTS that supersedes Voxtral).
**Earlier 2026-06-11 (evening) — VOICE PLAYBACK CORE LANDED**
(squashed onto master `7eea044`, **NOT pushed**; **NOT yet device-verified**). Part 3
of the voice design weekend — Spec 1 of the audio-state trilogy (core → dictation →
live voice; specs 2+3 still to be brainstormed). Read-aloud of persona messages:
**paragraph-by-paragraph (default) and smart-sentence interleave modes**; an
**XState v5 playback machine** ([ADR 0034](../../decisions/0034-xstate-for-the-voice-domain.md)
— XState for the voice domain ONLY) with one-ahead prefetch, a pause gate that never
cancels the in-flight actor, failure Retry/Skip and ended-partial semantics, and
auto-aborting actors; the **segmentation library as single source of truth**
(`lib/voice/segmentation.ts`, raw-text/TEAL-neutral — empirical finding: the planned
renderer-identical preprocessing would have destroyed TTS tag passthrough since
`preprocessTeal` converts `[laugh]`→😄; glow pairs structurally instead, raw↔processed
paragraph mapping handles multiline-math splits, count-mismatch degrades to
paragraph-level, never mis-highlights); a **persistent `VoiceTransport`** (Laura's two
spec-pass hard findings honoured: governs playback independent of the tap-to-expand
rail; carries `Resume · ¶k`/Start over on return, Retry/Skip, the ended-partial
closing note; renders nothing when idle — the removed-ReadingToolStrip
less-distraction decision survives; `position:absolute` per the transform trap);
**steady tracking glow** (fixed intensity, reduced-motion static tint, D15);
**Dexie v21** (`voiceAudio` LRU blob cache — 64 MiB byte budget, write-counts-as-use,
key = hash(spokenText·provider·model·voice), never the message id → regeneration
reuse + self-invalidation; `voiceMode` setting; persona `voice`/`narratorVoice`);
**dual voice in roleplay only** (asterisk narration → narrator voice, falls back to
the main voice); **`serviceKind: 'tts'` in llm-unified** with the **Mistral Voxtral
offering** (`voxtral-mini-tts-2603`, **direct — CORS open, no proxy**, base64-MP3,
per-offering TEAL `strip`/`passthrough` hook — xAI later passes TEAL natively);
**My Settings → Voice** section (mode toggle, provider state line) + persona-editor
voice pickers (narrator picker only when roleplay is on; disabled-with-hint without
a provider). Built **subagent-driven** in an isolated worktree (9 tasks + per-task
spec/quality reviews + ~8 fix rounds + **opus holistic review** whose blocking
multiline-math glow finding was fixed in-branch + **Laura pre-squash pass: clean, no
hard defects**, one advisory logged in [[insights/follow-ups-index]] with five Minor
deferrals). New egress class (spoken message text to the TTS provider,
user-initiated) logged in [[insights/security-deferrals]] — **not a Larissa path**
(client-only). Gates (Liz-verified on master after squash): `pnpm typecheck --force`
**14/14**; `pnpm run build --force` **9/9**; user-client vitest **1468 pass / 8 fail**
(the unchanged cockpit-draft/chat-page/chat-route baseline); llm-unified `bun test`
**353/0**; biome clean. Spec/plan:
[[../../../superpowers/specs/2026-06-11-voice-playback-core-design]],
[[../../../superpowers/plans/2026-06-11-voice-playback-core]]. **Device test (spec §8,
twelve steps; run `pnpm install` once — xstate is new — and restart `pnpm dev` —
packages/llm-unified changed; needs an enabled Mistral provider + a persona voice
picked in the editor):** paragraph read-aloud with walking glow; sentence mode;
roleplay narrator-voice alternation; pause-mid-word resume; mode-switch + scroll
survival, Entrance-Hall stop, `Resume · ¶k` on return; instant cache replay (network
tab silent); regeneration cache reuse; flight-mode failure → Retry/Skip; TEAL tags
silent, code-only message disabled-with-tooltip; voiceless persona disabled control;
reload → no stale Resume; reduced-motion static glow. **Next:** Chris device-tests →
Liz pushes the master backlog on his word; then the voice design weekend continues —
**Spec 2 (dictation/STT incl. hold-listen) and Spec 3 (live voice mode: barging,
auto-read, orchestration)** brainstorms, plus xAI/nano-gpt TTS onboarding sessions
against the now-stable `serviceKind: 'tts'` interface.
**Earlier 2026-06-11 (afternoon) — TEAL voice expression language LANDED**
(squashed onto master `c3a6932`, **DEVICE-CONFIRMED by Chris 2026-06-11 and pushed
by him** with the then-backlog). Part 2
of the voice design weekend. TEAL (*Transformative Expression and Anthropomorphisation
Layer*) is the canonical voice expression language: a **closed, versioned vocabulary**
(v1 = xAI snapshot 2026-06-11; 16 inline + 13 wrapping tags, qualifiers, nesting) in
`packages/llm-unified/src/teal/`, an **always-on Band-1 prompt segment** (order 3,
**before** roleplay — the roleplay→persona-CI adjacency is untouched, D9) for the
**chat + greeting** jobs only (title/memory excluded, D8; the context gauge counts it
automatically), and **human-friendly display rendering**: the user never sees raw tags —
`[laugh]` → 😄, `[pause]` → ` … `, `<whisper>` → dimmed italics (colour-mix, not
opacity), `<loud>`/`<emphasis>`/`<laugh-speak>` → bold, `<singing>` → ♪…♪, `<slow>` →
letter-spaced, voice-only modulation silent. The mapping is **one curated data file**
(`apps/user-client/src/lib/teal/teal-render-map.ts`, longest-match: `soft laugh` → 🤭
before core-word fallback) — Chris edits rows, the plugins are generic. Finalised path:
`preprocessTeal` (inline tags + PUA-sentinel wraps, code-masked via the extracted shared
`code-mask.ts`) → `rehypeTeal` (sentinels → classed spans, one active-class stack across
the whole tree = cross-paragraph + progressive-unclosed semantics). Streaming path:
**append-stable chunk state machine** (`teal-streaming.ts`) wired into MessageBlock —
split tags complete across chunk boundaries, half-typed tags at the stream tip are
suppressed, fenced/inline code passes through, span keys stay stable (no re-fade).
Unknown tags stay **literal** (closed vocabulary = the false-positive guard and the
observation source for v2). Built **subagent-driven** in an isolated worktree (9 code
tasks + per-task spec/quality reviews + fix rounds + final **opus holistic review =
READY TO SQUASH**; its two accepted streaming transients + the **workbox 2 MiB
precache edge** the build was sitting on — stopgap limit raise in `vite.config.ts`,
code-splitting follow-up — logged in [[insights/follow-ups-index]]). **Not a Larissa
path** (client-only, no auth/sync/proxy/crypto, no new egress). **Not a Laura path**
(judgement call: no flow/state/reachability change — message text renders friendlier;
no new controls). Gates (Liz-verified on master after squash): `pnpm typecheck --force`
**14/14**; llm-unified `bun test` **347/0**; user-client vitest **1347 pass / 8 fail**
(the unchanged cockpit-draft/chat-page/chat-route localStorage-jsdom baseline);
`pnpm run build --force` **9/9**; biome clean. Spec/plan:
[[../../../superpowers/specs/2026-06-11-teal-voice-expression-language-design]],
[[../../../superpowers/plans/2026-06-11-teal-voice-expression-language]]. **Device test
(spec §8, seven steps; restart `pnpm dev` first — packages/llm-unified changed — and
run `pnpm install` once, `@types/hast` was added):** expressive story →
emojis/italics/bold, no raw tags; whisper italic + pause-ellipsis + ♪; roleplay
coexistence without double-marking; greeting opener carries expressions; `[pause]` in a
code block stays literal; no half-tag flash at the stream tip; user-typed `[laugh]`
renders 😄 in the own bubble. **Next:** Chris device-tests → Liz pushes the master
backlog on his word; then the voice design weekend continues (TTS/live voice — the
TEAL→backend translators consume this language, incl. the emoji→expression input rule
from spec §6).
**Earlier 2026-06-11 — Roleplay Mode & User Greeting LANDED** (squashed
onto master `ef5a478`, **NOT pushed**; **DEVICE-CONFIRMED by Chris 2026-06-11**:
roleplay mode tested with **Mistral Small 4** ("wunderbar für Sci-Fi") — his
Klingon buddy persona Kirok stayed in character and reached for Klingon phrases
unprompted; "der roleplay mode ist großartig". Same-day follow-up `114e967`:
the context-token gauge now counts the roleplay segment and excludes openers
via `isContextMessage`. Further roleplay-feature work planned the same day
after a `/clear`.) Part 1 of the
voice design weekend (voice itself still unbuilt). Personas gain (a) an opt-in
**Roleplay** behaviour switch — a curated Band-1 prompt segment (embodiment +
asterisk-narration formatting with a **first/third-person narration** selector,
field-tested behaviour facts, and an **NSFW re-unlock** that rides `adultPersona`)
inserted **directly before the persona CI** (spatial proximity is load-bearing —
Chris's empirical ERP finding), and (b) an independent opt-in **User Greeting** —
every new chat opens with a freshly generated, **live-streamed** in-character
message guided by user-written rules, persisted as a `kind: 'opener'` persona
message that renders normally but is **excluded from every model context** via the
single shared `isContextMessage` predicate (wire, title-gen incl. the count gate
that would otherwise never fire, lore companion scan, lore-cooldown window).
`ChatRow.openerPending` (creation-time snapshot) guards generation — no
retrofitting; failure falls back to "{name} is listening" + constructive Retry;
Stop keeps the partial; Regenerate re-rolls ("Re-roll the greeting" tooltip).
**Deliberately NO per-chat roleplay toggle** — roleplay characters and AI
companions are separate worlds (protective product decision, in Liz's memory).
**Dexie v20 now belongs to roleplay** (persona-fields backfill) — the voice
settings bump moves to **v21**. Built **subagent-driven** in an isolated worktree
(10 tasks + per-task spec/quality reviews + ~5 fix rounds + final **opus holistic
review = READY TO SQUASH**; its one non-blocking note + a Laura observation logged
in [[insights/follow-ups-index]]). **Laura spec-pass** (5 soft notes, all
incorporated pre-build) + **Laura pre-squash pass: clean, no hard defects** (her
one soft finding — §6.4 flag clearing on send — turned out implemented in
`store.start()`; no deferral). Not a Larissa path (client-only, no new egress —
the opener rides the per-persona inference path). Gates (Liz-verified on master):
`pnpm typecheck --force` **14/14**; llm-unified `bun test` **334/0**; user-client
vitest **1311 pass / 8 fail** (the unchanged cockpit-draft/chat-page/chat-route
localStorage-jsdom baseline); `pnpm run build` **9/9**; biome clean. Spec/plan:
[[../../../superpowers/specs/2026-06-11-roleplay-mode-and-user-greeting-design]],
[[../../../superpowers/plans/2026-06-11-roleplay-mode-and-user-greeting]]. **Device test
(spec §10, ten steps; restart `pnpm dev` first — packages/llm-unified changed):**
roleplay bard persona (short in-character paragraphs, asterisk narration,
first/third person), NSFW re-unlock quality check, mid-chat activation, greeting
streams on a new chat, wire exclusion via the network tab, stop/regenerate,
failure path + Retry, save gate, no retrofitting. **Next:** Chris device-tests →
Liz pushes the master backlog on his word; then the voice design weekend
continues (TTS/live voice + expressions on top of this narration foundation).
**Earlier 2026-06-10 (night) — Voice feature feasibility assessed**
(assessment only, no code). Chris opens a four-day deep-design weekend
starting **2026-06-11 15:00**: voice as one **fully integrated unit** marrying
**roleplay-mode, narration, TTS/live voice and provider-agnostic expressions**
(he brings two further ideas to the table tomorrow). Playback in two modes —
smart sentence-by-sentence and paragraph-by-paragraph — with the playing
segment glowing in/out, in both live voice mode and read-aloud. Liz's
data-model verdict: `contentBlocks` need **no change** — segments are derived
at runtime, never stored; **one segmentation function as single source of
truth** for both the spoken plaintext and the highlight spans (drift between
the two is the classic failure mode). Concrete deltas: one Dexie settings
bump (v20; v19 is head), optional audio-blob cache later. Difficulty map:
paragraph glow **easy** (custom `markdown-components` precedent), sentence
glow **medium** (rehype plugin + native `Intl.Segmenter`), per-segment
synthesis makes timing sync trivial (`onended` advances the glow),
**live-voice-during-streaming is the hardest part** (raw `stream-tok` spans
carry no semantic structure yet). TTS providers ride the TTI precedent as a
new `serviceKind: 'tts'` in llm-unified. **Next:** the voice/roleplay/
narration brainstorm with Chris (supersedes design-language as next-up; that
session stays parked).
**Earlier 2026-06-10 (late evening) — GPT Image 2 curated on
nano-gpt** (squash `156f3d1` on master, **NOT pushed**; **DEVICE-CONFIRMED
by Chris 2026-06-10**: full tool-loop runs with Fable 5 as host model fired
`generate_image` and rendered both 16:9 and 21:9 results — `visuals/fable_1.png`
and `fable_2.png`). Fourth TTI offering: `GptImage2Config` with 8 aspects
(incl. **21:9**) × 1k/2k × low/medium/high quality (default 1:1/1k/medium,
Chris's call). Key empirical findings (18 live probes + end-to-end
`generateImages()` run, all in [[models/gpt-image-2]]): `quality` **passes
through** nano-gpt to the upstream and bills per tier (low $0.018/~24 s,
medium $0.066/~71 s, high $0.156/~3.5 min at 1K → group POST timeout 600 s);
sizes return **pixel-exact iff both dimensions are /32** (off-grid snaps up
ratio-preserving) — the hardcoded table in `gpt-image-2-resolutions.ts` was
verified cell-by-cell. Not a Larissa path (no auth/sync/proxy/crypto); not a
Laura path (one more picker entry + a third OptionRow in the established
config-view pattern). Gates: llm-unified `bun test` 326/0, `pnpm typecheck
--force` 14/14, `pnpm run build` 9/9, biome clean (user-client vitest 8 fail =
unchanged pre-existing baseline trio, verified against clean master).
**Device test (restart `pnpm dev` first — packages/* changed):** pick GPT
Image 2 in My Settings → Image generation, generate at 21:9/1k/medium, then
one low and one high run to feel the latency spread. **Next:** unchanged —
the design-language session per the parked round-1 brainstorm.
**Earlier 2026-06-10 — TTI device findings resolved** (commit
`3607093` on master, **NOT pushed**). Finding 1 (pill in the inline flow) fixed
with a block-level `.image-pill-block` wrapper at the Pill dispatch site.
Finding 2 (vanishing images, reload heals) **root-caused via live console
probes with Chris**: object URLs were created in `useMemo` during render, so
StrictMode's mount effect cycle (effect → cleanup → effect) revoked them on any
remount with a warm artefact query cache — entrance hall → straight back
sufficed; the probe log showed CREATE → immediate REVOKE from the ImagePill
cleanup → `ERR_FILE_NOT_FOUND` at React's `commitMount`. Fixed by creating the
URLs **inside the effect that owns their revocation** (the AttachmentThumb
pattern — the working counterpart found by pattern comparison; PersonaAvatar
verified already correct), plus a stable `EMPTY_ARTEFACTS` fallback (a
per-render `= []` default would have looped the new effect — caught red-handed
as a vitest hang). Finding 3 (Z-Image "not working") was a **false alarm** —
odd LLM behaviour, struck by Chris. Two new tests pin the StrictMode-remount
path and the block wrapper. Not a Larissa/Laura path (client-only bugfix +
agreed polish, no flow change). Gates: `pnpm typecheck --force` **14/14**;
user-client vitest **1265 pass / 8 fail** (the unchanged baseline trio);
`pnpm run build` **9/9**; biome clean on changed files (index.css picker drift
pre-existing). **Both fixes DEVICE-CONFIRMED by Chris 2026-06-10** (images
survive entrance-hall-and-back; pill on its own line) — **Chris is pushing the
master backlog himself**. **§13.6 moderation step also DEVICE-CONFIRMED
2026-06-10**: Grok refused a provocation prompt with a 400 and the failed call
surfaced the constructive tool result (tell the user; suggest rephrasing or
retrying) — the §13 device-test list is now **fully passing**. TTI is
complete. **Next:** the design-language session per the parked round-1
brainstorm.
**Earlier 2026-06-09 (late) — TTI image generation LANDED** (squashed
onto master `d80ad73`, **NOT pushed**; **NOT yet device-verified**). Companions
can paint: `generate_image` is **always offered** (unconfigured call → a
constructive pointer to My Settings → Image generation = the in-chat discovery
path), optional `count` (default 1, clamped per group) and schema-gated `nsfw`
parameters; three curated **`serviceKind: 'tti'` offerings** in llm-unified
(**Grok Imagine** on xAI — routed via the CORS proxy per `corsHint`, supersedes
spec §10's "fully direct" for xAI; **Z-Image** + **Seedream 4.5** on nano-gpt,
direct; xAI uses `b64_json` since its image CDN is CORS-closed, nano-gpt
`url` + bare R2 GET without auth header); **Dexie v19** (`imageGeneration`
primary + always-visible disabled-with-closed-loop-copy NSFW slot);
immediate-persist **Image generation** section in My Settings; every image is a
**`kind: 'image'` artefact** (blob + thumb + dimensions + `genMeta` provenance —
Treasury `Img` tab now alive, lightbox incl. image download + copyable
prompt-provenance, persona-provenance NSFW gating for free); in-chat
**ImagePill** (`Painting · model` live → expandable prompt with Copy →
inline thumbnails → lightbox). Built **subagent-driven** in an isolated
worktree (11 TDD tasks, per-task spec+quality review, ~5 fix cycles, final
**opus holistic review = READY TO SQUASH** — its two Minors logged in
[[insights/follow-ups-index]]) + **Laura pre-squash pass: no hard defects**,
her one soft finding (decision-9 lightbox provenance gap) **fixed in-branch**
rather than deferred. New egress class (image prompts to the providers + R2
fetches) logged in [[insights/security-deferrals]] — **not a Larissa path**
(client-only). Verification (on master after squash): `pnpm typecheck --force`
**14/14**; llm-unified `bun test` **312/0**; user-client vitest **1263 pass /
8 fail** (the unchanged cockpit-draft/chat-page/chat-route localStorage-jsdom
baseline); `pnpm run build` **9/9**; biome clean; full-tree capture verified
(`git diff master..branch` empty) + typecheck on master before worktree
cleanup. Spec/plan: [[../../../superpowers/specs/2026-06-09-tti-image-generation-design]],
[[../../../superpowers/plans/2026-06-09-tti-image-generation]]. **Device test (spec
§13):** the nine steps — unconfigured discovery (companion points to settings),
Z-Image turbo happy path (pill → inline thumbnail → lightbox → Treasury),
"three variants" → grid + 3 artefacts, Grok quality/2k/16:9 honoured (xAI key +
CORS proxy required), Seedream ultra + silent clamp (asks 5 → gets 4),
moderation (Grok blocks → constructive), no `nsfw` param without an NSFW model,
SFW-mode hides adult-persona images, reload persistence + chat cascade-delete.
**Restart `pnpm dev` first** (packages/llm-unified changed — Vite HMR ignores
`packages/*`). **Device test 2026-06-09 (late): MOSTLY PASSING** — Chris ran
the §13 list the same evening; "FAST alles funktioniert". **Still open:** the
moderation-provocation step (§13.6). **Three device findings for the next
session (probe-first, console probes early per house habit):**
(1) **The image pill should always start on a new line** — it currently sits
in the inline content flow; UX polish, likely a block-level wrapper around the
generate_image pill (+ grid). (2) **Images sometimes vanish after having been
displayed; a chat reload brings them back** — smells like the
objectURL/query-cache class the reviews circled (ImagePill `urls` useMemo
cleanup revoking while `<img>`s still reference, or a draft→persisted pill
remount path); the staleTime-Infinity fix covered the focus-refetch case, so
another revocation/remount path remains. Probe before theorising. (3)
**Z-Image appears not to work** — note the ad-hoc console probe (spec §10) hit
the very same model fine direct, so suspect the in-app path: slot/ref
resolution (`nano-gpt:z-image-turbo` + enabled row), payload (size/n), or
routing — probe the actual request from the app first. **Next:** fix the three
findings + finish §13.6 → Chris re-tests → Liz pushes the master backlog on
his word; then the design-language session per the parked round-1 brainstorm.
**Earlier 2026-06-09 — TTI image-generation spec approved (Laura's
first real spec-pass) + live CORS probes complete.** Design spec at
[[../../../superpowers/specs/2026-06-09-tti-image-generation-design]] (commits
`169ae19` → `50f0d0c`, doc-only, **NOT pushed**), brainstormed end-to-end with
Chris and **approved after his own read**. Port of chatsune's TTI stack with
four deliberate changes: global model slots in My Settings (primary + a
visible-but-disabled NSFW slot until a `canDoNsfw` model is curated — all
three launch models are `false`), image count moved from user config to an
LLM tool parameter (`count`, default 1, clamped per group), `generate_image`
**always offered** (an unconfigured call returns a constructive settings
pointer = the in-chat discovery path), and images persisted as **artefacts**
(`kind: 'image'`, inline thumbnails in the stream, the Treasury `Img` tab
comes alive, NSFW gating via persona provenance for free). Three launch
offerings as `serviceKind: 'tti'` in llm-unified: **Grok Imagine** (xAI),
**Z-Image** + **Seedream 4.5** (nano-gpt); config types are the chatsune
discriminated union minus `n`. **Laura's first summon paid off immediately:**
two hard findings (a dangling disabled-slot tooltip; first-run capability
invisible in the chat), both fixed in the spec; five soft notes
applied/consciously kept. **Live CORS probes with Chris (serial, real
generations):** both providers fully **`direct`** — nano-gpt POST + R2
signed-URL fetch CORS-open (`response_format: 'url'`, R2 fetched **without**
auth header); xAI POST open but `imgen.x.ai` CORS-closed → the xAI adapter
uses **`response_format: 'b64_json'`** (bytes inline). No proxy dependency on
the happy path. **Dexie v19 claimed** for the settings migration (head is
v18 — re-verify at plan time per the parallel-version-ownership rule).
**Next:** implementation plan (writing-plans), then build; inline vs
overnight-handoff still to be decided with Chris.
