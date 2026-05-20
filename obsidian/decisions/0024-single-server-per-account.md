# ADR 0024: A `local_account` is linked to at most one server at a time

**Date:** 2026-05-20
**Status:** Proposed
**Related:** ADR 0021 (OPAQUE-first linking), ADR 0022 (UV-policy), ADR 0023 (server-at-root), `obsidian/briefs/phase 0/cross-device-identity.md`

## Context

A user can plausibly have accounts on multiple Chatsundere instances
(`chris@chatsune.me` and `chris@bobs-server.de` are legitimately
distinct identities per the cross-device-identity brief). The question
is whether a single client *installation* — one device, one
`local_account` — can be simultaneously linked to multiple servers, or
whether it can hold at most one active server link at a time.

The trade-offs are concrete:

- **Multi-server simultaneously linked.** Each chat/persona/library/
  memory needs a `server_id` qualifier; the merge logic in the
  UUID-based sync model needs to namespace UUIDs per server; the UI
  needs server-switcher chrome; the auth surface widens (multiple
  refresh tokens, multiple OPAQUE records on one device); auto-handover
  becomes meaningless because no handover is needed. Heavy.
- **Single server at a time, with graceful switching.** The data model
  is server-agnostic at the entity level; the user-client tracks one
  `active_server` and one set of credentials; switching is an explicit,
  consent-gated operation. Light, but requires a well-designed handover
  flow to avoid data loss.

The cross-device-identity brief commits to the second model. This ADR
records the architectural decision and the data-preservation guarantee
that justifies the simpler model.

## Decision

A Chatsundere `local_account` is linked to **at most one server at a
time**. The linked server is the **active server** for that account.

Attempting to scan an invitation or pairing QR for a different server
while already linked triggers an **auto-handover confirmation**:
explicit consent + atomic disconnect-from-old + re-link-to-new in one
operation.

Data preservation during auto-handover follows **variant α —
pre-disconnect-sync-pull**: before disconnecting from the old server,
the client performs a full sync-down to ensure all server-resident
data is locally cached; then the local cache (now complete) is
uploaded to the new server after the link succeeds.

Data on the old server is **not auto-deleted** by the handover. To
remove it, the user must explicitly use "Disconnect from server" on
the old server (which deletes the user's server-side ciphertext) before
the handover.

## Consequences

Positive:

- **Simpler data model.** Entity UUIDs need no server-id namespace.
  Merge logic operates on UUID alone (`same UUID = same entity`),
  matching the universal-UUIDv7 rule from [ADR 0025](0025-uuidv7-across-the-data-model.md).
- **Simpler UI.** No server-switcher chrome, no per-server lock-in
  indicators in the main flow. The active server is visible in
  Settings → Account; everywhere else, the UI assumes one server.
- **Simpler auth surface.** One refresh token per client, one OPAQUE
  record, one set of passkeys. Halves the credential-state space.
- **No data loss on switch.** The variant-α sync-down guarantees the
  user can move between servers without losing the data they had on the
  prior server, as long as that server is reachable during the
  handover.

Negative / accepted trade-offs:

- **Power users with accounts on multiple servers must use multiple
  devices** (or a single device that they re-link manually each time
  they want to switch). The expected population is small; the
  cross-device-identity brief's "Just this device — no server" path
  remains a workable third option for users who actively want isolation.
- **Auto-handover failure modes are a real concern** (old server
  unreachable, sync-down verification fails, new server join fails
  after old server logout). These are flagged as [OPEN] in the
  cross-device-identity brief and will spawn a follow-up ADR (likely
  ADR 0026) specifying the failure-mode state machine and user-facing
  recovery flows.
- **A handover that the user did not intend** (e.g., scanning a wrong
  QR by mistake) is destructive in the sense that local data is
  uploaded to a server the user did not mean to join. Mitigation: the
  auto-handover confirmation modal is explicit, names both source and
  destination by hostname, and uses the destructive-button visual
  treatment. The mitigation lives in the brief; this ADR records the
  trade-off.

## Alternatives considered

1. **Multi-server simultaneous links.** Rejected: the architectural
   cost (server-id namespacing across the entire entity model, UI
   chrome, multi-credential storage, sync complexity) is high; the
   benefit (legitimate use case of one user with accounts on multiple
   servers) is rare; the work-around (multiple devices, or manual
   re-link) is acceptable for the expected population. Decision is
   reversible if Phase 1+ usage shows real demand.
2. **Single server, but data is wiped on switch (variant β).** Rejected:
   violates the user's reasonable expectation that their data follows
   them. The originating discussion explicitly rejected the "wipe local
   data" warning when Chris clarified that server has no plaintext data
   of its own.
3. **Single server, no auto-handover (manual disconnect-then-link
   required).** Rejected: poor UX for what is functionally one
   operation. The auto-handover modal is the single decision point;
   forcing two screens for one decision adds friction without safety
   benefit (the confirmation is the same content either way).

## Open items

The pre-disconnect-sync-pull state machine has known failure modes
that require their own decision (likely ADR 0026). The cross-device-
identity brief flags these as [OPEN] item 7. They include:

- Old server unreachable at handover time.
- Sync-down completes but verification reports missing items.
- New server join fails after old server logout (transient
  no-active-server state).

These are not solved by this ADR; this ADR locks in the model that
necessitates the follow-up.

## References

- [`obsidian/briefs/phase 0/cross-device-identity.md`](../briefs/phase%200/cross-device-identity.md) — Multi-Server Linking with Auto-Handover section.
- [ADR 0021](0021-phase0-opaque-first-linking.md) — every account has an OPAQUE method (relevant because the handover re-uses that method during re-link).
- [ADR 0025](0025-uuidv7-across-the-data-model.md) — UUIDv7 universality (the data-model simplification this ADR enables).
- [`obsidian/insights/2026-05-19-brief-material-cross-device-identity.md`](../insights/2026-05-19-brief-material-cross-device-identity.md) — originating discussion (Q5).
