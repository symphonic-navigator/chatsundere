# Synthesis — Eidolon, VAFS and whether we need an agentic loop (2026-11-10)

Raw material from Chris, recorded by Liz. Nothing here is designed or tested; it is
a change of direction to watch, not a decision. Follows on from
[[2026-11-01-kumbu-port-and-memory-depth]].

## Kumbu² as the live testbed

Kumbu², Chris's parallel project, is an MCP server that already does what
Chatsundere's **Projects** feature (Project Synthesis) is meant to do. Chris is
watching how its **VAFS** — *virtual agent file system* — is used in practice,
and that observation now feeds the design here.

## Maybe no real agentic loop

The planned **agentic loop spec** (context budget, protecting the user message,
round checkpoints, approval Stop; see [[../insights/follow-ups-index]]) may be
less necessary than assumed: in Kumbu² the models **work linearly** anyway, one
tool call after the other, without needing loop machinery around them.

Not dropped, **on hold** until the VAFS observation says more.

One caveat worth keeping beside it (Liz): some items under that spec are defects
of the current 25-round tool loop whatever the loop becomes. The main one:
`truncateToWindow` drops the oldest history first, which includes the user's own
request once a long tool exchange fills the window. A linear model can still lose
its task that way. That and the security items attached to the spec (M2, L2,
L-http, L4) need a home even if the "real loop" never comes.

## Sync resumes soon

The project-filesystem sync decision (see [[../STATUS-CLIENT-ONLY]], v0.3.2) is to
be picked up again shortly. Chris wants to think it over first and see how VAFS
usage plays out in Kumbu².

## Preview for Phase 3: the Eidolon standard

A standard, for ourselves at least, called **Eidolon**:

- a **virtual file system stored in a database**;
- one **`sh` tool** that carries the bulk of the operations as shell-like commands,
  `rg` among them.

This matches the Kumbu² port note: its tools plus `sh` as the protocol layer.

Chris is working out how to **cut it into optional subsets** of this
"application layer standard", for example:

- `eidolon` — the core (VFS + `sh`);
- `eidolon_pdf`, `eidolon_skills`, `eidolon_img`, `eidolon_kanban`, … — optional
  modules on top.

## Open questions

- Where the cut between core and modules runs, and what a client must implement to
  claim `eidolon` on its own.
- How a client or server advertises which subsets it supports.
- Whether Projects (the deferred client feature) is built directly as an Eidolon
  implementation.
