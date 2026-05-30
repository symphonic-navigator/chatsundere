# Mode 4 — Batch-check (dev-only, token-heavy)

Trigger: "check these 8 models" / "batch-check this sub-selection". This mode is
**dev-only and token-heavy**, so it is always **explicitly started by Chris** —
never something you initiate. First read
[`catalogue-model.md`](catalogue-model.md) and
[`conventions.md`](conventions.md).

## Orchestration

Dispatch **subagents in worktrees** — one worktree per model, an explicit
sub-selection. Each subagent runs the relevant mode against its single target:
mode 2 ([`model-curation.md`](model-curation.md)) for a fresh model, or mode 3
([`verify-offering.md`](verify-offering.md)) for an existing offering. Each runs
its conversation-suite locally with the provider key from `keys/`.

The orchestrator (Liz) then **collects the results, merges the worktrees, and
handles all git** — squash per feature unit, `[skip ci]` for doc-only commits.

For the fan-out and worktree mechanics, use the
`superpowers:dispatching-parallel-agents` and `superpowers:using-git-worktrees`
skills.

## Hard rules

- **Subagents never merge, push, or switch branches.** Git is the orchestrator's
  job, full stop (CLAUDE.md §8). State this explicitly in every subagent prompt.
- **Always a sub-selection, never "all models".** Scope each batch to an explicit
  list of models. The token cost is real; a "check everything" run is not a thing
  we do.
- **Worktree isolation enables clean merges.** One model per worktree keeps each
  subagent's writes collision-safe so the orchestrator can merge them cleanly.
- **Local-only.** Keys live under `keys/`; nothing in this mode touches CI.
