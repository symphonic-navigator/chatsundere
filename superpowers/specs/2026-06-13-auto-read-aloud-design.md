# Auto-Read-Aloud — Design Spec

**Date:** 2026-06-13
**Author:** Liz (with Chris)
**Status:** Approved for planning
**Feature area:** `apps/user-client` — voice domain
**Position in the voice trilogy:** intermediate step (a "zwischenfeature") between
**Spec 2 (dictation/STT, landed)** and **Spec 3 (live voice: barging, auto-read,
orchestration)**. This spec peels the **auto-read** component out of Spec 3 and
ships it standalone, so the streaming-interleave substrate is built and
device-proven before mic + barging pile on.

---

## 1. Summary

Add a persistent **voice mode** to the user-client: while it is on, every newly
generated persona reply **reads itself aloud as it streams** — speaking
completed paragraphs while later tokens are still arriving (interleaving LLM
inference and TTS synthesis). Today read-aloud is a manual, batch action on a
*finished* message; this feature makes it automatic and *streaming-aware*.

A single notion of a **committed prefix** (paragraphs closed by a blank line)
drives *both* halves: the segments fed to TTS **and** the markdown rendering.
Committed paragraphs are progressively rendered to final markdown (with glow
anchors) during the stream while the open tail stays raw — so the glow tracks
the spoken paragraph throughout, and the two-block-index-worlds problem
(streaming per-chunk blocks vs coalesced finalised blocks) dissolves: segment
ids and glow anchors match **by construction** because one representation
produces both.

The `waiting` machine state introduced here is exactly the seam onto which Spec 3
will later attach microphone capture and barging.

## 2. Goals / Non-goals

**Goals**

- A global, persisted on/off **voice mode** toggle in the chat cockpit.
- Newly generated persona replies auto-read while streaming, with **low
  time-to-first-audio** (start speaking before the reply is complete).
- Reuse the entire existing playback stack untouched: one-ahead prefetch,
  in-flight dedup, pause gate, provider-refusal auto-skip, glow tracking,
  blob cache.
- Lay the substrate for Spec 3 (live voice).

**Non-goals**

- No microphone, no barging beyond "sending a new message stops current
  playback", no turn-taking orchestration — that is Spec 3.
- No sentence-aggressive interleaving (speaking sentences *within* a still-open
  paragraph). Paragraph-commit only; sentence-aggression is a possible later
  refinement.
- No retroactive reading of history. No re-reading on chat entry.
- No new TTS providers or transports; no new egress class.

## 3. Decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Trigger model | **Mode toggle** in the cockpit, in the slot reserved to the right of the (future) live-voice button; greyed when no read-aloud voice is configured, with a **touch-reachable** disabled reason (tap reveals it inline + routes to Settings → Voice, §8). In live voice mode (Spec 3) the same button is repurposed — the "magic button" pattern. |
| 2 | Scope / persistence | **Global & persistent** (Dexie setting). Auto-read is a *behaviour-axis* concern — orthogonal to content — so it is stable across personas and chats. |
| 3 | Interleave boundary | **Paragraph-commit.** A paragraph is spoken once it is "closed" by a following blank line (confirming it will not change). The final paragraph speaks at stream end. Sentence-mode is applied by sub-segmenting each *committed* paragraph. |
| 4 | Activation behaviour | **New generations only.** Future persona replies auto-read as they stream, including a freshly generated opener/greeting on chat entry. Existing history stays silent (still manually tappable). Toggling the mode on mid-conversation does **not** retroactively read the last message — it only arms future replies. |
| 5 | Glow during streaming | **Progressive markdown commit.** A streaming message is rendered as `[committed prefix as final markdown, with glow anchors] + [open tail as raw stream-text]`. The same blank-line commit drives speaking *and* rendering, so the glow tracks the spoken paragraph throughout the stream. Conscious scope expansion: it touches the streaming render path. Re-parse happens once per paragraph commit, never per token. |

## 4. Concept: segment stability

A **segment** is a spoken unit (a paragraph; in sentence mode, a sentence). While
a reply streams, the text buffer grows token by token. A segment is **stable**
when its text is guaranteed not to change any more — which matters because
ordering TTS *commits* a text; if it changed afterwards we would have spoken the
wrong thing.

- **Unstable** = the still-growing, open trailing paragraph (no closing blank
  line yet).
- **Stable** = any paragraph already followed by a blank line — or, once the
  stream ends, all of them.

The blank line (`\n\n`) is a **deterministic commit signal from the model
itself** that a thought is closed — no guessing at sentence boundaries.

**Code-fence guard:** an *open* ``` ``` ``` fence means a blank line *inside* the
code block is not a real paragraph break. Nothing commits while fence depth is
non-zero; we only commit a prefix that ends on a top-level blank-line boundary.

## 5. Architecture (Approach 1: streaming driver feeds an extended machine)

The XState voice machine remains the single source of truth for playback (it owns
the `AudioSink`). A new driver decides **what** to speak and **when** it is
committed; the machine decides **how** it is played. The **committed prefix** is
the shared backbone: one computation feeds both the TTS segments and the
progressive markdown render (§5.5, §6).

### 5.1 New: `committed-prefix.ts` (pure, shared by speaking and rendering)

A single helper computes the stable prefix of a streaming message and segments
it:

```
committedPrefix(blocks, streamDone) -> { committedText, openTailText }
committedSegments(blocks, streamDone, opts) -> SpeechSegment[]   // segments committedText
```

- **Stream running:** the committed prefix is the paragraphs closed by a
  following top-level blank line with balanced code-fence depth. The open
  trailing paragraph is the `openTailText` (withheld from both speaking and
  finalised rendering).
- **Stream done:** everything is committed (equivalent to today's
  `segmentMessage` over the coalesced blocks).

During streaming the message's content is many per-chunk text blocks (see
`stream-manager.appendStreamChunk`); `committedPrefix` **joins** them into one
logical text first, so paragraph boundaries and the resulting `blockIndex`
numbering are computed from the **same coalesced view** the finalised message
will have. Reuses the existing `segmentMessage` on `committedText` — **no second
segmentation engine**.

**Correctness invariant:** committed text is frozen, so segment ids
(`blockIndex:ordinal`) and order **never change** as more text arrives — and
because the *same* committed-prefix view drives both the TTS segments and the
rendered anchors, the ids and anchors are aligned **by construction** (this is
what makes glow-during-streaming correct without reconciling two block-index
worlds).

### 5.2 Extended: `use-voice-playback.ts` (the driver lives here)

Deliberately **not** a second hook. The auto-read driver is an effect *inside*
the existing `useVoicePlayback`, so it uses the **same machine actor and the same
`AudioSink`** as manual read-aloud — no second sequencer contending for the sink.

The effect:

- Watches the active chat's streaming draft via the stream-manager store.
- Fires only when `autoReadAloud` is on **and** a TTS voice is resolvable for the
  persona (same `resolveTts` probe that gates the manual read button).
- On each stream update, recomputes `committedSegments` and translates progress
  into machine events (see 5.4).
- Targets **only freshly generated** persona drafts (Decision 4). History is
  never auto-played.

### 5.3 Extended: `voice-machine.ts` (one new idea)

- **New context field** `streamComplete: boolean`. Manual playback passes `true`
  from the start, so its behaviour is unchanged.
- **New events** `SEGMENTS_UPDATED { segments }` (the list grows) and
  `STREAM_DONE`.
- **New `playback` sub-state `waiting`:** entered when `currentIndex` overtakes
  the known segments while `!streamComplete`. `SEGMENTS_UPDATED` → back to
  `speaking`; `STREAM_DONE` → end for real.
- **Modified end condition:** after the last *known* segment, the machine ends
  only if `streamComplete`; otherwise it parks in `waiting`.
- `PLAY` gains an optional `streamComplete` flag (manual = `true`, auto = `false`
  initially).

Inherited untouched: one-ahead prefetch, in-flight dedup, pause gate,
provider-refusal auto-skip, `LEAVE_CHAT` stop, blob cache.

### 5.4 Data flow (happy path)

1. Mode on, persona voice resolvable. User sends (or an opener generates) → the
   stream-manager creates a draft persona message; the stream starts.
2. First blank-line commit → `committedSegments` returns ≥1 stable segment →
   driver dispatches `PLAY { messageId: draftId, segments, streamComplete: false }`.
   Machine plays segment 0, prefetches segment 1. In the same commit the
   committed prefix re-renders as markdown with anchors (§5.5), so the glow
   tracks segment 0.
3. Further paragraphs commit → `SEGMENTS_UPDATED { grown list }` **and** the
   committed prefix grows in the render. If the machine was in `waiting`, it
   resumes.
4. If playback drains the queue before the next commit → `waiting` (silent, no
   end).
5. Stream finishes → final `SEGMENTS_UPDATED` (everything) + `STREAM_DONE` →
   remaining segments play, machine ends normally; the message renders fully as
   markdown (today's finalised path). Audio is cached for later manual replay.

### 5.5 Extended: `MessageBlock` streaming render (progressive markdown commit)

Today the streaming branch (`MessageBlock.tsx:429`) renders **all** draft text as
raw `stream-tok` spans via `transformTealStream`, and only the finalised message
renders as `<MarkdownContent>` (with `rehype-voice-anchor`). This is why a
streaming message has no glow anchors today.

The change: the streaming branch splits at the commit boundary —

- **committed prefix** → `<MarkdownContent>` (full pipeline, glow anchors),
  identical to the finalised render of that text;
- **open tail** → raw `stream-tok` spans as today.

Re-parse cost is bounded: the committed render is memoised on `committedText` and
only changes **once per paragraph commit**, never per token (the same rationale
that keeps segmentation cheap). The TEAL output of the two paths must be visually
equivalent so a paragraph crossing the commit boundary does not visibly shift
(see §6).

## 6. Glow throughout streaming (via progressive markdown commit)

Because the committed prefix renders through the full markdown pipeline
(`<MarkdownContent>` + `rehype-voice-anchor`) the moment it commits, a streaming
message **has glow anchors for exactly the paragraphs that are eligible to be
spoken**. The `currentMessageId` gate (the 2026-06-13 RC1 fix) routes the glow to
the playing (here: streaming) message. So the glow tracks the spoken paragraph
throughout the stream, not only after finalisation.

The ids align by construction (§5.1): the same committed-prefix view produces the
TTS segment ids and the rendered anchors, so there is no streaming-vs-finalised
block-index mismatch to reconcile.

**Two explicit verification points** (not assumed blindly):

1. **Glow tracks during streaming** — a committed paragraph of a *streaming*
   message glows while it is spoken (dedicated test).
2. **Seamless commit transition** — a paragraph crossing from raw `stream-tok`
   (streaming-TEAL) to `<MarkdownContent>` (finalised `rehype-teal`) must not
   visibly jump in layout or TEAL rendering. The two TEAL paths are expected to
   produce equivalent output; this is verified on device and guarded by a test
   asserting the committed render matches the finalised render for the same text.

## 7. Behaviour & lifecycle

| Event | Behaviour |
|-------|-----------|
| User sends a new message while reading | Current playback **stops immediately**; the new reply auto-reads from its first commit. ("Sending **is** barging" — a first taste of Spec 3.) |
| Regenerate a reply | Treated as a new generation: current playback stops; the regenerated reply auto-reads. |
| Leave chat / navigate away | Existing `LEAVE_CHAT` stops and disposes. Inherited. |
| Stream error mid-generation | Driver dispatches `STREAM_DONE`; the machine finishes whatever was committed; the existing `StreamInterruptedFooter` shows the interruption. Already-spoken stays spoken. No special handling. |
| TTS provider refuses a segment (4xx moderation) | Existing auto-skip + honest transport note. Inherited untouched. |
| User taps the playback stop control | Stops **this** message's playback; the **mode stays on** (next reply auto-reads). Stop ≠ exit mode. **On the *first* Stop while the mode is on**, a one-shot calm hint clarifies the asymmetry: "Reading stopped — voice mode is still on, so the next reply will read itself. Turn it off in the cockpit." (Shown once ever; a Dexie/settings one-shot flag. Laura soft finding.) |
| User toggles the cockpit mode **off** | Exits the mode **and** stops any current playback (voice off = silence). Future replies do not auto-read. |
| Manual read-aloud | Unchanged; tapping any message starts its playback (superseding current), whether the mode is on or off. |

## 8. UI / settings

- **Cockpit toggle:** a new mode toggle in the slot reserved to the right of the
  (future) live-voice button. Three states: **off** (idle), **on** (active/lit),
  **disabled** (no voice → greyed). The disabled condition uses the **same
  `resolveTts` probe** that already greys the manual read button — one source of
  truth. Exact placement and styling are a separate styling pass (mechanics
  first).
- **Disabled reason is touch-reachable (Laura H1).** `title`-only tooltips do not
  fire on touch, and we are mobile-first — so **tapping the greyed toggle
  surfaces the reason inline** as a calm cockpit note (reusing the existing
  `cockpit-dictation-note` pattern, `Cockpit.tsx:480`) **and the note taps
  through to Settings → Voice**. Copy is warm/constructive rather than a bare
  instruction, e.g. "No voice yet — give this companion a voice to read replies
  aloud" → Settings → Voice. (Final copy is the styling/design-language pass; the
  *mechanism* — tap reveals reason on touch + routes to the fix — is fixed here.)
- **Same fix for the existing manual read button (Laura H1, in the same stroke).**
  The manual read affordance (`MessageControls.tsx`) carries the identical
  `title`-only touch gap across its three disabled tones (no-provider / no-voice /
  nothing). It gets the same touch-reachable disclosure so we do not ship a new
  control beside a known dead-end.
- **Armed / waiting feedback contract (Laura H2).** A **lit toggle is the signal
  for "armed, nothing to read yet"** — explicit and sufficient; no extra armed
  indicator. During the silent **`waiting`** sub-state (playback has caught up to
  the still-streaming reply, §5.4 step 4) the **`VoiceTransport` stays mounted
  with a calm "reading…" affordance**, so the silence reads as "still going", not
  "stopped/broken". (`VoiceTransport` is already shown while the machine is
  `active`; `waiting` is an `active` sub-state, so it stays mounted naturally —
  the contract is that it shows the quiet "reading…" state rather than a
  paused/idle one.)
- **Dexie:** new `SettingsRow.autoReadAloud: boolean` (default `false`) and a
  one-shot `voiceStopHintSeen: boolean` (default `false`, for the first-Stop hint
  above); one migration on the **next free Dexie version**. The exact version
  number is verified against the current schema at plan time — Dexie version
  collisions with parallel work are a known hazard.

## 9. Testing

**TDD, failing-test-first.**

- **Unit `committedPrefix` / `committedSegments`:** nothing committed before the
  first blank line; committed prefix is stable while the tail grows; stream-done
  commits everything; an open code fence commits nothing; per-chunk streaming
  blocks are joined so paragraph numbering matches the coalesced finalised view;
  ids/order stable across growth.
- **Machine:** `waiting` entered when the queue drains before stream end;
  `SEGMENTS_UPDATED` wakes it from `waiting`; `STREAM_DONE` in `waiting` ends
  cleanly; the **manual path (`streamComplete: true`) never enters `waiting`**
  (regression).
- **Driver / integration:** a growing fake draft → `PLAY` → `SEGMENTS_UPDATED`
  → `STREAM_DONE` in order; a new send supersedes; mode-off does not auto-play;
  no resolvable voice does not auto-play; history is never auto-played.
- **Render (progressive commit):** a streaming message renders its committed
  prefix as `<MarkdownContent>` and its open tail as raw `stream-tok`; the
  committed render only re-parses on a paragraph commit, not per token; the
  committed render of a text equals the finalised render of the same text
  (seamless-transition guard, §6.2).
- **Glow:** a committed paragraph of a *streaming* message glows while spoken
  (§6.1 verification point).
- **Affordances (Laura fixes):** tapping the greyed toggle reveals the disabled
  reason and exposes a route to Settings → Voice (not `title`-only); the manual
  read button's disabled tones do the same; the `waiting` sub-state keeps
  `VoiceTransport` mounted in its "reading…" state; the first-Stop hint shows
  exactly once (guarded by `voiceStopHintSeen`) and never again.
- **Gates:** `pnpm typecheck --force`; full user-client vitest (against the known
  8-failure Node-26-localStorage baseline); `pnpm run build --force`; biome.

## 10. Audit gates

- **Laura (UX): spec-pass DONE (2026-06-13).** Two hard defects, both about
  feedback reaching the user **on touch**, not the core mechanics: **H1** the
  disabled reason rode a hover-only `title` tooltip (invisible on touch) →
  resolved by the touch-reachable inline note + route to Settings (§8), applied
  to the new toggle **and** the existing manual read button; **H2** no signal for
  "armed but silent" → resolved by the lit-toggle + `waiting` "reading…" contract
  (§8). Soft findings: Stop-vs-toggle asymmetry → one-shot first-Stop hint (§7,
  adopted); "sending is barging" abrupt cut → graceful fade is a styling-pass
  note; progressive-typography calm budget → watched on device (§11 step 3a);
  cold tooltip copy → warmer wording adopted (§8). A light **pre-squash pass** is
  still due once built, to verify the flow honours this intent.
- **Larissa (security): no.** Client-only; no new egress class (TTS egress
  already exists — same providers, same paths). Not her path.

## 11. Manual verification (device, Chris)

With a read-aloud voice configured:

1. Toggle the cockpit voice mode on → it lights. With no voice set it is greyed;
   **tapping it (on touch) reveals the reason inline and offers a route to
   Settings → Voice** — no reliance on hover. The manual read button behaves the
   same when disabled.
2. Send a message → the reply begins speaking after the first paragraph closes,
   while later paragraphs are still streaming; glow tracks the spoken paragraph.
3. A multi-paragraph reply: speech follows paragraph by paragraph; if speech
   catches up to the stream, it waits silently and resumes when the next
   paragraph commits — no premature "finished". During that silent wait the
   `VoiceTransport` stays visible in a calm "reading…" state (not idle/paused),
   so the pause reads as "still going".
3a. As paragraphs commit, they settle into final markdown typography during the
   stream (the open tail stays raw), and the glow tracks the spoken paragraph
   throughout — with no visible jump in layout or TEAL rendering as a paragraph
   crosses the commit boundary.
4. Enter a chat that generates an opener → the opener auto-reads.
5. Send a new message while it is still speaking → current speech stops, the new
   reply takes over.
6. Tap the playback stop control → speech stops, mode stays on; the next reply
   auto-reads again. The **first** time, a one-shot hint explains the mode is
   still on; it never shows again.
7. Toggle the mode off mid-read → speech stops; subsequent replies are silent.
8. Toggling the mode on mid-conversation does **not** read the last message.
9. A reply containing a code block reads the prose around it and skips the code,
   with no mid-stream stutter at the fence.

## 12. Open items for the plan

- Confirm the next free Dexie version number against the current schema before
  writing the migration (collision hazard).
- Pin the precise `committedPrefix` mechanism: how the per-chunk streaming text
  blocks are joined into the coalesced view, how the top-level blank-line +
  balanced-fence boundary is detected, and how `blockIndex`/`paragraphIndex` are
  numbered so they match the finalised render. (The index-reconciliation worry is
  resolved by construction — one committed-prefix view drives both — but the
  joining/numbering itself must be pinned.)
- Decide the render strategy for the committed prefix so re-parse is per-commit,
  not per-token (memoise on `committedText`; consider rendering per committed
  paragraph block to avoid re-parsing the whole prefix each commit on long
  replies).
- Verify the streaming-TEAL (`transformTealStream`) and finalised-TEAL
  (`rehype-teal`) outputs are visually equivalent for the same text, so the
  commit-boundary transition is seamless (§6.2).
- Confirm the stream-manager exposes a clean per-chat "draft updated" + "draft
  status (streaming / done / error)" subscription the driver and the render can
  consume without per-token React churn.
