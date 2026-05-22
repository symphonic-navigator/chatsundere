# Subagent vs inline execution — Squash α lessons

**Date:** 2026-05-22
**Context:** First multi-task execution of a written plan in this project. Cross-device-identity backend plan, Squash α (Tasks 1–7).

---

## What was tried

Chris's global `~/.claude/CLAUDE.md` says "When using superpowers plugin always default to subagent based execution - no question necessary." Following that, Tasks 1–2 of the cross-device-identity backend plan were executed via `superpowers:subagent-driven-development`: implementer subagent → spec-compliance subagent → code-quality subagent per task. Tasks 3–6 were executed inline by me after we hit problems on Task 2.

## What worked (subagent)

**Task 1 — repo-wide path migration `/v1/` → `/api/v1/`.** Mechanical change touching ~20 files. The implementer subagent finished cleanly, the code-quality subagent caught one stale JSDoc reference in `_rate-limit-helpers.ts`. Total round-trip: ~25 minutes including reviews. **Subagent-driven was strictly better here**: mechanical scope, no architectural judgement, well-bounded by the plan's per-step instructions. The fresh context isolated noise from my session.

## What failed (subagent)

**Task 2 — DB rename `invitations` → `pending_codes`.**

1. Implementer subagent's status report claimed "1 pre-existing failure" without checking `follow-ups-index.md:82`, where the actual 9 known full-lifecycle failures are documented. The report was misleading enough that I had to verify everything manually — exactly the failure mode the subagent-driven pattern is supposed to avoid.
2. Spec-reviewer subagent decided to verify the "pre-existing" claim by running `git stash push -u` → `git checkout 0389dd2` → `git checkout master` → `git stash pop`. The pop interacted badly with the working tree and **left 16 files staged as a revert of the entire Task 2 commit**. A subsequent `git commit` would have silently undone Task 2.
3. Migration 0003 itself had a real gap: the `role` column kept its NOT NULL constraint despite the Drizzle schema marking it nullable. Pairing-code inserts would have failed at runtime. Neither the implementer nor the spec-reviewer caught this; I caught it only because I read the dev DB schema myself.

## Root causes

- **Subagents have no project memory.** They don't read `follow-ups-index.md` proactively, don't know our test-isolation history, don't know which test failures are baseline. The plan can name these but cannot enumerate every gotcha.
- **The control loop for "verify a claim" is hostile to subagents.** Verifying whether a test failure is pre-existing requires either trustworthy project memory (subagents lack it) or running the test at a previous commit (which means git surgery on the working tree, and subagents handle that badly).
- **Migration-shaped work requires whole-system context.** Knowing that "ALTER TABLE renames preserve column constraints unless explicitly altered" and that "the test DB has its own migration journal that has to be advanced separately from the dev DB" is the kind of thing a subagent has to discover painfully each time. An inline operator with the running state in their head moves much faster.

## What works inline

Tasks 3–6 (codes/token helpers, admin-invitations reshape, requireStepUp helper, Tier 4 step-up gate) all landed inline in roughly the same wall-clock time per task as Task 1 (~20–30 min each) **without** the recovery overhead. Each task ended with green tests, biome clean, typecheck clean. Larissa's audit at the end caught two real items (logger redact list, defence-in-depth on unknown step-up tier) that no subagent loop had caught.

## Decision for Squash β + step-up backend

- **Inline by default** for the rest of cross-device-identity and the step-up backend. The remaining work touches DB lifecycle, OPAQUE round handling, wrapped-MK material, and the unified join endpoint. All have the same shape as Task 2 — high cross-system context, fragile to subagent misreporting.
- **Subagent-driven still right for mechanical sweeps** if any come up later. The clean Task 1 result wasn't an accident; it was a good match between work type and execution mode.
- **Subagent-driven still right for security audits** (Larissa-style read-only review). The Larissa audit at the end of Squash α was an Opus subagent and was the highest-value subagent invocation of the session. Audits don't write code or touch git; they just read and report. That's where the pattern shines.
- **Never let a review-stage subagent run destructive git operations.** Explicit prompt rule from now on: "Do not run `git stash`, `git checkout` to other refs, `git reset`, `git restore`, `git rebase`, `git branch`, `git switch`. Read previous commits via `git show <sha>:<path>` only."

## Cost summary (rough)

- Task 1 (subagent): ~25 minutes including reviews, 1 minor fix, clean.
- Task 2 (subagent): ~60 minutes including the recovery (claimed-baseline check, working-tree reset, migration 0004 follow-up), one real gap caught only by me.
- Tasks 3–6 (inline): ~25 minutes each, no recovery overhead, all green on first run modulo TDD-cycles.
- Larissa audit + 2 fixes + squash (mix): ~25 minutes, conditional pass.

## Memory update

Saved `[[memory:domain-ownership]]` capturing Chris's "above my paygrade" framing for backend/auth/crypto/DB choices. This insight is the operational corollary on the execution-mode side: I default to subagent on mechanical work and inline on architectural work, even though the global CLAUDE.md says "always default to subagent" — Chris's CLAUDE.md priority order has user direct instructions winning over default skill behaviour, and his real direction here is "use what works", not "use subagents religiously".
