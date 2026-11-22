# ADR 0042: 0.6.0 is released from `master` before Eidolon; `maintenance/0.5` after all

## Status

Accepted (2026-11-21, Chris). Supersedes [ADR 0041](0041-no-maintenance-branch-for-0.5.md); [ADR 0039](0039-maintenance-branches-and-version-diary.md) holds again as written.

## Context

ADR 0041 swapped the roles of the branches because Eidolon was expected to start straight after 0.5.0 and to rebuild Projects, memory, knowledge editing and the tool loop on its own branch. Two things changed:

- Eidolon has to be extracted first, as part of the Kumbu² work. That is planned for late December 2026 or early January 2027, not now.
- Users who got ElevenLabs TTS/STT in 0.5.0 now ask for audio and video from MCP tools in the chat. That is a feature, so under ADR 0041 it could only ship with Eidolon, months away.

## Decision

1. **0.6.0 is the next minor and is built and released from `master`.** Features land on `master` again; the multimedia MCP support (spec `superpowers/specs/2026-11-21-mcp-media-playback-design.md`) is its first unit.
2. **`maintenance/0.5` is cut from `master` at the cut-over**, before the first 0.6 feature merges, carrying `version.txt` `0.5.1`. 0.5.x fixes and curated models go there first and are cherry-picked to `master` the same day, as ADR 0039 describes.
3. **At the cut-over, `version.txt` on `master` becomes `0.6.0`.**
4. **No `eidolon` branch for now.** When the Eidolon work starts, its branching is decided then; the default is ADR 0039 (it builds on `master` as the next minor after 0.6).

## Consequences

- CLAUDE.md §8/§12 and `RELEASE-PROCESS.md` drop the 0.5 exception.
- The open 0.5.0 device tests and the read-aloud listening check now feed `maintenance/0.5`, not `master`.
- `maintenance/0.4` is unaffected.

## Alternatives considered

- **Keep ADR 0041 and ship media with Eidolon:** leaves users waiting until 2027 for something that does not touch what Eidolon rebuilds.
- **Ship media as a 0.5.x:** a feature on a maintenance line breaks the rule that a maintenance release carries only models and fixes.
