# ADR 0025: UUIDv7 is the universal identifier across the data model

**Date:** 2026-05-20
**Status:** Proposed
**Related:** ADR 0024 (single-server-per-account), `obsidian/briefs/phase 0/cross-device-identity.md`

## Context

Cross-device sync and multi-server identity both require that
entities have a stable, globally-unique identifier independent of any
human-readable label. The originating discussion settled on **UUIDv7**
for `user_id`, then generalised the choice to every merge-able entity:
Personas, Knowledge Base Libraries, Chats, Memories, invitations,
pairing codes, and every future addable type.

The relevant alternatives and their cost:

- **UUIDv4 everywhere.** Standard, well-supported, but pure-random.
  No timestamp prefix means B-tree insert performance degrades on
  high-cardinality tables, and there is no implicit chronological
  ordering — every list query that wants chronological order must
  carry a separate `created_at` column.
- **Auto-increment integers (per-table).** Best insert performance,
  but client-generated IDs are impossible without coordination, which
  breaks the offline-first sync model.
- **UUIDv7.** Timestamp-prefixed (48 bits ms-resolution), 74 bits of
  randomness, sortable by creation order, RFC 9562 standardised
  (2024). B-tree-friendly inserts. Client-generatable without
  coordination. Sortable.
- **ULID.** Similar properties to UUIDv7 but a different encoding;
  predates RFC 9562 and is less universally tooled.

UUIDv7 is the right pick for our use case: client-generatable
(necessary for offline-first creation), sortable (eliminates a
separate `created_at` for the common case), and standardised in 2024,
so the tooling situation will only improve.

## Decision

Every merge-able entity in Chatsundere uses **UUIDv7 as its primary
identifier**, generated at creation time, on client or server depending
on origin.

This rule applies to all entity classes today and is the default for
any new entity class added in the future. There is no "name-as-identity"
mechanism anywhere in the data model.

## Consequences

Positive:

- **Trivial sync semantics.** Two entities with the same UUIDv7 are the
  same entity; apply updates. Two entities with the same name but
  different UUIDs are different entities; both coexist. The merge rule
  is one sentence and needs no further logic.
- **B-tree friendliness.** Timestamp prefix means UUIDv7 inserts cluster
  at the right of the index, matching PostgreSQL's append-mostly write
  pattern. Significantly better than UUIDv4 for high-cardinality tables.
- **Implicit chronological order.** A UUIDv7 sort is a creation-time
  sort. The `created_at` column remains useful for human display and
  certain queries (e.g., "last modified" semantics) but is not required
  for chronological ordering of lists.
- **Offline-first works without coordination.** A client can mint UUIDs
  for new entities while disconnected, and the server accepts them
  on sync without conflict.

Negative / accepted trade-offs:

- **74 bits of entropy per UUIDv7**, vs 122 bits for UUIDv4. Still vastly
  more than enough for collision-free operation at our scale (the
  expected collision threshold for 74 bits is ~1.5 × 10¹¹ UUIDs
  generated within the same millisecond — physically impossible in
  realistic usage).
- **Client-side library required.** `crypto.randomUUID()` produces v4
  by default, so client code cannot use it directly. We use the
  `uuidv7` npm package (~5kB, MIT-licensed, no dependencies,
  RFC 9562-compliant); the cross-device-identity brief records the
  rationale for choosing the library over a hand-rolled helper.
- **Server-side function required until PostgreSQL 18.** Phase 0 targets
  PG 16+, and PG 18 ships `gen_uuidv7()` natively. Until then, the
  schema provides its own SQL function. Migration to the native
  function on PG 18 is mechanical.

## Reference implementation — server-side

Phase 0 PostgreSQL helper, intended to be drop-in replaceable by
`gen_uuidv7()` when PG 18 is the runtime:

```sql
create or replace function gen_uuidv7() returns uuid
language plpgsql
as $$
declare
  unix_ts_ms bigint;
  uuid_bytes bytea;
begin
  unix_ts_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  uuid_bytes := decode(lpad(to_hex(unix_ts_ms), 12, '0'), 'hex')
                || gen_random_bytes(10);
  -- set version (7) and variant (10)
  uuid_bytes := set_byte(uuid_bytes, 6,
                  (get_byte(uuid_bytes, 6) & 15) | 112);
  uuid_bytes := set_byte(uuid_bytes, 8,
                  (get_byte(uuid_bytes, 8) & 63) | 128);
  return encode(uuid_bytes, 'hex')::uuid;
end;
$$;
```

Monotonicity within the same millisecond is **not** enforced by this
helper (the random portion is fully random rather than a sub-ms
counter). For our workload — single-server inserts with no extreme
intra-ms burst — this is acceptable. If we observe collisions or
ordering anomalies in practice, swap to a counter-based variant.

## Alternatives considered

1. **UUIDv4 everywhere.** Rejected: B-tree degradation on
   high-cardinality tables is a real cost, and we lose implicit
   chronological ordering for nothing in return.
2. **ULID.** Rejected: equivalent properties to UUIDv7 but
   non-standardised. UUIDv7 won the RFC race; aligning with the
   standard reduces tooling friction.
3. **Mixed (UUIDv7 for `user_id` and major entities, UUIDv4 elsewhere).**
   Rejected: inconsistency is its own cost; the benefits of UUIDv7
   apply to every entity class.

## References

- [`obsidian/briefs/phase 0/cross-device-identity.md`](../briefs/phase%200/cross-device-identity.md) — UUIDv7 Across the Data Model section.
- [`obsidian/insights/2026-05-19-brief-material-cross-device-identity.md`](../insights/2026-05-19-brief-material-cross-device-identity.md) — originating sub-question on merge strategy.
- RFC 9562 — Universally Unique IDentifiers (UUIDs), May 2024.
- [ADR 0024](0024-single-server-per-account.md) — the simpler data model that UUIDv7 enables (no server-id namespacing).
