# Overnighter brief: Hardening OAuth grants for MCP

Hi, thank you for taking this one on! We are closing the three Low findings our security audit left on the new OAuth-for-MCP feature: a hostile or restored sync server must no longer be able to roll a sign-in back on a device that already knows a newer one, grant records get size padding, and the sign-in confirmation says when its details came through the user's own Chatsundere server. OAuth for MCP has just shipped and works beautifully on real devices; this keeps it as trustworthy as it is pleasant.

Nobody is available to answer questions during this run. That is intended: the spec has been reviewed by Chris, and everything after it is yours, from the plan to the pull request. The decision rules below tell you how to settle what the spec leaves open.

## What to read, in this order

1. This brief
2. Spec: `superpowers/specs/2026-11-10-mcp-oauth-hardening-design.md` (reviewed by Chris and by Laura, our UX auditor; do not change it)
3. For background, as the spec cites it: the parent spec `superpowers/specs/2026-11-02-mcp-oauth-design.md` (above all §5, the refresh serialisation, and §9, the user experience), ADR `obsidian/decisions/0038-oauth-for-mcp-connectors.md`, and the deferral entry "2026-11-03 — OAuth for MCP connectors" in `obsidian/insights/security-deferrals.md`

## Where you run

- Branch `feature/mcp-oauth-hardening`. The session starts on the default branch, so first run `git fetch origin feature/mcp-oauth-hardening && git checkout feature/mcp-oauth-hardening`. Everything you push to that branch survives, everything else does not
- The cloud environment may lack tools. Installing what you need (`mise`, bun, Node, pnpm 9, packages) is fine; please do it without asking and note it in the report
- Task 0 (setup plus first build and tests) should take about 15 minutes. If it takes much longer, something is off: note it and carry on if you can
- Toolchain: `.mise.toml` pins the versions. Install with `SHARP_IGNORE_GLOBAL_LIBVIPS=1 pnpm install --frozen-lockfile`, because a system `libvips` breaks `sharp`
- Docker test containers: not needed. Postgres and Redis are not needed for this work either (no backend change); if they happen to be available, running `auth-service` and `sync-service` with them is welcome but optional
- There are no real devices, no OAuth server and no provider keys here. The existing multi-device simulation in the user-client tests (each simulated device with its own `GrantStore`, against a fake sync server and the fake authorisation server from the OAuth work) is your counterpart. Chris runs the spec's §11 checks afterwards
- If superpowers skills are not available, please emulate them with the plain Agent tool and say so in the report

## Open points for the run

An independent review of spec and brief ran before the start. Its behaviour-changing findings are already settled in the spec (Chris, 2026-11-10). What is left is yours to **decide** with the rules below; log each choice:

1. **decide — acknowledgement mechanics.** `pushRecordDirect` (`apps/user-client/src/sync/worker.ts`, around `:775`) writes the pushed row wholesale on `ok`, device-local fields included. The simplest way to raise `seenGeneration` and clear `heldGeneration` in that same transaction is to put them into the pushed row (they are stripped before sealing); check that they really are stripped. The in-memory claimed row reused by the claim release and the `invalid_grant` push (`ensure-token.ts` around `:198`, `:232`) must carry the claim's generation, so those pushes become claim + 1.
2. **decide — where the hold is checked.** Spec §5.4 says every snapshot in the refresh loop, not only entry (`linkedFlow`, `ensure-token.ts` around `:276`), and after every adopt; otherwise the claim-conflict path adopts, is refused, loops and pushes a claim over the old revision.
3. **decide — status order.** Dead first, then held, then the rest (spec §5.4). Do not implement "not live" as `⚠ Sign in again`, or every paused grant would read as dead (`mcp/server-status.ts:26`, `components/mcp/OAuthConnectionPanel.tsx:23`).
4. **decide — query refresh.** `applyUpsert` only queues `QK.mcpOAuthGrants` when a row was applied (`sync/apply.ts` around `:906`); a refusal and a cleared hold must invalidate it too.
5. **decide — names.** `generation` already names the link generation inside `pushRecordDirect` and the drain (`worker.ts` around `:751`), and `held` is a local variable for scopes in `McpAuthNotice.tsx:36`. Rename locals as you see fit; the row field names in the spec stay. The spec's `ensureToken` means `ensureAccessToken` (`ensure-token.ts:380`).
6. **decide — anchors.** Line anchors in the spec are as of `fe8341e5` and may have drifted; trust the code. `sync/recovery.ts:563` and `sync/backfill.ts:131` are outbox push filters (they skip `pendingNewFamily` rows), not pull-apply paths; spec §5.2 "Outbox pushes" and §5.4 "Epoch recovery" say what they must do.
7. **decide — refused revision vs. epoch recovery.** Spec §5.3/§5.4 want the refused revision recorded with no repush, and the recovery repush to put the newer grant back and clear the hold on its acknowledgement. Make sure the echo shortcut in `applyUpsert` (around `apps/user-client/src/sync/apply.ts:810`) cannot swallow that acknowledgement, and that no outbox entry keeps conflicting afterwards.
8. **decide — fallback rule for metadata.** "Network error" for the protected resource metadata fallback is a `TypeError`, as in `getAs` (spec §6); the challenge-pointer path today catches every error, so align it.

## Planning

1. Write the plan with `superpowers:writing-plans` to `superpowers/plans/2026-11-10-mcp-oauth-hardening.md`.
2. It starts with **Task 0: baseline**: run the full suites before any change and record the exact counts and the exact failures, against the known state below.
   Known state on `master` at `fe8341e5`, measured 2026-11-10 on Chris's machine without Postgres or Redis:
   - `pnpm typecheck --force`: 14/14 tasks; `pnpm run build --force`: 9/9 tasks; `pnpm lint`: clean (1871 files)
   - `pnpm exec turbo run test --continue --force`: crypto 227 pass; llm-unified 509 pass; proxy-service 89 pass; shared-types 7; embeddings 68; ui-shared 78; admin-client 71; user-client 4292 passed, 1 failed of 4293 in 651 files
   - Known failures: `auth-service` aborts with `ECONNREFUSED ::1:5432` (no Postgres); `sync-service` 39 pass, 24 fail, 5 skip (environmental, no Postgres/Redis). In user-client one or two different tests fail per full run, each green alone; this run it was `tests/routes/app/settings-previews.test.tsx` ("shows a warning toast when the toggle cannot be saved"); also seen before: `sync/doorbell`, `projects/transaction-guard`. Confirm a suspected flake with `pnpm --filter @chatsundere/user-client exec vitest run <file>`
3. Every task stands alone: exact file paths (with line anchors where it modifies code), the exact command for each test step with the expected pass or fail, red test, green, then mutations. No placeholders, no "see above", no "similar to Task N".
4. Suggested order, yours to change: L4 padding (smallest, crypto); then L2 in layers (data fields and strip defaults; the shared refusal function; writing the generation on every push kind; each read path of spec §5.3; `held` in `ensureToken`; link reset; the liveness helper and the three UI surfaces plus model wording and *Test connection*); then L3 (discovery, `viaProxy`, the confirmation line); then docs; then the audits; then the report.
5. The final task repeats: do not merge.
6. Have the plan reviewed by a fresh subagent that gets the spec, this brief and the plan, not your conclusions. Fold in the findings, then commit the plan.

## How to work

- Task by task as in the plan: red test, green, then every mutation individually (first `git add` your work, because `git checkout -- <file>` restores from the index and would otherwise wipe it; then break, watch it fail, restore)
- Subagent-driven (`superpowers:subagent-driven-development`): one fresh subagent per task, then a spec-compliance review and a code-quality review. Subagents never merge, push or switch branches, and they leave their work uncommitted; you commit and push. Please verify each commit landed on `feature/mcp-oauth-hardening` (`git branch --contains HEAD`)
- Commit and push after every task. Commit messages are free-form imperative with a capitalised subject and no Conventional Commits prefix. End each one with `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`; the commit author is Claude, which is intended. Commits touching only text (Markdown, docs) get ` [skip ci]` at the end of the subject, exactly in that form with the space; mixed commits do not
- Full verification at the end of each phase and at the end: `pnpm exec turbo run test --continue` (plain `pnpm test` stops at the first failing package), `pnpm typecheck` (the CI gate), `pnpm run build`, `pnpm lint`. All four count; `tsc --noEmit` alone does not, it diverges from the build
- Frontend tests are Vitest (`apps/user-client`); `packages/crypto` uses Bun's test runner (`pnpm --filter @chatsundere/crypto test`)
- All text in the repository is British English, including code, comments, identifiers, commit messages, log strings and user-facing copy. The copy in the spec is final; use it verbatim. New files under `apps/` start with `// SPDX-License-Identifier: AGPL-3.0-only`, under `packages/crypto/` with `// SPDX-License-Identifier: LGPL-3.0-only`. TypeScript is strict with `noUncheckedIndexedAccess`; no `any` without an inline comment saying why. Package-public functions carry a one-line JSDoc. Comments explain why, never what. Biome is the linter
- UI rules: mobile-first at 380 px; no drag-and-drop; show a capability disabled with a reason rather than hiding it

## Deciding without Chris

When the spec leaves something open, or something unforeseen comes up, choose the option that satisfies these, in this order:

1. **Breaks nothing.** Existing behaviour, data and interfaces keep working; prefer the reversible change. Above all: never a path that presents a refresh token the device did not win, and never one that discards tokens it may be the only holder of (parent spec §5).
2. **True to the spirit of the application.** Follow its existing patterns, style and architecture; no new dependencies.
3. **Opens no new security hole.** Never weaken authentication, authorisation, validation or secret handling; the server stays zero-knowledge.
4. **True to the spec.**

If a question can only be answered by changing the spec's scope, do not guess: leave that part out and record it in `superpowers/open-items.md`.

Log every decision you made this way. Put it in the report and in the PR description under **Decisions made without Chris**, each with the options you saw and why you chose this one.

## A few things that matter to us

- Please do not merge or deploy, do not squash or tag, and leave `master` and devices alone: Chris device-tests first, then Liz squashes and tags v0.3.6
- No secrets in logs, assertions or the report. Tokens, codes and verifiers never appear in `console.*` or error messages, not even in tests' failure output
- The backend must never be able to read a token at rest. If you find you need server logic, stop and write that down rather than adding it: the design rests on the sync server staying ignorant
- Specs outside this topic stay as they are, apart from the documentation edits the spec's §9 asks for (including the one line in the parent spec's §5 "Accepted failure modes"); if one looks wrong, mention it in the report
- **Security boundary.** The review paths are `apps/auth-service/**`, `apps/sync-service/**`, `apps/proxy-service/**` and `packages/crypto/**`. **This work touches `packages/crypto/**`** (one set entry); `apps/user-client/src/sync/**` and `apps/user-client/src/mcp/oauth/**` carry the grant's security logic and are in the audit's scope too. `apps/auth-service/**`, `apps/sync-service/**`, `apps/proxy-service/**` and `packages/shared-types/**` are **not touched**. So before your final commit, please run a **Larissa-style security audit**: a fresh subagent acting as a strict security auditor, given the diff against `master`, the spec, the parent spec §5 and ADR 0038, asked for findings by severity (Critical/High/Medium/Low). Fix what it finds; Critical and High cannot be deferred without Chris, so if one remains, say so prominently in the report and the PR. Ask it specifically to rate the residual in spec §5.7. List all findings and what you did with each in the report
- **UX audit.** The new status, notice and confirmation texts touch user-reachable flows, so also run a **Laura-style pre-squash UX pass**: a fresh subagent given `.claude/agents/laura.md` as its rubric, the spec's §3, §5.4–§5.6 and §6, and the diff, asked to check that the built flow honours the spec. Hard defects block like a security High; soft findings go into the report for Chris
- **At the end:** propose the changes for `obsidian/STATUS-CLIENT-ONLY.md` in your report rather than editing it; the STATUS commit follows the squash. The documentation edits of spec §9 (`security-deferrals.md`, `follow-ups-index.md`, ADR 0038 addendum, parent spec §5 line, help text) are yours to make on the branch

## Out of scope

- Everything in spec §10: fresh-device rollback protection, the timing channel, binding `rev` or a device id into the seal, any server, proxy or wire-type change, the sign-in code relay, a manual client-ID field
- A dev-only switch to force a paused state; Chris tests it on a dev stack (spec §11 step 5)
- Tagging or releasing v0.3.6, `version.txt`, release notes

## The report

Last commit: `superpowers/overnighter/2026-11-10-mcp-oauth-hardening-overnighter-report.md` (with ` [skip ci]`). It contains:
- the environment
- the plan review findings and what you did with them
- Task 0 planned vs. measured
- for each task the commit and the real test output
- every mutation individually
- the security and UX audit findings and what you did with each
- the decisions made without Chris
- deviations, surprises and open points for Chris
- the proposed STATUS changes
- the PR link

Before that commit, push and open a **draft** PR to `master`, do not merge it, and add its link to `superpowers/open-items.md` in the report commit.

## When you are done or stuck

Send a short message via `PushNotification` if it is available; otherwise the PR is the signal and the report says so. If you get stuck, push what you have, write down in the report where and why, and stop there. A clear account of being stuck is worth more than a guess. Uncertainty is allowed: if something in the spec turns out to be wrong against the code, take the choice closest to its intent and flag it.
