# Synthesis — Porting Kumbu² and the depth of memory integration (2026-11-01)

Raw material from a side discussion between Chris and Claude, held in the Kumbu²
repository. Nothing here has been tested; the possible way forward below is a
direction to check, not a design.

## Settled, more or less

- **Kumbu² gets ported into Chatsundere.** Its tools plus `sh` are treated as a
  "POSIX-like" (tongue in cheek) **protocol layer**. Kumbu² also serves as the
  proof of concept for that layer.
- **MCP comes first**, the port afterwards.

Because the protocol layer stays the same, instructions and findings from the MCP
stage should carry over to the port. That is what stops the MCP stage being
throwaway work.

The open question is therefore not whether to port, but **how deep the integration
goes**, above all for memory.

## Why not simply swap the memory

The two models fail in opposite ways.

**Where extraction loses** (`superpowers/specs/2026-06-20-memory-design.md`):

- The body is capped at 3000 tokens and newer information wins when the budget is
  hit (§4), so details drop out by design.
- Dreaming rewrites the whole body, so every run paraphrases everything. Kumbu²
  edits in place, with version tokens, diff and restore.
- Dedup is a string match (§4), so paraphrases pile up.
- The block is injected into every send, needed or not (§5).

**Where extraction wins:**

- **Coverage when writing.** It reads every message. A model in the middle of an
  emotional conversation rarely stops to take notes, and nobody notices what was
  never written.
- **Recall without a cue.** The block is always present. A model only searches when
  it suspects there is something to find: "suggest a restaurant" rarely triggers a
  search for a nut allergy.
- **Model independence.** Personas run on arbitrary models; see §5a of
  [[2026-07-19-librarian-architecture]].
- **Latency.** Every search is another tool round, which matters most in voice mode.

## Possible way forward: a hybrid, in levels of depth

Each level is only worth building if the one before falls short.

| Level | What Chatsundere does | What it addresses |
|---|---|---|
| 0 | Connects Kumbu² over MCP; instructions only | Baseline: what can a model do on instructions alone? |
| 1 | Always loads a short profile note plus index from the vault; everything else on demand | Recall without a cue |
| 2 | Reminds the model every few messages to check whether something is worth noting | Coverage, with the conversation's own model and no second pipeline |
| 3 | Keeps extraction as a safety net, writing candidates to an inbox note instead of a prose block | Coverage for models that ignore the reminder |
| 4 | Turns dreaming into tidying: targeted edits with a diff instead of a whole-body rewrite | Silent loss from rewrites |

A generic MCP harness can only offer level 0. From level 1 on, Chatsundere's
advantage counts: it owns the loop, so it can make these steps deterministic rather
than hoping the model follows instructions.

Level 2 is the cheap experiment that may shrink the rest. If the reminder is enough,
extraction remains only for models that do not respond to it. It also fits the
reasoning for having no utility model (spec §10): the model that held the
conversation is the one that writes.

## Instructions: occasions, not frequency

"Keep writing down what belongs in memory" has no trigger, so some models record
every sentence and others nothing. "Summarise at the end of the conversation" never
fires, because a chat has no end. A first draft:

- **Note immediately:** a correction, a decision, a new person or name, a preference
  or boundary, anything the user explicitly asks to have remembered.
- **Do not note:** moods, tasks in progress, one-off requests. The extraction
  prompt's quality bar already says this and can be reused.
- **Search before writing:** extend the existing note instead of creating a new one.
  This is what produces a Zettelkasten rather than a journal spread over many files.
- **Look before answering:** for every person, project and recommendation, not only
  for direct questions.
- **Stay quiet:** do not announce that something is being noted; it breaks the
  persona.

## Open questions

- **Vault per persona?** The most natural fit with "no global memory" (spec §10),
  and it keeps the user's own vaults read-only for personas. Sharing memory between
  personas later would revisit that decision.
- **The stance of Kumbu².** Its concept says it is explicitly not an AI memory
  system: it is the user's memory, and the AI gets a key. A vault the persona writes
  to bends that, and should be a conscious choice.
- **Authority of injected notes.** Kumbu² treats note content as data, not
  instructions. A profile note loaded into the system prompt must keep that status,
  and is more exposed than a note read through a tool.
- **Lorebooks.** Phrase-triggered injection has no direct counterpart in Kumbu². The
  rest of the knowledge base should map across quite directly, but lorebooks need a
  separate look.
- **Existing memory.** How journal and body move into a vault has not been considered.
- **Local-first.** Memory is purely client-side today (spec §2). The MCP stage needs
  a server; only the port removes that again.

## How to check

A small comparison in the style of §5b of [[2026-07-19-librarian-architecture]]:
the same conversations through both systems, with one strong and one middling model.
Then check incidental facts, corrections and invented facts. The results decide how
far up the table to go.
