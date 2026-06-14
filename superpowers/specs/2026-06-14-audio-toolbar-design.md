# Audio Toolbar — Design Spec

**Date:** 2026-06-14
**Author:** Liz (with Chris)
**Status:** Approved (pending Laura spec-pass + Chris spec review)
**Supersedes:** the cockpit-only transport stopgap shipped with the spectrum
analyser; the deferred in-canvas tap-to-pause gesture (Pause-Geste brainstorm);
the `stopHint` one-shot clarification.
**Prepares:** Spec 3 (live voice) — the "cockpitless mode" control surface.

---

## 1. Purpose

Give voice playback a single, purpose-built **control surface** — the *audio
toolbar* — that:

1. **Reserves layout space** rather than floating, so it shrinks the scrollable
   read region (`.chat-stream`) and never occludes message text.
2. Carries **large, thumb-friendly controls** sized for *en-passant*,
   "don't-make-me-aim" use (the clumsy-mode rationale — phone on the washing
   machine, hands full, plaudering while doing chores).
3. Is **visible independently of the cockpit**, so it works in Reading Mode, is
   stacked above the cockpit in Interaction Mode, and can later become the *sole*
   control surface for the cockpitless live-voice mode (Spec 3).

It is a **rededication of the existing `VoiceTransport`** component
(`apps/user-client/src/components/chat/VoiceTransport.tsx`), not a new build.

### 1.1 Why a reserved-space toolbar (design rationale, not decoration)

The toolbar turns read-aloud into a **felt mode switch**. By taking real vertical
space — pushing the read region up as it slides in — it tells the user, bodily,
"something has been added; you are now in a different state", instead of leaving
them to infer it. This is *dere* in the product's sense: not explaining, but
making the change tangible. It is the same reason the read-aloud task ("read me
the text I asked for") is a lean-back task — every aiming requirement sabotages
it, so the controls must be reachable without looking.

---

## 2. State identity — "voice session active"

The toolbar is visible **if and only if a voice session is active**. "Active" has
three expressions today, a fourth later:

| # | Expression | What is playing | Notes |
|---|---|---|---|
| a | **Read-aloud running** (`speaking` / `paused` / `failed` / `waiting` / `ended-partial`) | audio playing or interrupted | full controls (§3) |
| b | **Auto-read armed** (auto-read on, currently *between* two replies) | nothing | toolbar **stays visible**; Pause + Skip disabled; **Raus** ends auto-read |
| c | **Resume offer** (user left, position remembered) | nothing | Resume · ¶N + Start over |
| d | **Live voice** (Spec 3, later) | — | becomes the sole control surface; hold-to-talk |

The load-bearing distinction: **auto-read armed ≠ idle.** While auto-read is on,
the toolbar is present even in the silence between replies, so "toolbar visible"
and "the next reply will read itself aloud" are the *same visible fact*.

The toolbar and the cockpit are **orthogonal**. Opening or closing the cockpit
never starts, stops, or hides a voice session; ending a voice session
(**Raus**) never touches cockpit visibility.

`disabled over hidden` (CLAUDE.md §11) falls out for free: in expression (b)
Pause is greyed, not removed — the user sees the capability exists, only that
there is nothing to pause right now.

---

## 3. Button frame

A fixed, predictable skeleton: the **right slot is always "Raus"** (a constant
thumb target for the escape — it never changes position), the left/centre slots
hold the contextual playback actions. Notes appear in a **thin line above** the
buttons and never reflow them.

| State | Left region | Right (constant) | Note line above |
|---|---|---|---|
| `speaking` | **⏸ Pause** · **⏭ Skip** | **Raus ▸** | — |
| `waiting` (streamed reply still arriving, segments starved) | **⏸ Pause** · **⏭ Skip** | **Raus ▸** | "reading…" |
| `paused` | **▶ Resume** · **⏭ Skip** | **Raus ▸** | — |
| auto-read armed | **○ ready** *(distinct calm indicator)* · ⏭ *(disabled)* | **Raus ▸** | "voice mode on — next reply reads itself" |
| voice unavailable while armed (provider down / `disabledReason`) | ⏸ *(disabled)* · ⏭ *(disabled)* | **Raus ▸** | the `disabledReason` text (never silently retract) |
| `failed` | **↻ Retry** · **⏭ Skip** | **Raus ▸** | "couldn't read this part aloud" |
| `ended-partial` | **↻ Retry** | **Dismiss** *(in note line)* | "couldn't finish reading aloud" |
| resume offer | **▶ Resume · ¶N** | **Raus ▸** *(declines the offer)* | "Start over" as a small secondary link in the note line |
| provider-skip at idle (no live session) | — | **Dismiss** *(in note line)* | "skipped a passage the voice provider declined" (singular/plural per count) |

`waiting` is "playing, just starved": Pause holds the session (the next segment
will not auto-play once it arrives), Skip is harmless if nothing is queued. It
is a real, reachable live state and must have a defined frame — it is not idle.

### 3.1 Consequences

1. **Skip is now always present while something is playing** — a deliberate,
   serendipitous addition beyond error recovery. It lets the user skip an
   uninteresting passage (the canonical "as an AI…" boilerplate) with one
   thumb tap. Skip advances past the current segment (= paragraph) via the
   existing `voice.skip()`; no new machine capability is required.
2. **"Raus" never moves.** Whatever the state, the escape thumb target is the
   same corner — exactly what clumsy-mode needs.
3. **The note line is always present but reserved** (fixed height, empty by
   default). Text appears and disappears within it; the buttons stay fixed.

### 3.1a Auto-read-armed: a distinct "ready" indicator, not a greyed Pause

In the auto-read-armed state the left slot shows a **distinct, calm "ready"
indicator** (e.g. a quiet breath dot), **not** a greyed-out ⏸ Pause glyph. This
is a *deliberate, narrow divergence* from strict `disabled over hidden` (§11):
a disabled ⏸ and a genuinely *paused* player share the same glyph, and in
clumsy-mode the user reads the big icon before the thin note — so a greyed Pause
would read as "paused" rather than "armed, nothing playing yet". The divergence
is confined to this one state; it is justified by the glyph conflation, not by a
general retreat from disabled-over-hidden. The genuinely *unavailable* state
(provider down) keeps the honest greyed-with-reason treatment, because there the
capability really is disabled.

### 3.2 "Raus" semantics

**Raus** is the one context-correct exit from the voice surface:

- read-aloud running → stop this playback;
- auto-read armed → turn auto-read off (a second control mirroring the cockpit
  toggle; both write the same persisted state);
- live voice (later) → leave the cockpitless live-voice mode.

It is **voice-only**: it ends the voice session and the toolbar slides away; the
cockpit (if open) is untouched. This single, holistic exit is what retires the
`stopHint` clarification — the Stop-vs-toggle ambiguity that hint papered over
can no longer arise.

**Raus vs Dismiss — the right-slot split.** To keep Raus strictly
session-scoped (so it never quietly grows a fourth "acknowledge this note"
meaning), the right slot carries **Dismiss**, not Raus, in the purely
*informational* terminal states where there is no live session, offer, or armed
mode to leave: `ended-partial` and provider-skip-at-idle. In every state where
there *is* something to leave — an active read, `waiting`, `paused`, auto-read
armed, voice-unavailable-while-armed, or a pending resume offer (which Raus
declines) — the slot is **Raus**. The rule the user internalises: **Raus = leave
the voice surface; Dismiss = acknowledge this note.** Both retract the toolbar.

### 3.2a User-facing label is British English

"Raus" is the working name from the design chat. The actual button copy must be
British English (CLAUDE.md §3.7). The plan uses **"Leave"** as the working label;
the final copy (e.g. "Leave" / "Exit" / "Done") is Chris's styling-pass call.
"Dismiss" is already English and stays.

### 3.3 Sizing

Three large columns on a 380 px viewport: Pause/Resume + Skip on the left, Raus
on the right, each ≈120 px wide and **≥56 px tall** — distinctly larger than the
cockpit transport controls. This is already the hold-to-talk-capable target size,
so Spec 3's hold-to-keep-talking button inherits a frame dimensioned for the
thumb, not retrofitted to it.

---

## 4. Layout & placement

- The toolbar lives in the `.chat-page` layout, **not** inside the cockpit.
- **Reading Mode:** toolbar pinned at the bottom edge; `.chat-stream` shrinks to
  sit above it.
- **Interaction Mode:** toolbar **stacked directly above the cockpit**; the read
  region shrinks to clear *both*. (Chosen over "toolbar hides when cockpit
  opens" and "voice controls move into the cockpit" — keeping the voice surface
  visibly distinct from the text-input surface honours their orthogonality.)
- **Live voice (later):** the toolbar is the sole control surface; no cockpit.

### 4.1 Appear / disappear

The toolbar **slides in from the bottom and reserves space** (the read region
transitions up over ≈200 ms, consistent with the existing DimOverlay timing).
Under `prefers-reduced-motion` the transition is hard (instant). The slide *is*
the felt mode switch from §1.1 — it is not ornament.

Because reduced-motion users lose the slide (their only *motion* cue for the
state change), the **note line must be populated immediately** in that path, so
the *meaning* of the newly reserved space is explicit even when the *motion* is
gone. The space-reservation jump is itself a cue; the note makes it legible
rather than abrupt.

### 4.3 Space budget (380 px, worst case)

The worst case is Interaction Mode with a live read: toolbar (≥56 px) + reserved
note line + cockpit, all eating vertical read space at once. The read region
must stay usable — the chat staying at the centre is a product tenet, and the
"felt mode switch" must not tip into "the chat is gone". The plan states the
concrete stacked height and confirms the read region remains scrollable and
legible at that height on a 380 px viewport; if it does not, the note line
collapses to a single line and the toolbar height is the floor, not the cockpit.

### 4.2 Interaction with the spectrum analyser

The analyser is centred on `.chat-stream` and is decorative
(`pointer-events: none`, low z-index). When the toolbar reserves space and
`.chat-stream` shrinks, the analyser geometry re-centres on the new bounds — no
special handling beyond confirming the existing ResizeObserver path recomputes.
Scroll-to-end, the read-aloud glow/highlight tracking, and the bottom-affordance
cue must continue to work against the reduced read height.

---

## 5. What this retires

1. **`stopHint` / `onDismissStopHint` and its persisted "seen" flag** — the
   ambiguity it explained cannot recur (§3.2).
2. **The cockpit-only transport stopgap** the spectrum analyser shipped with —
   replaced by the real toolbar.
3. **The deferred in-canvas tap-to-pause gesture** (Pause-Geste brainstorm) —
   unnecessary; the toolbar has a real, large Pause button.

---

## 6. Live-voice preparation (foundation only)

This intermediate session builds the toolbar so Spec 3 only has to plug in:

- The toolbar is **already cockpit-independent and space-reserving** → the
  cockpitless mode needs no new infrastructure, only a further voice-session
  expression (d).
- The button frame is **slot-based** → the hold-to-keep-talking button later
  takes a slot (likely the dominant central one) without rebuilding the
  skeleton.
- **≥56 px height is already the hold-to-talk target** → we dimension today for
  the thumb-on-the-washing-machine case, not for read-aloud alone.

**Explicitly out of scope today:** the hold-to-talk button itself, barging, mic
orchestration. Only the space and the independence for them.

---

## 7. Non-goals

- No change to the voice machine's state set or to TTS segmentation.
- No new persisted settings (auto-read's existing toggle/state is reused).
- No drag, no gesture controls (CLAUDE.md §14).
- No second active voice session; one at a time, as today.

---

## 8. Testing

- **Unit (Vitest):** the toolbar is presentational (props in, callbacks out).
  Cover each row of the §3 table: correct buttons present/absent, Pause + Skip
  disabled in auto-read-armed, Raus always present, note text per state, the
  note line keeping reserved height when empty.
- **Behavioural:** Raus in auto-read-armed turns auto-read off (same state the
  cockpit toggle writes); Raus is voice-only (cockpit visibility unchanged);
  Skip advances a segment while `speaking`.
- **Manual verification (Chris, on device):** listed in the plan. Must include:
  read-aloud start shows the slide + read-region shrink; toolbar stacked above
  an open cockpit; thumb-reachability of Raus across states; auto-read-armed
  greyed Pause; reduced-motion hard appearance; skip past an "as an AI…"
  paragraph.

---

## 9. Manual verification

To be enumerated in the implementation plan; device-tested by Chris. Anchor
cases:

- The washing-machine scenario — Pause + Raus reachable without aiming.
- The mode-switch feel — the slide makes the new state obvious.
- The orthogonality guarantee — cockpit open/close never disturbs playback, and
  Raus never disturbs the cockpit.
- **Raus in auto-read-armed → open cockpit → the auto-read toggle reads OFF**
  (the second control and the cockpit toggle write the same state; the mirror
  must be live).
- **Reduced-motion:** the toolbar appears hard *and* the note line is populated
  on first paint (the meaning is never carried by motion alone).
- **`waiting`:** a streamed reply mid-read shows "reading…" with Pause/Skip live.
- Skip past an "as an AI…" paragraph mid-`speaking`.
