# ADR 0029: Tool Display Position

## Status

Accepted (2026-05-24, Phase 3).

## Context

The chat stream renders in-stream system events as Pills — small rounded
oval components with a kind-specific icon and a short label. Each Pill
declares a `positionHint: 'inline' | 'above-text'` field on its
`PillRow`. Position is semantically meaningful, not purely a styling
choice:

- `inline` keeps the persona's voice flowing: the Pill is embedded in
  the text-block, as part of the same sentence or paragraph the persona
  is producing. Reading a Pill inline reads like a single thought.
- `above-text` lifts the Pill into a separate block above the
  surrounding text. This is the right placement when the Pill is
  *context the following text refers to*, not part of the voice itself
  — for instance, a Knowledge-Base injection the persona is about to
  cite, or an image-result the persona is about to comment on.

Phase 3 introduces the data field but does not yet have the registries
that determine the value per concrete tool / knowledge-base / image
source. We need a clear convention for the field's lifecycle and
defaults before later blocks lock in user-visible behaviour.

## Decision

1. **`PillRow.positionHint: 'inline' | 'above-text'` is a mandatory
   field on every `PillRow`.** The data model never carries a Pill
   without a position. Default-deciders are layered below.

2. **Phase 3's stream-engine emits `tool-call` Pills with
   `positionHint: 'inline'`, hardcoded.** Phase 3 does not register
   tools and does not execute them, so there is no per-tool metadata
   to read; `inline` is the right default for a tool the persona
   mentions while speaking.

3. **When the Tool Registry lands in a later block**, each tool's
   manifest declares `displayPosition: 'inline' | 'above-text'`. The
   stream-engine reads this manifest at emission time and writes the
   value into `PillRow.positionHint`. The hardcoded `inline` constant
   in Phase 3 becomes a fallback only for tools without explicit
   manifest position (legacy / external tools).

4. **Other `kind` values receive their defaults from the block that
   introduces them**, not from this ADR:
   - `kb-injection` Pills default to `above-text` (the surrounding
     text refers to the cited knowledge).
   - `image-result` Pills default to `above-text` (the persona
     describes the image that follows).
   - `voice-expression` Pills default to `inline` (a voice marker is
     part of the spoken cadence).

   Each of those blocks will document its own choice; we record the
   intent here so future ADRs build on the same vocabulary.

## Consequences

- The Phase-3 codepath stays trivial: a single constant
  `positionHint: 'inline'` inside `apps/user-client/src/lib/stream-engine.ts`.
- The data model is forward-compatible: existing PillRows already carry
  the field; the Tool Registry will populate it correctly without a
  reverse migration.
- Reviewers should reject any pill emitter that omits `positionHint` —
  the discipline of carrying it everywhere is the long-term defence
  against silently shifting Pills around the screen.
- This ADR does not commit on the visual treatment of `above-text`
  Pills beyond what `Pill.tsx` already implements (a block wrapper);
  refinement of that surface remains a UI concern, not an ADR concern.

## Sources

- `superpowers/specs/2026-05-24-phase-3-chat-design.md` §5.3.
- `superpowers/plans/2026-05-24-phase-3-chat.md` Task 35.
- UX-CONCEPT.md §"Pills (Inline Stream Elements)".
