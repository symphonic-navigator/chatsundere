# Overnighter brief: OAuth for MCP connectors

Hi, thank you for taking this one on! We are making Chatsundere an OAuth client for MCP servers, so that someone can paste a server link, sign in, and have the connection work on all their devices. It matters because most hosted MCP servers worth connecting to expect OAuth, and our zero-knowledge promise has to hold while we do it.

## What to read, in this order

1. This brief
2. Spec: `superpowers/specs/2026-11-02-mcp-oauth-design.md`
3. Plan: `superpowers/plans/2026-11-02-mcp-oauth.md`; start with Task 0

## Where you run

- Branch `feature/mcp-oauth`; everything you push there survives, everything else does not
- The cloud environment may lack tools. Installing what you need (`mise`, bun, Node 20, pnpm 9, packages) is fine; please do it without asking and note it in the report
- Task 0 (setup plus first build and tests) should take about 15 minutes. If it takes much longer, something is off: note it and carry on if you can
- Toolchain: `.mise.toml` pins bun latest, Node 20 and pnpm 9. Install with `SHARP_IGNORE_GLOBAL_LIBVIPS=1 pnpm install --frozen-lockfile`, because a system `libvips` breaks `sharp`
- Docker test containers: not needed for the plan. If Docker happens to be there, use it for `nginx -t` in Task 7. Suites needing Postgres or Redis may not run; say which ones did not
- There is no Kumbu² instance and there are no real devices or provider keys here. The fake authorisation server in the plan's Task 3 is your counterpart, and it copies Kumbu²'s revocation rules on purpose. Chris runs the real checks of spec §13 afterwards
- If superpowers skills are not available, please emulate subagent-driven development with the plain Agent tool

## How to work

- Task by task as in the plan: red test, green, then every mutation individually (first `git add` your work, because `git checkout -- <file>` restores from the index and would otherwise wipe it; then break, watch it fail, restore)
- Subagent-driven: one fresh subagent per task, then a spec-compliance review and a code-quality review. Subagents never merge, push or switch branches, and they leave their work uncommitted; you commit and push. Please verify each commit landed on `feature/mcp-oauth` (`git branch --contains`)
- Commit and push after every task; commit messages are free-form imperative with a capitalised subject and no Conventional Commits prefix, ending with `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Commits touching only text get `[skip ci]` at the end of the subject
- Full verification at the end of each phase (the gate steps in Tasks 5, 9 and 11, and in Task 13): `pnpm exec turbo run test --continue` (plain `pnpm test` stops at the first failing package), `pnpm typecheck`, `pnpm run build`, `pnpm lint`. All of them count; `tsc --noEmit` alone does not. Known failures before you start: without Postgres and Redis, `sync-service` has 24 environmental failures (39 pass) and `auth-service` aborts with `ECONNREFUSED`. The user-client suite also fails one or two different tests per full run, each green alone (seen: `sync/doorbell`, `routes/app/settings-previews`, `projects/transaction-guard`). Exact counts are in the plan's Task 0
- Only those commands count as evidence
- All text in the repository is British English, including code, comments, identifiers, commit messages, log strings and user-facing copy. New files under `apps/` start with `// SPDX-License-Identifier: AGPL-3.0-only`. TypeScript is strict, with `noUncheckedIndexedAccess`; no `any` without an inline comment saying why. Package-public functions have a one-line JSDoc. Comments explain why, never what. Biome is the linter (`pnpm lint`)
- UI rules: mobile-first at 380 px; no drag-and-drop; show a capability disabled with a reason rather than hiding it

## A few things that matter to us

- Please do not merge or deploy, do not squash or tag, and leave `master` and devices alone: rollout is something Chris does himself after his device test
- No secrets in logs, assertions or the report. Tokens, codes and verifiers never appear in `console.*` or error messages, not even in tests' failure output
- The backend must never be able to read a token at rest. If you find you need new server logic for the claim model, stop and write that down rather than adding it: the design rests on the sync server's existing compare-and-set
- Specs outside this topic stay as they are, apart from the one note in the plan's Task 12; if one looks wrong, mention it in the report
- Security boundary: the review paths are `apps/auth-service/**`, `apps/sync-service/**`, `apps/proxy-service/**` and `packages/crypto/**`. **This work touches `apps/proxy-service/**`** and adds a collection the sync service accepts through `packages/shared-types`; `apps/auth-service/**`, `packages/crypto/**` and the source of `apps/sync-service/**` are not touched. So please run the Larissa-style audit of the plan's Task 13 before your final commit and list the findings in the report. Critical and high findings cannot be deferred without Chris
- At the end: propose the changes for `obsidian/STATUS-CLIENT-ONLY.md` and `obsidian/STATUS-BACKEND.md` in your report rather than editing them. The STATUS commit follows Chris's squash

## Out of scope

- A relay for the sign-in code, or a short typed code
- A manual client ID field
- Per-tool "Allow always"; it stays per server
- MCP protocol `2026-07-28`
- The agentic loop spec and the deferrals M2, L2, L-http and L4 of 2026-11-02
- Any new endpoint or logic in the sync service, the auth service or the proxy beyond the exposed headers

## The report

First push and open a **draft** PR to `master` (not merged). Then the last commit: `superpowers/overnighter/2026-11-02-mcp-oauth-overnighter-report.md` with environment, Task 0 planned vs. measured, per task the commit and real test output, every mutation individually, deviations, surprises, open points for Chris and the PR link, adding that link to `superpowers/open-items.md` in the same commit.

## When you are done or stuck

Send a short message via `PushNotification` if it is available; otherwise the PR is the signal and the report says so. If you get stuck, push what you have, write down in the report where and why, and stop there. A clear account of being stuck is worth more than a guess. Uncertainty is allowed: if something in the spec turns out to be wrong against the code, take the choice closest to its intent and flag it.
