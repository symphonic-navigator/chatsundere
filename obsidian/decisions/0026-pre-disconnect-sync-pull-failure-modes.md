# ADR 0026: Pre-disconnect-sync-pull failure modes and recovery flows

**Date:** 2026-05-20
**Status:** Proposed
**Related:** ADR 0024 (single-server-per-account), `obsidian/briefs/phase 0/cross-device-identity.md`

## Context

[ADR 0024](0024-single-server-per-account.md) commits to **variant α —
pre-disconnect-sync-pull** as the data-preservation guarantee during an
auto-handover (the user moves a `local_account` from server Y to server
X). The cross-device-identity brief sketches the happy-path state
machine but explicitly flags three failure modes as out of scope for
that brief:

1. **Y unreachable at handover time.** The client cannot complete the
   sync-down from Y, so it cannot guarantee local cache is complete
   before disconnect.
2. **Y reachable but sync-down verification fails.** The paginated
   download completes but a final consistency check (count, hash, set
   equality) reports missing or extra items.
3. **X join fails after Y logout has already happened.** The client is
   in a transient "no-active-server" state with local data intact but
   no server to talk to.

The cross-device-identity brief leaves these for an ADR because the
choices have real UX consequences and deserve their own record.

While drafting this ADR I also noticed that the original step ordering
in the brief makes failure mode 3 worse than it needs to be. The
re-ordering (below) eliminates failure 3 entirely by deferring the Y
logout to the last step — at the cost of the client briefly holding
valid credentials on both servers, which is benign because single-
server-per-account is a *client-side* rule, not a server-enforced one.

## Decision

### Re-ordered state machine

The happy-path state machine from the cross-device-identity brief is
amended to defer the Y logout to after the X join completes. The brief
is updated in the same change as this ADR lands.

```
1.  User scans QR for new server X while linked to server Y.
2.  Client surfaces auto-handover confirmation modal.
3.  User confirms.
4.  Client enters "pre-handover-sync" state.
    a. Client requests full content list from Y (paginated).
    b. Client downloads any items not present locally.
    c. Client verifies local cache matches Y's content set.
       (verification by count + content-hash set equality)
5.  Client begins POST /api/join on X (with the new code).
6.  On successful join, client uploads all local content to X.
7.  Client switches active_server to X.
8.  Client invalidates Y's bearer token (POST /api/auth/logout on Y).
9.  Auto-handover complete.
```

The deferred logout means a failure in step 5 or step 6 leaves Y's
session intact and the client trivially recoverable on Y. The original
ordering created a transient no-active-server state between step 5 and
step 7; this ordering removes that transient.

### Failure mode A — Y unreachable in step 4

**Detection:** the paginated content-list call to Y times out or returns
a transport-layer error (TCP refused, DNS failure, HTTPS handshake
fails, 5xx with no recovery after one retry).

**Default behaviour: refuse the handover.**

```
Cannot reach Bob's server right now.

Your data on Bob's server cannot be safely copied here, so the move
to Alice's server has been paused. Try again when Bob's server is
back online.

[Cancel]  [Try again]  [Move anyway — risk losing items from Bob's]
```

The third button is an explicit override for users who accept the risk
of incomplete data. Tapping it logs a local audit entry
(`handover_forced_without_sync_down`) and proceeds from step 5
directly. The local cache is what the user keeps; anything on Y that
this device didn't already have is lost from this device's perspective
(still recoverable from another linked device on Y, if any).

**Rationale for refuse-by-default:** the originating brief's contract
is "no data loss on linking" (ADR 0024). Silently proceeding when we
cannot honour the contract would violate user expectations. Surfacing
the choice explicitly preserves user agency without lying.

### Failure mode B — verification fails in step 4c

**Detection:** step 4a returned a content manifest (count + per-item
hashes); after step 4b, the local cache's manifest does not match.
Mismatches: missing items, unexpected items, hash divergence on
matching IDs.

**Default behaviour: auto-retry step 4 once, then escalate to the
Failure-A flow.**

Single-retry rationale: most verification mismatches are caused by a
transient network blip or by another device concurrently uploading to Y
during the sync-down (a tiny race window). A second clean pass usually
resolves both.

If the second pass also fails, surface the same modal as Failure A but
with adjusted copy:

```
Could not get a complete copy of your data from Bob's server.

We tried twice but the data we received didn't add up. This sometimes
happens when another device is uploading to Bob at the same time, or
when the connection is unstable.

[Cancel]  [Try again]  [Move anyway — risk losing items from Bob's]
```

### Failure mode C — X join fails in step 5 or upload fails in step 6

**With the re-ordered state machine, this is no longer "no-active-
server" territory** — Y's session is still valid because we have not
logged out yet.

**Detection:**

- Step 5 (`POST /api/join` on X) returns 4xx (code expired, used,
  revoked, username conflict) or 5xx.
- Step 6 (content upload to X) fails mid-stream.

**Behaviour:** the client stays on Y. No active_server change has
happened yet. The user sees one of the following depending on the
subtype:

| Subtype | Modal |
|---|---|
| Code expired (`404 code_not_found_or_expired`) | "The invitation code has expired. Ask Alice for a new one." |
| Username conflict (`409 username_collision`) | Inline error on the username field of the join modal; user retries with different name (same as initial onboarding flow). |
| Network / 5xx on join | "Could not reach Alice's server. Your link to Bob's is still active. [Retry] [Cancel]" |
| Network / 5xx mid-upload | "Couldn't finish uploading to Alice's server. Your link to Bob's is still active and your data is safe. [Retry upload] [Cancel and stay on Bob's]" |

The "Cancel and stay on Bob's" option in the mid-upload case is
important: the user may have partial state on X (some items uploaded,
some not) that we then have to clean up. The client tracks which items
made it to X and either retries from where it left off or, on cancel,
issues `DELETE /api/me/account` on X to clean up — X's account row
exists post-join, even if the data upload was partial.

### Step 8 failure — logout from Y fails

Cosmetic. The user is already on X by step 8; the Y session is
orphaned but its refresh token will expire on its own per
auth-service's normal lifetime. The client schedules a background
retry of the logout call (best-effort) but does not surface anything
to the user.

## Consequences

Positive:

- The "no-active-server" transient state is eliminated by construction
  through the re-ordering, not patched up with recovery logic.
- All three failure modes have explicit, user-comprehensible flows;
  none of them result in silent data loss.
- The user's data-preservation contract from ADR 0024 is honoured
  except when the user explicitly overrides it with the "Move anyway"
  escape hatch — and that override is logged.
- Recovery flows are local-first: the client tracks its own
  state-machine position and can resume mid-handover after an app
  restart (state stored in IndexedDB, not memory).

Negative / accepted trade-offs:

- **The client briefly holds valid credentials on both Y and X**
  during steps 5–7. This violates the *spirit* of single-server-per-
  account, but only for the duration of one handover (seconds to
  minutes, depending on upload size). The single-server rule is a
  *client-side data-model* rule, not a server-enforced credential
  rule, so this does not break ADR 0024.
- **Partial-upload cleanup on cancel adds complexity to the X server
  side.** `DELETE /api/me/account` must be idempotent and must
  clean up partial sync state. Worth noting because this is auth-service
  territory and will need a Larissa pass.
- **"Move anyway" overrides** are explicit user choices but represent
  a measurable risk surface. We log them; we do not refuse them.

## Alternatives considered

1. **Keep the original ordering (logout Y first).** Rejected: creates a
   transient no-active-server state that we then need recovery UX for.
   The re-ordered version is strictly better with no compensating
   downside.
2. **Refuse "Move anyway" entirely; always require Y to be reachable.**
   Rejected: violates user agency. A user who genuinely doesn't care
   about lost-on-Y data (e.g., they only ever used this one device,
   and Y is permanently dead because Bob shut his server down) should
   be able to proceed. Audit-logging the override is sufficient.
3. **Do partial-upload cleanup on the client side instead of via
   `DELETE /api/me/account`.** Rejected: the X server might have
   indexed, replicated, or otherwise persisted partial data in ways
   the client cannot reach. Server-side cleanup is the only honest
   way.

## References

- [ADR 0024](0024-single-server-per-account.md) — single-server-per-account, variant α data-preservation commitment.
- [`obsidian/briefs/phase 0/cross-device-identity.md`](../briefs/phase%200/cross-device-identity.md) — Multi-Server Linking with Auto-Handover section (amended by this ADR's re-ordering).
- [`obsidian/insights/2026-05-19-brief-material-cross-device-identity.md`](../insights/2026-05-19-brief-material-cross-device-identity.md) — originating discussion (Q5).
