# 0034 — XState for the voice domain

**Date:** 2026-06-11
**Status:** Accepted

## Context

The voice subproject (read-aloud, dictation, live voice mode) needs explicit
state management of a kind the rest of the app does not: parallel concerns
(playback ∥ microphone ∥ barge-in), delayed transitions (barge confirmation
delays, pause-redemption windows, inter-segment gaps), and async work whose
lifetime is bound to a state (synthesis and STT requests that must abort when
their state is left).

The house pattern everywhere else is hand-rolled Zustand stores, and our
stream-manager proves that pattern handles serious async complexity. But the
reference implementation in `../chatsune` is the cautionary tale for this
specific domain: its voice features grew two parallel hand-rolled machines
(`voicePipeline` for push-to-talk, `bargeController` for conversation mode)
that observe each other through callbacks, with UI code OR-ing the two phase
systems together, plus manual timer bookkeeping (`pendingGapTimer`) of the
kind that breeds races.

A middle option was considered: a hand-rolled store with the transition table
expressed as data (runtime-checked, test-enforced). It buys transition
enforcement but none of the hierarchy, parallel regions, declarative timers,
or state-bound cancellation.

Timing matters: if Spec 3 (live voice) wants statecharts, the playback
machine from Spec 1 must be a region/actor of the same world — adopting
XState only at Spec 3 would mean rebuilding the freshly built core. The
choice is effectively all-or-nothing, and it lands now.

## Decision

Use **XState** (v5, with `@xstate/react`) for the voice domain — starting
with the Spec-1 playback machine — and **only** for the voice domain.
Everywhere else, Zustand stores remain the house pattern.

Concretely:

- Voice state machines are declared as XState statecharts; synthesis/STT
  requests run as actors so leaving a state cancels them automatically.
- Timers (segment gaps, barge delays, redemption windows) are declared as
  `after` transitions, never as manually tracked `setTimeout` handles.
- React binds via `@xstate/react` selectors; no parallel Zustand mirror of
  machine state.
- Spec 3's live-voice machine composes the Spec-1 playback machine as a
  region/child actor rather than introducing a second machine that watches
  the first.

## Consequences

- **Positive:** impossible transitions are unrepresentable rather than
  disciplined away; parallel regions model live voice directly; timer and
  abort cleanup is automatic; machines can be visualised and simulated in
  the Stately editor during spec review; event-sequence tests are
  deterministic.
- **Negative:** a second state paradigm in the codebase. Every future voice
  session — including subagent-driven builds — carries the XState idiom as
  extra context; unfamiliarity may cost fix rounds early on. The boundary
  ("voice domain only") is discipline, not tooling — drift into other
  features would erode the house pattern and must be refused in review.
- **Neutral:** ~15 kB dependency; acceptable.
