# ADR 0041: No maintenance branch for 0.5; Eidolon builds on its own branch

## Status

Superseded by [ADR 0042](0042-release-0.6-from-master-before-eidolon.md) (2026-11-21). Accepted (2026-11-18). An exception to [ADR 0039](0039-maintenance-branches-and-version-diary.md) for the 0.5 line only; the process is amended in [`obsidian/RELEASE-PROCESS.md`](../RELEASE-PROCESS.md).

## Context

0.5.0 is the last large release before the Eidolon integration, which may shape 1.0.0. Eidolon rebuilds Projects, memory, knowledge editing and the tool loop. Building it together will take two to three weeks of many merges.

Under ADR 0039, `master` would carry the next version (Eidolon) and `maintenance/0.5` the released one. For this one stretch that is the wrong way round. The long-lived, much-merged line is the new version, and the released line only gets the occasional fix or curated model.

## Decision

1. **No `maintenance/0.5`.** After `v0.5.0`, `master` carries the released line. 0.5.x patch releases are cut from `master`, and its `version.txt` says `0.5.1`.
2. **`master` takes only what a maintenance branch would take**, which is newly curated models and offerings, security fixes and fixes of faults in 0.5. No features.
3. **Eidolon builds on a long-lived `eidolon` branch**, created when the 0.5.0 work is finished (the Garage migration included). Fixes and models on `master` are merged into `eidolon` regularly, so it never drifts far.
4. **When Eidolon is ready**, `eidolon` is merged into `master` and the next minor is released from `master`. From then on, ADR 0039 holds again as written.

## Consequences

- No cherry-picks for 0.5.x. Forward-porting becomes a regular merge of `master` into `eidolon`.
- The rule from ADR 0039 that `master` is never in front of alpha users is unaffected. Releases still come only from tags.
- Until Eidolon lands, CLAUDE.md §8/§12 and the release process name `master` as the released line, not the next minor.
- `maintenance/0.4` stays as it is. It gets security fixes only for as long as the 0.4 diary says so.

## Alternatives considered

- **Follow ADR 0039 (cut `maintenance/0.5`, build Eidolon on `master`):** Eidolon would pass through two to three weeks of a `master` that does not run anywhere, which is fine, but every model for 0.5 users would need a cherry-pick across a fast-moving rebuild of the tool loop and memory. With the roles swapped, those conflicts happen in one regular merge instead.
