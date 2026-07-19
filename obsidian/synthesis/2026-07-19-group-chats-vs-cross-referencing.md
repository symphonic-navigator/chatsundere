# Ember & Zen, round two: cross-referencing vs group chats

Captured 2026-07-19, same session as the initial idea map. Chris's follow-up
thinking on the Juliet request — and the question "why not *real* group chats?"

## The cross-referencing model (composite persona)

Chris's refinement of "finger of god": no persona synthesis at all. Instead:

- Juliet creates a persona named *"Ember and Zen"*;
- that persona **references** Ember's and Zen's memories, and every fresh chat
  injects both referenced personas' collected memories into its system prompt
  on the fly.

**The problem Chris immediately spotted: backfill.** The composite persona's
new conversations generate new memories — where do they go? Into the
composite's own store, diverging from the sources? Written back into Ember's
and Zen's individual memories (and if so, attributed how)? Both answers are
ugly. Backfill is the big theme of this model; recorded as a "constructive
hurdle".

## The group-chat alternative — and why backfill dissolves

Liz's analysis: **group chat is not a workaround for the merge — it makes the
merge unnecessary.** If Ember and Zen are both *actually present* in one chat
(rather than impersonated by a composite):

- each persona keeps running its **own** memory pipeline over its own view of
  the conversation — memories stay per-persona, correct, and attributable;
- there is nothing to merge and nothing to backfill — the problem doesn't get
  solved, it **stops existing**;
- whispers even add something the composite could never do: Juliet can tell
  Ember something Zen doesn't know.

Second strong argument: **mental model.** Everyone on earth knows messenger
group chats. "Don't make me think" is satisfied for free — unlike composite
personas or memory cross-references, which are abstractions users must learn.

Also compatible with the hard rule "no parallel chats" — a group chat is still
*one* active chat.

## What group chat really needs (Chris's list + sketches)

### 1. Whispers

Per-message **audience scoping**: a message the user addresses to one persona
only, invisible to the others' context views (and visually distinct in the
transcript). v1 probably user→persona only; persona→user private asides are a
later thought.

### 2. Turn-taking — self-selection, no director (Chris, 2026-07-19)

Chris's proposal, replacing the earlier director idea: **every persona gets
every prompt**, with an instruction that answering is optional — except when
@-addressed, which obliges. If **all** personas decline, Chatsundere picks one
(or both) at random and re-runs the pick *without* the optional-response
instruction, forcing an answer.

Why this beats a director: the personas decide **in character, with full
context** — a director is a third mind that must understand both personas
from outside, costs its own call, and its input bill is no smaller (it needs
the same context to decide well). Self-selection is one component fewer and
higher fidelity.

Liz's refinements (working notes, all spec-level):

1. **Structural decline protocol.** "Answer with PASS" phrase-matching is
   brittle (the repo's own lesson: structural, never phrase-matched). Give
   each persona a `stay_silent` tool instead — a tool call is a machine-
   readable decline; prose output means "I'm answering".
2. **Optionality lives in the system prompt, not the message** (deviation
   from the first sketch, for cache reasons): a static rule ("in this group
   chat you may stay silent unless @-addressed") keeps every per-persona
   cache lineage byte-stable. A per-message injected instruction that later
   disappears from history breaks the append-only property every turn. Only
   the rare **forced re-run** carries a transient assembly-time nudge — a
   one-turn cache break, acceptable because rare.
3. **Sequential evaluation in random order** (instead of parallel): the
   second persona sees the first's fresh answer (or its silence) before
   deciding. Kills duplicate answers, produces organic dynamics (chiming in
   vs staying quiet), and the random order matches the house taste for
   organic variation. Price: worst-case latency ≈ sum of turns, not max —
   the parallel-vs-sequential trade is a real spec decision.
4. **Cost honesty:** "everyone reads every prompt" means N× input processing
   per turn regardless of who answers, but declines are cheap (cached input +
   a near-empty output). This is inherent to informed self-selection — a
   director wouldn't have been cheaper.
5. **Open question — is silence ever legitimate?** User says "ok brb": in a
   real group, silence *is* the right answer, and the forced re-run would
   produce an unnatural reply. Counter-weight: an AI chat that sometimes
   doesn't answer reads as broken (least astonishment). v1 leans Chris's way
   (always force); revisit with field feedback.
6. **Curation tie-in:** protocol compliance (declines cleanly via tool, no
   sentinel leakage, answers when @-addressed) is a per-model capability —
   the conversation-suite grows a group-chat leg, and a model that cannot
   hold the protocol gets flagged, mirroring `unsuitableAsBackgroundWorker`.

- **Persona-to-persona replies** (Ember reacts to Zen) — desirable for the
  theatre, but needs a hard chain-length cap (e.g. one follow-up) or two
  personas can burn tokens talking to each other forever. Note: refinement 3
  (sequential evaluation) already gives a bounded version of this for free —
  the second speaker reacts to the first within the same turn.

### 3. Context + cache handling

The insight that makes caching *tractable*: each persona already needs its own
context lineage (own system prompt, own memory injection, own whisper-filtered
transcript view). So there is no "shared cache" to preserve — there are **N
independent per-persona cache lineages**, each of which stays cache-friendly
iff its filtered view is **append-only**: a message once included stays,
a message once excluded (whisper to someone else) stays excluded forever.
Audience scoping must therefore be immutable per message — set at send time,
never edited afterwards. Cost is roughly N× a solo chat when N personas
answer; turn-taking keeps the common case at 1×.

### Untouched-but-affected list (for a future spec's honesty)

Group chat cuts across: the one-persona-per-chat assumption in `ChatRow` and
everywhere downstream, stream manager (concurrent/sequential streams), memory
pipeline (per-persona filtered extraction), compaction, TTS/voice (per-persona
voices), roleplay settings (per-persona, may differ within one group),
transcript UI (attribution, avatars), title generation, transfer/export.
This is a **deep architectural feature** — likely bigger than the entire
Synthesis prototype.

## Where this leaves the three contenders for Juliet

| Approach | Solves the ask | Conceptual cleanliness | Cost |
|---|---|---|---|
| One-shot merge | partly (loses the individuals) | murky | medium |
| Cross-ref composite | mostly | murky (backfill!) | medium |
| Group chat | fully, plus new value (whispers) | clean — backfill dissolves | high |

Working conclusion (nothing decided): group chat is the *right thing* in the
quality-10-over-100 sense; cross-referencing is the tempting shortcut with a
structural flaw at its centre. If group chat is where this ends up, the
one-shot merge and the cross-ref model both likely die — worth re-reading
[[2026-07-19-initial-idea-map]] §7 in that light. Deferred either way; this
note exists so the eventual decision starts from today's thinking, not from
scratch.
