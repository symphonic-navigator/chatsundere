# Hardening OAuth grants for MCP — design

**Date:** 2026-11-10 · **Target release:** v0.3.6 · **Parent spec:** [`2026-11-02-mcp-oauth-design.md`](2026-11-02-mcp-oauth-design.md) (cited below as *the OAuth spec*) · **ADR:** [0038](../../obsidian/decisions/0038-oauth-for-mcp-connectors.md)

**Paths touched:** `packages/crypto/**` (one set entry), `apps/user-client/**` (grant sync handling, OAuth refresh, discovery, two screens). **Not touched:** `apps/auth-service`, `apps/sync-service`, `apps/proxy-service`, `packages/shared-types` (no new collection, no wire change), the sync server. The `packages/crypto` change makes this a **Larissa** unit; the new status and notice texts make it a **Laura** unit.

---

## 1. Intent

Close the three Low deferrals Larissa left on the OAuth pre-squash audit (2026-11-03, [`security-deferrals.md`](../../obsidian/insights/security-deferrals.md) under "OAuth for MCP connectors"):

- **L2:** a hostile sync server can roll a grant back on a device that already knows it, which can end in a revoked connection.
- **L4:** grant records are not size-padded.
- **L3 remainder:** the sign-in confirmation does not say when the sign-in details came through the proxy, and protected resource metadata is not fetched direct first.

### Goals

- A device never adopts a grant older than one it has already confirmed. Instead it pauses that grant, presents none of its tokens, and tells the user calmly, with *Sign in again* as the way out.
- `mcpOAuthGrants` records are padded like the other size-sensitive collections.
- The confirmation names it when the details reached the device through the user's Chatsundere server; protected resource metadata goes direct first whenever it can.

### Non-goals

- **Fresh devices.** A device that has never seen a grant has nothing to compare against and still accepts what the server serves. That stays the accepted L4 remainder of 2026-11-02.
- **The refresh timing channel** (claim push then publish push within seconds on the same blind id). **Accepted by Chris, 2026-11-10**; it is recorded as accepted, not fixed.
- **Binding `rev` into the seal.** The envelope format stays `chatsundere-sync-v1`.
- **Any server-side check.** The sync server stays ignorant of generations; it only sees ciphertext.

---

## 2. Decisions

| # | Decision | By |
|---|---|---|
| D1 | Rollback protection is a monotonic **`generation`** inside the sealed grant row, raised on **every** compare-and-set write, compared against a **device-local high-water mark**. | Larissa's proposal, Liz's shape |
| D2 | A detected rollback gives a **calm notice** on this device (status, chat notice, detail page), with *Sign in again* as the exit. It does **not** raise the sync `tamper` alarm: an honest server restored from a backup produces the same signal, and `tamper` is sticky until relink. | Chris, 2026-11-10 |
| D3 | The timing channel of L4 is accepted. | Chris, 2026-11-10 |
| D4 | Padding is turned on by adding `'mcpOAuthGrants'` to `PADDED_COLLECTIONS`; no format change, since `unpadPlaintext` already reads the length prefix whether or not a record was padded. | Liz |
| D5 | All three land as **one** feature unit and one squashed commit, with one Larissa pass. | Chris + Liz, 2026-11-10 |

---

## 3. End-to-end example

Ann has the Kumbu² connector signed in on her phone and her PC, both linked to her self-hosted backend.

1. **Normal life.** The PC refreshes: it claims (row at generation 7 → pushes generation 8), refreshes, publishes (pushes generation 9). Each `ok` raises the PC's `seenGeneration` to the pushed generation. The phone pulls generation 9, adopts it, and its `seenGeneration` becomes 9.
2. **The replay.** Ann's sync server is hostile (or something replays one record) and serves the phone the grant at generation 4 under a higher revision, without changing its epoch. (An honest restore of the whole server from a backup heals itself instead: see §5.4, "Epoch recovery".)
3. **The phone refuses it.** The pulled row opens fine (it is genuine ciphertext), but `4 < seenGeneration 9`. The phone keeps its local row unchanged, sets its device-local `heldGeneration` to 4, and presents none of the grant's tokens from now on.
4. **What Ann sees.** On the next Kumbu² tool call in a chat, the pill's notice reads `⚠ Kumbu²: sign-in paused on this device` with a *Sign in again* button, and the persona says the sign-in is paused, not that it ended. In *My Integrations* the row reads `⚠ Sign-in paused here`; its detail page explains: "This device received a copy of this sign-in that is older than the one it already had, so it has paused the sign-in to keep it safe. Nothing has been removed. Sign in again to carry on, or wait: if your other devices catch up, it carries on by itself." No sync-wide alarm appears.
5. **The way out.** Ann taps *Sign in again*. The new family is pushed with generation `max(seenGeneration, server's generation) + 1` = 10 under the new-sign-in rule (OAuth spec §5, "New sign-ins"), which wins whatever the row holds. The `ok` clears the hold; the PC pulls generation 10 and adopts it as normal.
6. **Or the server heals.** If instead the server comes back with generation 9 or higher (a later refresh from the PC), the phone adopts it and the hold clears by itself. The pill in the chat then reads `● Kumbu²: in use`, with no action.

Meanwhile, every grant record on the wire is padded to a power-of-two bucket of at least 1 KiB, so its size tells far less about the token kind than before.

And when Ann connects a new server whose authorisation server refuses browser requests, the confirmation adds a line under "You'll sign in at …": "This sign-in service doesn't accept requests from browsers, so its details came through your Chatsundere server. Check that the sign-in address above is the one you expect." She can still continue.

---

## 4. L4 — padding

- Add `'mcpOAuthGrants'` to `PADDED_COLLECTIONS` (`packages/crypto/src/sync-envelope/seal.ts:15`).
- Compatibility: records sealed before the change open unchanged (the length prefix in `padding.ts:29` covers both forms). Each grant is padded at its next write; no migration, no re-push sweep.
- Tests: the existing set test in `packages/crypto/tests/sync-envelope/seal.test.ts:81` gains the collection; a round-trip test proves that an **unpadded** grant record still opens after the change (`sealRecord` reads the set itself, so the test builds the legacy record by hand).
- What padding buys: buckets double (1, 2, 4 KiB…, `padding.ts:9`), so a grant holding a long JWT can still land one bucket above one holding a short opaque token. The size channel shrinks to the bucket; it does not vanish. Larissa rates whether that is enough.
- Record the timing channel as accepted (D3) in `security-deferrals.md`.

---

## 5. L2 — rollback protection

### 5.1 Data

On `McpOAuthGrantRow` (`apps/user-client/src/boot/client-data-db.ts:168`):

| Field | Synced? | Meaning |
|---|---|---|
| `generation?: number` | **synced**, inside the seal | Raised by one on every compare-and-set write. Absent on rows written before this release = **0**. |
| `seenGeneration?: number` | **device-local** (deny-listed in `sync/strip.ts`, fresh-device default `0`) | The highest `generation` this device has confirmed with an `ok` or adopted from the server. Never lowered. |
| `heldGeneration?: number \| null` | **device-local** (deny-listed, fresh-device default `null`) | Set to the refused generation while the grant is paused on this device; `null` otherwise. |

No Dexie version bump is needed if the fields are optional and read with the defaults above; if the plan finds a bump is needed after all, it is the next free version.

### 5.2 Writing

- **Every** compare-and-set write of a grant (claim, claim release, publish, `tokens = null` on `invalid_grant`, new sign-in, re-push after conflict) pushes `generation = max(seenGeneration, base) + 1`, where `base` is the generation of the row it pushes over. So the counter never falls below what this device has seen. A new sign-in opens the server's `current` for its `base`; when `current` does not open, `base` is the local row's generation.
- The local row takes the new generation only together with the `ok` acknowledgement (OAuth spec §5, "Acknowledgement": unconfirmed writes never enter the local row). The same transaction raises `seenGeneration` and clears `heldGeneration`.
- **The sign-in write path** (`mcp/oauth/sign-in.ts`, `storeGrant`, which builds a fresh row and replaces the local one) carries `seenGeneration`, `heldGeneration` and the previous `generation` over into the new row. The high-water mark must never be lost before an `ok`.
- **Outbox pushes** (backfill, epoch-recovery repush) carry the row's `generation` **unchanged**. Their acknowledgement raises `seenGeneration` and clears `heldGeneration` when the pushed generation is at least `seenGeneration`.
- Why every write and not only publishes: a claim rolled back at an unchanged generation would let two devices hold the same claim, which ends in a spent refresh token.
- **Unlinked device:** nothing is compared; the generation is left as it is, so a later backfill uploads it unchanged.

### 5.3 Reading

Wherever a grant record from the server is about to be applied, compare its opened `generation` (absent = 0) with `seenGeneration`:

- **`generation ≥ seenGeneration`:** apply as today; raise `seenGeneration` to it and clear `heldGeneration`, in the same transaction as the apply.
- **`generation < seenGeneration`:** refuse it. The local row (synced and device-local fields, pending pair included) stays exactly as it was; set `heldGeneration` to the refused generation. Record the refused revision in `syncRows` with no repush, as the local-wins branch of `applyUpsert` does: the pull watermark moves past it, and a later push conflicts against the right revision instead of wedging. No push is ever based on the refused row's **content**.
- A conflict that returns a `current` older than `seenGeneration` is a refusal too: hold, and keep any pending pair.

The paths that apply a grant from the server all reach `applyRecord` → `applyUpsert` (`sync/apply.ts`; the pulled-wins rule is `sync/resolution.ts:165`): an ordinary pull; `store.adopt` after a publish conflict (`mcp/oauth/grant-publish.ts`); the claim conflict, the claim release conflict and the `invalid_grant` conflict in `mcp/oauth/ensure-token.ts`. The check lives there once. Because the callers act on what they adopted, `GrantStore.adopt` must report the outcome (adopted / refused / stale), and every caller handles a refusal:

- `publishPending` returns `kept` and leaves all four pending fields in place (never `CLEARED_PENDING` after a refusal);
- the `ensure-token.ts` paths that would read the local row after an adopt return `held` instead of its access token.

### 5.4 Behaviour while held

- **What the hold blocks:** claims, refreshes, and publishing an **ordinary** pending pair, at every entry point (`ensureAccessToken`, `publishPendingTokens`, `publishNewFamily`) and at every snapshot inside the refresh loop, not only on entry. Those return the new reason **`held`**: no token is presented, no claim is pushed, no refresh is sent. An ordinary pending pair stays and is published normally once the hold clears.
- **What the hold never blocks:** a **new sign-in**. A `pendingNewFamily` pair is always published, held or not, under the new-sign-in rule, and its own access token may be used at once, as this device's fresh sign-in. Its `ok` clears the hold.
- `held` leads to the notices in §5.5; it never deletes. **Removing the server** while held is allowed to revoke the local refresh token at the revocation endpoint, as removal always does.
- The existing disabled states of *Sign in again* apply unchanged (backend unreachable, `SIGN_IN_WAITS_FOR_BACKEND`; a sign-in already in progress, `SIGN_IN_IN_PROGRESS`; the class-2 gate in the pill).
- **One liveness rule.** A grant is *live* only when `heldGeneration` is `null` **and** it has `tokens` or a pending pair. Every live/dead test uses one shared helper for this: the list status (`mcp/server-status.ts`), the detail panel (`components/mcp/OAuthConnectionPanel.tsx`), and every pill variant's after-recovery flip (`components/mcp/McpAuthNotice.tsx:28`). Status order: dead first (`⚠ Sign in again`), then held (`⚠ Sign-in paused here`), then the rest. So an old `dead` or `scope` pill never claims `connected again` or `access granted` while the grant is paused, and the detail panel shows *Sign in again* when paused.
- **The model** is told, for `held`: the server's sign-in is paused on this device and the user can sign in again; do not retry this turn. It is never given the `dead` wording.
- **Test connection** on the detail page reports "Sign-in paused on this device. Sign in again to carry on." and never writes `held` into `lastError`.
- A later server record with `generation ≥ seenGeneration` clears the hold by itself (§5.3), as does an acknowledged push at or above it (§5.2).
- **Epoch recovery** (an honest server restored from a backup answers `bad_since`; `sync/recovery.ts`): recovery clears `syncRows`, pulls, refuses the older grant (hold set, refused revision recorded), then re-pushes local rows through the outbox. That repush puts this device's newer grant back on the server, and its acknowledgement clears the hold (§5.2). So an honest restore heals itself without the user seeing a pause, and other devices then pull the newer grant. Only a replay without an epoch change leaves the pause standing.
- **Link reset** (a new link or going local-only, `sync/link-reset.ts`): `seenGeneration` is set to the row's own `generation`, never to 0, and `heldGeneration` to `null`. Never lowering it to 0 matters: otherwise a hostile server could bypass the check just by forcing a reset.
- The UI reads the hold: a refusal and a cleared hold both invalidate the grants query (`QK.mcpOAuthGrants`), so the list and the pill update without a reload.

### 5.5 What the user sees

| Where | Text | Action |
|---|---|---|
| *My Integrations* list status (OAuth rows; table in OAuth spec §9 "Status in My Integrations") | `⚠ Sign-in paused here` | — (row opens the detail page) |
| Detail page of the server | "This device received a copy of this sign-in that is older than the one it already had, so it has paused the sign-in to keep it safe. Nothing has been removed. Sign in again to carry on, or wait: if your other devices catch up, it carries on by itself." | *Sign in again* |
| Chat notice under the tool pill (`components/mcp/McpAuthNotice.tsx`, new variant `held`) | `⚠ <name>: sign-in paused on this device` while this device's grant is held; `● <name>: in use` once it is live here (the pause cleared, or the pill synced from another device that was paused) | *Sign in again* (opens the existing overlay) while held; none otherwise |

Pills sync, so a `held` pill created on the phone also appears on the PC; it reads the PC's own grant, hence `in use` there. A device still on v0.3.5 does not know the variant and shows its fallback, `⚠ <name>: sign-in ended` with *Sign in again*: harmless, accepted for the rollout.

The detail text stays neutral about the cause on purpose: in the rollout case of §5.6 the refused copy comes from a device on an older app, not from a misbehaving server.

`⚠ Sign-in paused here` ranks above `○ Waiting for your Chatsundere server` and below `⚠ Sign in again` (a dead grant). Copy as refined at Laura's spec-pass (2026-11-10).

### 5.6 Rollout

A device still on v0.3.5 writes grants without touching `generation`:

- Its claim, release and publish pushes spread the row they read, so they carry the generation **unchanged**. A v0.3.6 device sees an equal generation and accepts it. Rollback protection is weaker while such a device writes, but nothing breaks.
- Its **new sign-in** builds a fresh row without `generation` (= 0). A v0.3.6 device that has seen a higher one pauses the grant. Accepted: the exit is to sign in again on the updated device, and the app-update prompt resolves the cause.

### 5.7 Accepted residual

The server sees the losing body of every compare-and-set race (it receives the push and answers `conflict`). A hostile server can later serve that loser's body, which carries the same generation as the winner's, and a device that saw the winner accepts it as equal. The worst case is a foreign claim that never won, which delays a refresh by one lease or ends in `waiting`; no token is presented that the device did not hold. Larissa to confirm in her audit; if she rates it above Low, binding the writing device's id into the comparison is the follow-up, not part of this unit.

The accepted failure mode "Sync server restored from an old backup" of the OAuth spec §5 changes: an honest restore now heals itself through epoch recovery (§5.4), and a device that already knows the grant never presents an old token from a replay; it pauses instead. Update that list.

---

## 6. L3 remainder — the proxy-sourced details

`discoverOAuth` (`apps/user-client/src/mcp/oauth/discovery.ts:97`):

- **Direct first for protected resource metadata.** The pointer from the challenge and the two well-known guesses are fetched direct first and through the proxy only when the direct request fails as a network error and a proxy exists. This is the pattern the authorisation server metadata already follows (`getAs`, around `discovery.ts:223`). These are plain `GET`s with no credential, so the fallback cannot spend anything. The probe (`POST initialize`) keeps its caller-chosen `route`, which follows the MCP endpoint's own rules.
- **Remember where the details came from.** `OAuthDiscovery` gains `viaProxy: boolean`: true when the protected resource metadata **or** the authorisation server metadata that the result is built from was read through the proxy.
- **Say it.** `SignInConfirm` (`apps/user-client/src/components/mcp/SignInScreens.tsx:33`) takes `viaProxy` and, when true, adds one note line directly under the "You'll sign in at …" sentence, in the existing note style: "This sign-in service doesn't accept requests from browsers, so its details came through your Chatsundere server. Check that the sign-in address above is the one you expect." Nothing else changes on the screen; the user can continue as before.
- The flag travels with the discovery result wherever the confirmation is shown (from `mcp/oauth/check-server.ts` and the re-check in `OAuthSignInFlow.tsx` around `:347`). It is not stored in `mcpOAuthPending`: no data-shape change there. "Fails as a network error" means the rule `getAs` already uses: a `TypeError` from the fetch.

---

## 7. Security boundary

- **Larissa paths touched:** `packages/crypto/**` (D4). `apps/user-client/src/sync/**` and `apps/user-client/src/mcp/oauth/**` are not on the Larissa list but carry the grant's security logic, so they are **in her audit scope** for this unit.
- **Not touched:** `apps/auth-service`, `apps/sync-service`, `apps/proxy-service`, `packages/shared-types`.
- Zero-knowledge is unchanged: `generation` lives inside the sealed row; the server sees ciphertext and revisions only.
- No token, code or verifier is logged, stored outside the sealed blobs, or sent anywhere new.

---

## 8. Testing

Frontend tests run under Vitest (`apps/user-client`), crypto under Bun (`packages/crypto`).

- **Crypto:** set membership; unpadded legacy grant still opens (§4).
- **Generation writing:** each push kind pushes `max(seen, base) + 1`; a new sign-in opens `current` for its base and falls back to the local generation; a failed push leaves local `generation` and `seenGeneration` untouched; outbox pushes carry the generation unchanged; `storeGrant` keeps the high-water mark (a sign-in while held with seen 9 against a server at 4 pushes 10, and a pull of 4 in between is still refused).
- **Refusal on each path of §5.3:** for every listed path, a lower generation leaves the local row byte-for-byte unchanged, sets `heldGeneration`, records the refused revision, and presents no token; an equal or higher one applies and clears the hold. A refusal during publish keeps the pending pair; a refusal after `invalid_grant` presents nothing. The multi-device simulation (`tests/mcp/oauth/ensure-token.test.ts`, `grant-harness.ts`) has its own `adopt` and deny-list: make it call the shared refusal and add the new device-local fields. The ordinary pull needs a Dexie-level test alongside `tests/sync/push-record-direct.test.ts`.
- **Held behaviour:** `ensureAccessToken` returns `held` without pushing or fetching, also when the hold appears mid-loop after an adopt; an ordinary pending pair stays unpublished while held and publishes after the hold clears; a new sign-in publishes while held (also on a retry after a failed first push), its access token is usable at once, and its `ok` clears the hold.
- **Epoch recovery:** an honest restore (older grant served after `bad_since`) ends with the device's newer grant re-pushed, the hold cleared, and no outbox entry left conflicting.
- **Legacy rows:** a row without `generation` reads as 0; a v0.3.5-shaped push (generation carried unchanged) is accepted.
- **Link reset** clears the hold and sets `seenGeneration` to the row's own generation, never 0.
- **Discovery:** protected resource metadata goes direct first and falls back to the proxy only on a network error; `viaProxy` is true exactly when either document came through the proxy.
- **UI:** the confirmation line appears only with `viaProxy`; the list status, detail page text and chat notice appear for a held grant, each with its *Sign in again* where §5.5 says so; an old `dead` or `scope` pill does not claim connected while the grant is paused; a `held` pill reads `in use` once the grant is live on the reading device; *Test connection* on a held grant shows the paused text and leaves `lastError` alone; the model receives the paused wording, not the `dead` one.

---

## 9. Documentation

- `obsidian/insights/security-deferrals.md`: mark L2, L4 and L3 remainder of 2026-11-03 as closed by this unit (L4's timing channel as **accepted by Chris, 2026-11-10**); add the §5.7 residual and anything Larissa defers.
- `obsidian/insights/follow-ups-index.md`: strike the three rows (lines 30–32 as of `fe8341e5`).
- ADR 0038: a short addendum on the generation counter and the padded collection.
- The OAuth spec §5 "Accepted failure modes": the backup-restore line per §5.7.
- In-app help, `apps/user-client/src/content/help/integrations.md` (statuses listed around line 26), after the existing status lines: "If a device receives an older copy of your sign-in than the one it already has, it shows **Sign-in paused here** and stops using it to keep it safe. Tap **Sign in again**, or wait: it carries on by itself once your devices catch up."

---

## 10. Out of scope

- Fresh-device rollback protection.
- Closing the timing channel.
- Binding `rev` or a device id into the seal or the comparison.
- Any change to the sync server, proxy or shared wire types.
- A backend relay for the sign-in code, a manual client-ID field, or anything else on the follow-ups list.
- Tagging or releasing v0.3.6 (Liz does that after the squash).

---

## 11. Manual verification

Chris runs these on the live instance after the squash, with two linked devices (phone + PC) and an OAuth MCP server (Kumbu²):

1. **Regression, refresh across devices.** Sign in on the phone. Use a tool on the PC until the access token renews (or wait for expiry). Both devices keep working; neither shows `⚠ Sign-in paused`.
2. **Regression, new sign-in.** *Sign in again* on the PC; the phone's next tool call works without a prompt.
3. **Padding.** With the browser's network tools open on the PC, trigger a refresh; the push carrying the grant record is at least 1 KiB of ciphertext.
4. **Proxy note.** Connect a server whose sign-in service refuses browser requests (or test with the direct route blocked): the confirmation shows "This sign-in service doesn't accept requests from browsers, so its details came through your Chatsundere server. Check that the sign-in address above is the one you expect." Connecting a server reachable directly (Kumbu² on a CORS-friendly setup) shows no such line.
5. **Rollback, on the local dev stack** (required: it is the only device check of the three new surfaces; the live instance is not tampered with). Two browser profiles (phone, PC) linked to the dev backend, an OAuth server signed in.
   - **(i) Honest restore heals itself.** Snapshot the sync database (`pg_dump`), let the PC refresh the grant, restore the snapshot, then use a tool on the phone. Expected: no pause anywhere, no revocation, both devices keep working (epoch recovery re-pushes the newer grant).
   - **(ii) Targeted replay pauses.** Take the grant record's old ciphertext from a snapshot and write it into the current record under a higher revision (one SQL update, epoch unchanged), then use a tool on the phone. Check:
     - the pill reads `⚠ <name>: sign-in paused on this device` with *Sign in again*, and the persona says the sign-in is paused;
     - *My Integrations* reads `⚠ Sign-in paused here`; the detail page shows the paused text with *Sign in again*;
     - an older `sign-in ended` pill in the same chat does **not** read `connected again`;
     - on the PC, the same pill reads `● <name>: in use`;
     - *Sign in again* on the phone clears the pause there and the pill reads `● <name>: in use`; the PC keeps working.
   This step can be driven with **Playwright MCP** (two browser contexts standing in for phone and PC, the `pg_dump`/restore and the SQL replay between them), so it runs under controlled conditions and can be repeated and traced, as done for Kumbu² (Chris, 2026-11-10). It runs locally after the overnighter, not in the cloud run.
