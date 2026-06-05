---
name: overnight-implementation
description: Use when an implementation plan is written and approved and the work will be executed by a remote/headless Claude (claude.ai, a cloud agent, or any session without this conversation's context) — typically to run unattended overnight. Hardens the plan into a self-contained contract and produces the kickoff prompt + push checklist. Do NOT use for plans executed in this same session.
---

# /overnight-implementation — hand a plan to a context-less Claude

## Overview

A plan written in *this* session leans on context that never reaches a remote
Claude: the repo's CLAUDE.md, the superpowers skillset, the known-green test
baseline, which paths trigger a security audit, who is allowed to push. A remote
executor has **none of that**. This skill closes the gap: it hardens an
approved plan so it carries every normally-implicit rule *inside the document*,
then produces the exact kickoff prompt to paste into the remote Claude and the
push checklist for the human.

**Core principle:** the plan must be executable correctly by a skilled developer
who has never seen this repo and cannot ask a question. If a rule lives only in
your head or in CLAUDE.md, it does not exist for the overnight worker — write it
into the plan.

## When to use

- A plan exists (via superpowers:writing-plans) and the human has approved it.
- Execution will happen in a **different, context-less session** — claude.ai, a
  cloud/headless agent, a scheduled run — most often unattended overnight.
- **REQUIRED PRECURSOR:** the plan must already be written. This skill hardens
  and hands off a plan; it does not author one. If there is no plan, use
  superpowers:writing-plans first.

**Do NOT use when** the plan runs in this same session (use
superpowers:subagent-driven-development or superpowers:executing-plans) or when
nothing is written yet (brainstorm + plan first).

## The Operating-Rules contract

Every overnight plan MUST open with an **"Operating rules for the overnight
worker (READ FIRST)"** section. It is the difference between a plan and a
self-contained contract. Derive each rule from the repo's actual conventions —
do not copy a stale list. For Chatsundere the contract covers:

| Rule | Why it must be explicit |
|---|---|
| **Language** (British English everywhere; chat-with-human is the only other tongue) | A remote Claude defaults to US spelling and may write German into the repo. |
| **TDD per task** (failing test → confirm fail → minimal impl → confirm pass → commit) | Without it the worker writes impl-first and tests-after. |
| **Execution discipline** (subagent-driven, two-stage review per task; subagents never merge/push/switch branches) | The worker won't know the project's review cadence. |
| **Full verification, not touched dirs** (full suite at the end) | Per-task-dir runs have repeatedly missed regressions here. |
| **Known-green baseline** (name the exact pre-existing failures + how to confirm them on `master`) | Otherwise the worker either chases ghosts or hides a real regression. |
| **The CI gate command** (`pnpm typecheck`) **and** the build command | They diverge subtly; the worker must run both. |
| **Security gate** (which paths trigger Larissa; state explicitly when NOT triggered) | The worker can't infer the audit boundary. |
| **Branch + squash + DO NOT push/merge** (leave it for the human to device-test) | The worker must not integrate to `master`. |
| **Co-author tag** (exact string) | Keeps attribution consistent. |
| **Exact commands** (test/typecheck/build, per-package, copy-pasteable) | A context-less worker can't guess the monorepo's runner invocations. |
| **End-of-run STATUS update** (which file, what to move where) | The session-lifecycle protocol is invisible to a remote Claude. |

If any rule is enforceable mechanically (lint, hook, regex), prefer that over
prose — but the overnight worker still needs the prose, because it cannot see
the hook output the way an interactive session does.

## Hardening checklist (run against the target plan)

- [ ] Plan opens with the Operating-Rules contract above, every row filled from
      the repo's real conventions.
- [ ] **No placeholders, no "see above", no cross-task "similar to Task N".** The
      worker may read tasks out of order; every code step is complete and
      standalone.
- [ ] Every test step names the **exact command** and the **expected
      pass/fail**, with the per-package runner invocation spelled out.
- [ ] Exact file paths (and line anchors where modifying) on every task.
- [ ] A final verification task runs the **full** suites + typecheck + build,
      and states the known-green failure baseline.
- [ ] A final hand-off step: branch name stated, **do-not-push/merge** repeated,
      and "report verification numbers + commit list back to the human".
- [ ] Security boundary stated (triggered or explicitly not).
- [ ] STATUS-update step included.

Fix gaps inline in the plan file, then commit the hardened plan (`[skip ci]` if
doc-only).

## Kickoff prompt for the remote Claude

After the plan is hardened and pushed, give the human this to paste into the
remote session. Fill the two bracketed slots:

```
Implement the plan at `[repo-relative path to the plan .md]` on this repo.

Read it in full first, including the "Operating rules for the overnight worker"
section at the top — those rules are binding and override your defaults. Use the
superpowers:subagent-driven-development skill: one fresh subagent per task, with
the two-stage review the plan describes, working through the tasks in order.

Work on the branch the plan names. Do NOT merge to the main branch and do NOT
push — stop at the final hand-off step and report back: the verification numbers
(every suite + typecheck + build, with the known-green baseline noted) and the
list of commits on the branch. The human will device-test and integrate.

The accompanying spec is at `[repo-relative path to the spec .md]` for reference.
```

## Push checklist for the human

Hand these back as the last thing you do:

1. Review the hardened plan + spec one last time.
2. Push the current branch (spec + plan commits) so the remote Claude can see it:
   `git push` (or push the feature branch).
3. Open the remote session (claude.ai / cloud agent) **on this repo** and paste
   the kickoff prompt.
4. In the morning: pull the worker's branch, run the manual-verification steps
   from the spec on-device, then squash + merge + push if happy.

## Common mistakes

- **Leaving rules in CLAUDE.md instead of the plan.** The remote Claude may not
  load CLAUDE.md, and even if it does, the plan is what it executes. Inline the
  contract.
- **Summarising the baseline as "tests pass".** Name the exact known failures
  and how to confirm them on the main branch, or the worker will either panic or
  paper over a regression.
- **Forgetting the do-not-push instruction.** A capable remote Claude will
  happily merge to main. Repeat the prohibition in both the plan and the kickoff
  prompt.
- **Authoring the plan inside this skill.** That's superpowers:writing-plans.
  This skill starts from a finished plan.
