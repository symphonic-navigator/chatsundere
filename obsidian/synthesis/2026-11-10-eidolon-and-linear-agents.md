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

## Chris's first cut, and Kumbu² laid over it

Chris's first idea (only a starting point): the **core is filesystem basics plus
Markdown support, no extras**, with system commands such as `help` and `uname`
included. `help` already lists the shell commands a deployment offers, and the few
non-shell Eidolon tools are described by MCP itself, so a model can discover the
rest on its own.

Field note: Chris tried Kumbu² in Chatsundere with Opus 5.5, and being handed a
few MCP tools was enough for it to work well. Opus 5.5 is the strongest tool caller
we have, though, so that proves little about other models.

Kumbu² is the largest implementation, with everything in it. On 2026-11-10 it
answered `uname -a` with `Kumbukumbu 0.3.2 0.3.2+129ba17 x86_64 Kumbu²` and
offered `sh` plus four MCP tools (`write`, `edit`, `replace`, `board`). Laying its
`help` over the cut (Liz's first pass):

| Subset | Shell commands | MCP tools |
|---|---|---|
| **`eidolon`** (core) | `ls`, `cat` with `#section`, `outline`, `rg`, `head`/`tail`/`wc`/`sort`, pipes, `mv`/`mkdir`/`rm`/`trash`/`restore`, `links`/`backlinks`, `tags`, `uname`, `help` | `write`, `edit`, `replace` |
| `eidolon_history` | `history`, `diff`, `restore <version>` | — |
| `eidolon_checkpoints` | `mkcp`, `lscp`, `rmcp`, `--checkpoint` | — |
| `eidolon_search` | `semsearch` (needs embeddings, so not a basic) | — |
| `eidolon_pdf` / `eidolon_img` | `pdf`, `img`, PDF text in `rg` | — |
| `eidolon_kanban` | `board` | `board` |
| `eidolon_publish` | `publish` | — |
| `eidolon_share` | shared vaults, roles | — |
| `eidolon_skills` | `skills …` (on Kumbu² staging) | — |

### Findings from the overlay

1. **Modules also extend core commands, not just add new ones.** `--version` and
   `--checkpoint` reach almost every reader; `rg` searches PDF text; `semsearch`
   and `rg` take `--tag`. The standard needs a rule for a module adding flags to a
   core command, and `help <cmd>` must show the flags active in that deployment.
2. **Optimistic version tokens belong in the core**, even if `history`/`diff`
   become a module. `write` and `edit` depend on them, and they are what stops
   several agents writing over each other's changes.
3. **One source of truth for descriptions.** Kumbu² already drifts: the `sh` tool
   description says `uname [-a|-r]`, `help` says `uname [-asrvmo]`; the
   description also lacks `board --column/--tag`. The tool description and `help`
   should be generated from one command registry.
4. **Clients need to read the subsets without parsing prose.** `help` is enough for
   a model, but a client such as Chatsundere will want to know which modules a
   server has. `uname -a` says nothing about conformance today. Candidates: a line
   in `uname -o` (`eidolon core history checkpoints search pdf img kanban …`), or a
   machine-readable manifest.
5. **`tags` in the core** (Liz's suggestion): reading Obsidian tags from the text
   counts as Markdown support and needs no infrastructure of its own.

The real test of Eidolon is weaker models (Haiku 5.5, GLM, DeepSeek): do they cope
with `help` as their only introduction?

## Open questions

- Where the cut between core and modules runs, and what a client must implement to
  claim `eidolon` on its own.
- How a client or server advertises which subsets it supports (see finding 4).
- Whether Projects (the deferred client feature) is built directly as an Eidolon
  implementation.
