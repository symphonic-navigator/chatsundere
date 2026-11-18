# Release process

How Chatsundere is versioned and released, from [ADR 0039](decisions/0039-maintenance-branches-and-version-diary.md). SemVer; tags are annotated, `vX.Y.Z`.

## Branches

| Branch | What it is | Where it runs |
|---|---|---|
| `master` | the next minor release (from `v0.5.0` until Eidolon: the released 0.5 line, see the exception below) | locally and on staging |
| `maintenance/X.Y` | the maintenance line of a released minor version (the latest: `maintenance/0.4`, cut from `v0.4.0`) | in production, through its tags |

`version.txt` holds the version a branch is preparing: `0.5.0` on `master`, `0.4.1` on `maintenance/0.4`. Untagged builds are `<version.txt>-pre.<run>`.

## Exception: the 0.5 line ([ADR 0041](decisions/0041-no-maintenance-branch-for-0.5.md))

From `v0.5.0` until Eidolon lands, the roles are swapped. There is no `maintenance/0.5`. `master` carries the released 0.5.x (`version.txt` `0.5.1` after the tag) and takes only what this page sends to a maintenance branch: curated models and offerings, security fixes, fixes of faults in 0.5. Patch releases are tagged on `master` with the steps of a maintenance release, minus the forward port. The next version builds on a long-lived `eidolon` branch, created once the 0.5.0 work is finished. `master` is merged into it regularly. When Eidolon is ready, it is merged into `master`, the next minor is released from there, and the table below holds again.

## What goes where

| Change | Branch first | Then |
|---|---|---|
| Newly curated model or offering | `maintenance/X.Y` | cherry-pick to `master`, same day |
| Security fix for the released version | `maintenance/X.Y` | cherry-pick to `master`, same day |
| Fix of a fault in the released version | `maintenance/X.Y` | cherry-pick to `master`, same day |
| Feature, UI change, refactor, anything else | `master` | — |
| CI and workflow changes | `master` | cherry-pick to `maintenance/X.Y` (a tag builds with its own commit's workflows) |

When unsure whether something is a fix or a feature, it's a feature.

## Forward-porting

1. The change is merged into `maintenance/X.Y` (a pull request, squash merge).
2. The same day: a branch from `master`, `git cherry-pick -x <squash commit>`, a pull request "Forward-port: <subject>" to `master`. The `-x` line records where it came from.
3. A conflict is resolved on the `master` side to the same outcome. For a model, run the curation suites (the `/curate` skill) on both branches.
4. No maintenance tag while a forward port is missing: open or merged, but there.

## The version diary

Per version a note in Kumbu²: `/SWE/Chatsundere/Versions/<version>.md` (`0.4.1.md` for the maintenance line, `0.5.0.md` for `master`). Each merged pull request adds one entry, from the users' side, with its number, under **New**, **Better**, **Fixed** or **Behind the scenes** (CI, tests, docs: not in the release notes). A forward-ported change gets an entry in both diaries. Write the entry when the pull request is merged, not at release time.

## Releasing a maintenance version (`vX.Y.Z` on `maintenance/X.Y`)

1. Check: every change since the last tag has its forward port, and the diary `X.Y.Z.md` is complete.
2. On a branch from `maintenance/X.Y`: write the version's section at the top of `CHANGELOG.md` from the diary (**New**, **Better**, **Fixed**, leaving out Behind the scenes), check `version.txt` says `X.Y.Z`. Pull request "Release vX.Y.Z", squash merge once CI is green. This commit carries `version.txt`'s state, so it is never `[skip ci]`.
3. Tag the merge commit: `git tag -a vX.Y.Z -m "Chatsundere X.Y.Z"`, `git push origin vX.Y.Z`. The tag's image build is the release; `:latest` moves only if it is the highest stable version.
4. Bump `version.txt` on `maintenance/X.Y` to `X.Y.(Z+1)`.
5. Forward-port the `CHANGELOG.md` section to `master`.
6. The STATUS commit (CLAUDE.md §16) comes after the tag, never under it.

## Releasing a minor version (`vX.Y.0` from `master`)

1. The diary `X.Y.0.md` is complete; `version.txt` on `master` says `X.Y.0`.
2. As step 2 above, on a branch from `master`; squash merge; tag the merge commit `vX.Y.0`.
3. Cut the new maintenance line from the tag: `git branch maintenance/X.Y vX.Y.0`, `git push origin maintenance/X.Y`, and set its `version.txt` to `X.Y.1`.
4. Set `master`'s `version.txt` to the next minor, `X.(Y+1).0`.
5. The old maintenance line `maintenance/X.(Y-1)` gets security fixes only for as long as we say so in its diary; then it's left as it is.

## The artefacts

| Artefact | Built from | Moves when |
|---|---|---|
| `:latest`, `:<major>` images | the highest stable tag | a tag above every other stable tag is pushed |
| `:X.Y`, `:X.Y.Z` images | that tag | its tag is pushed |
| `:master`, `:release-X.Y`, `:sha-…` images | the branch | every push |
| The alpha PWA (`/alpha/` on Pages) | the highest stable tag | a tag is pushed, or anything deploys Pages |
| The teaser site (Pages root) | `master` | every push to `master` |
