# ADR 0039: Maintenance branches, forward-ported models and a version diary

## Status

Accepted (2026-11-10). Replaces the interim rules of CLAUDE.md §12 ("Until v0.1.0 we do not cut versions", "format will be locked in when we hit v0.1.0"). The process itself is in [`obsidian/RELEASE-PROCESS.md`](../RELEASE-PROCESS.md).

## Context

Releases have been cut from `master` whenever something wanted out. A new curated model (Claude Fable 5.2 on nano-gpt, v0.3.5) became the occasion to ship whatever else sat on `master` at the time. Chris, on 2026-11-10: "ui geil, neues modell, ich mach schnell release und klatsch halt ein paar features mit rein". Nothing separated what a release *had* to contain from what merely happened to be ready.

Three things made this worse than it looks:

- Every push to `master` also redeployed the alpha PWA on GitHub Pages, so `master` *was* production for alpha users.
- Every `v*.*.*` tag moved `:latest`, which WUD follows, so a lower tag pushed after a higher one would have rolled deployments back.
- There were no release notes, and no record of what went into a version until someone read the git log.

Kumbu² (a sibling project) has run on a stricter model for several releases: targeted releases, a per-version diary, release notes built from it, no ad hoc content. Chris wants Chatsundere at the same level.

## Decision

1. **`master` is the next minor release.** It runs locally and on staging, never in front of alpha users.
2. **`release/X.Y` is the maintenance branch of the released minor version**, cut from its first tag (`release/0.3` from `v0.3.5`, the first release under this ADR). Patch releases `vX.Y.Z` are tagged there.
3. **A maintenance release carries only:** newly curated models and offerings, security fixes, and fixes of faults in the released version. No new features, no UI reshaping, no refactors.
4. **Curated models are forward-ported.** They land on `release/X.Y` first, so the version people use gets them at once, and are cherry-picked (`git cherry-pick -x`) to `master` the same day. No maintenance tag without its forward port open or merged. The same holds for security and bug fixes made on the maintenance branch.
5. **Only the highest stable release moves `:latest`** (and the major tag). `:X.Y` follows its maintenance line.
6. **The alpha PWA is a release artefact.** Pages builds it from the highest stable tag; the teaser site (`docs/`) still follows `master`, as a second artefact with its own path to an update.
7. **A version diary per version**, kept in Kumbu² (`/SWE/Chatsundere/Versions/<version>.md`), one entry per merged change from the users' side. The release notes (`CHANGELOG.md`) are written from it at release time.

## Consequences

- A release is a decision about content, not a side effect of `master`'s state.
- Users of the current version get new models within a day, without waiting for the next minor release.
- Forward-porting is work, and the further `master` drifts from `release/X.Y` in `packages/llm-unified/src/catalogue/` and `src/providers/`, the more a cherry-pick conflicts. The same-day rule keeps the drift small; a conflict is resolved on `master` to the same outcome, and the curation suites run on both branches.
- The diary lives outside the repository on purpose: a file in the repo would exist on two branches and conflict at every forward port.
- Workflow changes have to reach `release/X.Y` too, since a tag builds with the workflow of the commit it points at.

## Alternatives considered

- **Upstream first** (fix on `master`, backport to `release/X.Y`): the usual order, and safer against forgotten ports. Rejected for models, because a curated model then waits on `master`'s review and test cycle before users see it. Kept as an option for large fixes where the `master` version is the one to design first.
- **No maintenance branches, release `master` more often:** keeps one line, but every model release would again carry whatever `master` holds.
- **Diary in `obsidian/releases/`:** fits "longer docs live in `obsidian/`", but conflicts across branches (see Consequences).
