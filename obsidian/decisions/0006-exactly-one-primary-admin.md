# ADR 0006: Exactly one primary admin per system

**Date:** 2026-05-18
**Status:** Accepted

## Context

Chatsundere needs an administrative role hierarchy. Three shapes were considered:

- Multiple equal `admin` accounts with no hierarchy among them.
- A "founders council" — a set of role-holders with equal elevated privileges.
- Exactly one `primary_admin`, plus zero or more `admin` accounts below them.

A flat-admin model risks "deadlock" decisions (who can demote a misbehaving admin?). A founders-council model adds quorum logic, transfer ceremonies, and edge cases we do not need at this stage of the project.

## Decision

Exactly one `primary_admin` exists in the system at any time, enforced by a partial unique index:

```sql
CREATE UNIQUE INDEX users_one_primary_admin
  ON users (role) WHERE role = 'primary_admin';
```

`primary_admin` is the only role that can:

- Demote or promote other `admin` accounts to/from `admin`.
- Transfer the `primary_admin` role to another `admin` (atomic operation, ADR-worthy if shape evolves).
- Be demoted only by transferring the role first.

Other `admin` accounts can:

- Create / revoke invitations.
- Suspend / unsuspend users.
- List users.

A "founders council" or quorum model is explicitly deferred — not rejected forever, but not on the roadmap.

## Consequences

Positive:
- Clear chain of authority. No deadlocks.
- Simple, enforceable as a DB invariant.
- Easy to reason about in audit logs.

Negative / accepted trade-offs:
- Single point of administrative failure: if the `primary_admin` loses access and has no recovery method, the system has no admin. Mitigated by recovery key + recommended practice of having at least one peer `admin` who can be transferred to.
- No quorum-style protections against a rogue `primary_admin`. Acceptable for the trust model of a self-hosted instance.

## References

- `obsidian/briefs/phase 0/auth-service.md` (User Roles, primary_admin transfer)
