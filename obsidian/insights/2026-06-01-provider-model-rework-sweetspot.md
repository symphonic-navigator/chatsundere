# 2026-06-01 — Provider/model rework: the multi-upstream sweet spot

Squashed to `9362ad7`. What we achieved, and why it matters beyond the diff.

## What landed

The provider/model selection UX, straightened into a single **derivable** system:

- **Modality is data, not declaration.** `ServiceKind` ('llm'|'web'|'tts'|'stt'|'tti', no EMB) lives on the `Offering`. Provider caps, the "What you have" summary, model availability, badges, and the "Add X to unlock Y" tooltips are all *computed* from curated offerings. One source of truth.
- **The user only sees what works.** Configured-only provider list and model picker; proxy-providers gated behind a configured global CORS proxy (transitional, alpha-only); a warm empty state; the add-picker excludes what's already added.
- **Every dead end has a next step** (the *dere* half): proxy shortcut, gap→next-step tooltips, "Currently unavailable" persona-model row, post-probe "LLM unlocked" flash, EU/TEE/ZDR + Tools/Vision badges.
- Single `lib/usable-providers.ts` ("usable" = enabled + working route) backs both summary and availability — no drift.

## The strategic point (Chris, 2026-06-01)

> "das ist es, was wir hätten von anfang an tun sollen... und jetzt siehst auch, warum ich unbedingt dieses 'wir kuratieren jedes Modell' haben wollte!"

This is the payoff of the **curate-every-model** stance. Because every offering is curated, each carries its real measured properties — so the UI can derive everything instead of guessing or declaring. A bulk-import "Krämerladen" would have made this clean UX *impossible*: you'd be stuck showing raw untested lists (anti-Deredere) or guessing at runtime. The curation price is paid up front so the user never sees it. Captured as memory [[project_curation_enables_clean_ux]]; the "Quality 10 over 100" lesson, vindicated in practice.

## Process honesty

The implementation itself went badly: a *batched* subagent dispatch raced on the shared `master` tree (HEAD churn, a dropped-then-reflog-recovered Task-1 commit, a duplicated commit). Content landed correct and green, but the path was wasteful. Lesson recorded as [[feedback_serial_subagent_dispatch]]: one implementer per turn, never batch onto a shared tree. Reviewing the squash before committing is itself the safety net — it's where stray artefacts get caught.

## Verification

`pnpm typecheck` 13/13 · llm-unified `bun test` 213/0 · user-client build clean. Awaiting Chris's device test of the 7 manual steps (spec §12) before push.

## Next

Tomorrow: usability polish Chris spotted while using the chat. Then: work the [[ROADMAP]] (move/Umzug context, then roadmap items). A future memory feature will use Chris's two-phase-commit rule for sync-critical edits — [[project_sync_critical_edits_two_phase_commit]].
