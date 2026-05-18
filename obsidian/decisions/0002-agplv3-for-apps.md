# ADR 0002: AGPLv3 for apps, LGPLv3 for libraries, MIT for shared types

**Date:** 2026-05-18
**Status:** Accepted

## Context

Chatsundere is a privacy-and-user-trust product. Operators who deploy it as a service should be obligated to share their modifications with the community. GPLv3 leaves the well-known "network use" loophole: a hosted SaaS fork can ship changes without ever distributing modified source. That loophole is incompatible with the trust posture Chatsundere asks users to grant the operator.

Chris's global default for OSS projects is GPLv3. This is a deliberate, project-specific divergence.

## Decision

- All `apps/*` → **AGPLv3**. The network-use clause is load-bearing: operators must publish their source.
- `packages/crypto`, `packages/llm-unified` → **LGPLv3**. Reusable in other projects; improvements must come back.
- `packages/shared-types` → **MIT**. Just type definitions; trivially reusable.

Each package gets a `LICENSE` file. SPDX-License-Identifier headers on source files where reasonable.

## Consequences

Positive:
- Anti-drift: operators cannot silently bolt on telemetry, ad injection, content scanning, or other features that betray the user-trust posture without exposing the change.
- Transparency by construction: users have a legal lever to demand the actual source running against them.
- LGPLv3 keeps crypto and provider adapters reusable in other privacy projects without infecting their licence.

Negative / accepted trade-offs:
- Commercial vendors may decline to fork because of AGPLv3 obligations. This is the desired filter, not a bug.
- More licence-file plumbing across the monorepo than a single-licence setup.

## References

- `obsidian/briefs/phase 0/project-setup.md` (Licensing section)
- Memory: `project_licence_philosophy`
- Diverges from `~/.claude/CLAUDE.md` default (GPLv3) — deliberate, for this project only.
