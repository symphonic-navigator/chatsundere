# Spill-over idea: multiple-choice tools (chat-agentic hybrid)

Captured 2026-07-19 during the first Synthesis session — not part of the
Synthesis prototype, but born from its discussion and worth keeping.

## The idea

A tool that lets the persona present the user with a **structured
multiple-choice question** inside the chat — rendered as real UI (tappable
options), not prose the user has to parse and answer free-form. The precedent
is claude.ai / Claude Code's `AskUserQuestion`: the assistant asks, the user
taps, the answer flows back into the conversation as data.

## Why it fits Chatsundere

- Chatsundere already carries a deliberate **"chat-agentic hybrid"** identity
  (Chris): there is no reason chat harnesses shouldn't learn from coding
  harnesses. claude.ai does exactly this, and — Chris's words — Anthropic are
  a recurring UI/UX role model for Chatsundere despite the philosophical
  differences in product direction.
- It is the conversational sibling of our constructive-error principle: when
  the persona needs a decision, it offers concrete next steps instead of an
  open question the user must compose an answer to.
- Mobile-first synergy: tapping an option beats typing on a phone.

## Where it first became visible

The deletion discussion: the Synthesis prototype deliberately ships **no**
`delete_document` tool (deletion is the user's job). A future multiple-choice
tool is the kind of mechanism that could one day mediate such decisions
("Shall I archive this? [Yes / No / Show me first]") without granting the
persona destructive authority — the user stays the actor, the persona merely
structures the choice.

## Status

Idea only. No phase assigned, no design work. Revisit when the Synthesis
prototype has shipped and field feedback shows where structured questions
would genuinely help.
