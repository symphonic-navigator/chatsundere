# Open items

Work that waits for the maintainer: pull requests from unattended runs, reviews, hand checks.

| Date | Item | Link |
|---|---|---|
| 2026-11-03 | MCP OAuth connectors: draft PR awaiting Chris's device test (spec §13, 16 steps plus the 380 px overlay check) and squash; deferrals L2, L4, S1, S4, S7, S11 need sign-off; report: `superpowers/overnighter/2026-11-02-mcp-oauth-overnighter-report.md` | https://github.com/symphonic-navigator/chatsundere/pull/34 |
| 2026-11-10 | MCP OAuth grant hardening (v0.3.6): draft PR awaiting Chris's device test (spec §11, steps 1–5) and squash; residuals R1–R5 in `security-deferrals.md` (2026-11-10) and the §5.4 display-liveness deviation need sign-off; report: `superpowers/overnighter/2026-11-10-mcp-oauth-hardening-overnighter-report.md` | https://github.com/symphonic-navigator/chatsundere/pull/36 |
| 2026-11-18 | 0.5.0: all units are on `master` (merged at Chris's request before his device tests). Owed before the tag, each from its spec's "Manual verification": chat search (§14, steps 1–26); time, export, motion (9 + 8 + 7 steps, plus the imitation probe for the `<sent>` stamps with his keys via `/curate`, and the Android share-sheet check); papercuts (19 steps, some need a prepared state); voice and thumb pass (19 steps; step 15, the A/B listening check, decides whether the bridge ships); passkey fix (§9, 8 steps, a real passkey; step 7 is a linked account syncing after a passkey-only cold start); Back (by layer and device; step 21 on the installed iPhone app); MCP connector (§12, 16 steps; step 14 first after deploying: every existing MCP server still tests and answers). Then the Garage migration, guided. | https://github.com/symphonic-navigator/chatsundere/pulls?q=is%3Apr+is%3Amerged+merged%3A2026-11-18 |
