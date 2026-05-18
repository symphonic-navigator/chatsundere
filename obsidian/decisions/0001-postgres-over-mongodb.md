# ADR 0001: PostgreSQL over MongoDB

**Date:** 2026-05-18
**Status:** Accepted

## Context

Chatsune used MongoDB with a replica set (`rs0`) for two reasons: native vector search (for the embedding subsystem) and transactional guarantees on multi-document writes. Both came at a deployment cost — operators had to bootstrap a replica set even for single-node deployments, upgrades were fiddly, and the moving parts surface area was bigger than the rest of the stack combined.

For Chatsundere the calculus changes:

- **Zero-knowledge backend means no server-side vector search.** Embeddings, if we want them later, run client-side over decrypted data. The server stores ciphertext blobs only; it has no signal to search over.
- **We want self-hosting to be friction-free.** A `docker compose up` should bring up a working backend without `rs0` ceremony.
- **Drizzle + PostgreSQL gives us first-class type-safe migrations** without ORM-style codegen weirdness.

## Decision

Use **PostgreSQL 16+** as the persistence layer for all backend services. One database per service, all hosted in the same Postgres cluster (`auth_db`, `sync_db`, `proxy_db`). No cross-database foreign keys; services know each other only by UUID.

Schema, queries, and migrations via **Drizzle**.

## Consequences

Positive:
- Single-node deployments are trivially simple — no replica set.
- Mature operations story: backups, monitoring, upgrades, point-in-time recovery are well-trodden ground.
- ACID by default, no need to reason about MongoDB write concerns.
- Type-safe schema and queries via Drizzle; migrations live as TypeScript.

Negative / accepted trade-offs:
- No native vector search on the server — by design (it would defeat E2EE anyway).
- Loss of MongoDB's flexible document shape; we pay this back with explicit migrations.
- `bytea` columns for ciphertext blobs are fine but require care to never log.

## References

- `obsidian/briefs/phase 0/project-setup.md` (Tech Stack table)
- Chatsune memories: deployment friction from `rs0`
