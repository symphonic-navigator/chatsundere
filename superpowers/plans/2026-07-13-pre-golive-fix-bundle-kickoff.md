# Kickoff — Pre-Go-Live Fix Bundle (paste into the fresh session)

> For Chris: open a fresh Claude Code session (Opus 4.8) in this repo and paste the block below verbatim. Everything the session needs is in the plan/spec; it has no other context.

---

Implement the plan at `superpowers/plans/2026-07-13-pre-golive-fix-bundle.md` on this repo.

Read it in full first, including the "Operating rules for the executing session" section at the top — those rules are binding and override your defaults. Use the superpowers:subagent-driven-development skill: one fresh subagent per task, with the per-task spec + quality reviews the plan describes, working through the tasks in order (Units A → F).

Work on a feature branch in a dedicated worktree under `.claude/worktrees/` as the operating rules describe; the main tree stays on `master`. Squash one commit per unit to `master` per rule 8, but do NOT `git push` — Chris pushes after his device verification. Summon Larissa (security) and Laura (UX) at the gates the plan names, with absolute worktree paths.

Stop at the plan's "Final integration" section and report back to Chris (in German, per CLAUDE.md): the verification numbers for every suite + typecheck + build with the known-green baseline noted, the six squash SHAs, and any deviations the plan's "investigate first" steps forced.

The accompanying spec is at `superpowers/specs/2026-07-13-pre-golive-fix-bundle-design.md` — it is the contract the reviews check against; Laura's spec-pass findings are already folded into it.

STOP-guard before you start: `superpowers/specs/2026-07-13-pre-golive-fix-bundle-design.md` and the plan both exist on `master`, and `apps/user-client/src/routes/join.tsx` does NOT exist yet. If any of that is false, stop and ask Chris.

---

## Afterwards (Chris, on device — spec §9)

1. Fresh invitation + pairing code on the staged stack → scan each with the **system camera** and with the **in-app scanner** → `/join` chooser → flow completes. *(Closes F7's "one live scan".)*
2. Onboarding recovery: mistyped key → inline error, input preserved; unknown username → named message. Flow R: wrong key → "Re-enter recovery key" works.
3. Requires-proxy provider without account link: send → footer shows the constructive message, "Open Server linking" navigates.
4. Fresh empty linked account shows "Synced", not eternal "Pulling…". Document mass-delete on device 1 → device 2 converges without an "items removed" alarm or visible hang.
5. **Non-code checklist item:** one real xAI or wafer send through the proxy with a real key (the never-recorded device probe).
6. Happy? → `git push` (master carries the six squashes + spec/plan).
