# ADR 0003: One squashed commit per feature unit

**Date:** 2026-05-18
**Status:** Accepted

## Context

Chatsune accumulated **2789 commits in six weeks** — most of them intra-feature noise (typo fixes, "try this", "revert that", "small follow-up"). History became unreadable, bisects painful, reverts unsafe. Chris named this as a lesson he wants to act on with Chatsundere from day one.

## Decision

One squashed commit per feature unit. Examples of correct unit granularity:

- "Set up monorepo and tooling"
- "Add auth-service"
- "Add crypto package"
- "Wire user-client registration flow"

Not finer (no per-file or per-fix commits in the final history). Not coarser (no "Phase 0 done" mega-commits).

Commit messages: **free-form imperative**, no Conventional Commits prefix.

Pre-public phase: we work directly on `master`, but still squash chunks before pushing. Feature branches are fine when work needs parallel iteration or when Larissa is about to audit.

For security-touching feature units (`apps/auth-service`, `apps/sync-service`, `apps/proxy-service`, `packages/crypto`): Larissa audits PRE-squash. Findings fix → re-audit → squash when clean.

Subagents never merge, push, or switch branches — that responsibility stays with Liz.

## Consequences

Positive:
- History is readable. Each commit is a self-contained capability.
- Bisects land on meaningful boundaries.
- Reverts are clean: a feature comes out as one commit.

Negative / accepted trade-offs:
- Loss of intra-feature timeline (the "how I got here" trail). For decisions worth preserving, use ADRs (`obsidian/decisions/`) or insights (`obsidian/insights/`), not commit history.
- Discipline cost: when a feature drifts in scope mid-stream, recognise it early and branch a new unit rather than letting the squash bag bloat.

## References

- Memory: `feedback_squash_granularity`
- `superpowers/specs/2026-05-18-claude-md-design.md`
