# ADR 0004: Bootstrap primary admin via CLI, not environment-triggered auto-create

**Date:** 2026-05-18
**Status:** Accepted

## Context

A fresh Chatsundere deployment has zero users. Someone has to become the first `primary_admin`. Two candidate mechanisms were considered:

- **Option A — env-triggered.** If `AUTH_BOOTSTRAP_INVITATION=true` and no users exist, the service auto-creates an invitation at startup and prints the QR payload to its logs. Operator scans, registers, then unsets the env var.
- **Option B — explicit CLI command.** `bun run bootstrap-admin` creates the invitation, prints the QR payload, and exits. Only works while no `primary_admin` exists.

Option A has a magic-env failure mode: if an operator forgets to unset the var, every restart of an empty deployment prints another bootstrap invitation, potentially in shared logs.

## Decision

**Option B.** Bootstrap via an explicit `bun run bootstrap-admin` CLI command in `apps/auth-service`. Refuses to run if any `primary_admin` already exists. Prints the QR payload to stdout (not to the service logs).

## Consequences

Positive:
- No magic environment behaviour. Operator action is explicit and one-shot.
- Bootstrap secret never lands in long-lived service logs.
- Behaviour is trivially testable as a CLI integration test.

Negative / accepted trade-offs:
- Operator has one more thing to run during initial deployment. Documented in `docs/DEPLOYMENT.md` when it exists.
- Slightly more code (a CLI entry point) than reusing the existing HTTP code path.

## References

- `obsidian/briefs/phase 0/auth-service.md` (Bootstrap section)
