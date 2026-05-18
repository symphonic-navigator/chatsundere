# Decisions — Architecture Decision Records

Each file here records a single decision at the time it was made. Format follows a lightweight Michael Nygard ADR style.

## Format

```markdown
# ADR NNNN: Title

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Superseded by ADR NNNN | Deprecated

## Context
The forces at play, the problem, the constraints.

## Decision
What we chose, in one or two sentences. Imperative voice.

## Consequences
- Positive consequences
- Negative or neutral consequences
- Trade-offs accepted

## References
- Briefs, memories, prior discussions.
```

## Numbering

Sequential, global, four-digit zero-padded: `0001-…`, `0002-…`, etc. No topic prefixes. The number is permanent; if a decision is reversed, supersede via the `Status` field, do not renumber.

## When to write one

When the decision is:

- Architectural (touches more than one component, or hard to reverse).
- Non-obvious (the reasoning would be forgotten in three weeks).
- Politically loaded (licence, privacy posture, security trade-offs).

For small, contained decisions (a variable name, a layout choice), a code comment or an entry in `obsidian/insights/` is enough.

## Index

- [0001](0001-postgres-over-mongodb.md) — PostgreSQL over MongoDB
- [0002](0002-agplv3-for-apps.md) — AGPLv3 for apps, LGPLv3 for libraries, MIT for shared types
- [0003](0003-squash-per-feature.md) — One squashed commit per feature unit
- [0004](0004-bootstrap-cli-not-env.md) — Bootstrap primary admin via CLI, not env-triggered auto-create
- [0005](0005-require-prf-for-passkey-mk-wrapping.md) — Require WebAuthn PRF for passkey-based MK wrapping
- [0006](0006-exactly-one-primary-admin.md) — Exactly one primary admin per system
- [0007](0007-recovery-key-required-at-registration.md) — Recovery key generated and shown once at registration
