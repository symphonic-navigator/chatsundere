# Workstream C — device-verify & push checklist

**Context:** the OPAQUE/sync hardening sprint is squashed to `master` (not pushed).
Workstream C = the crypto/client-identity findings, commit **`252e47ac`**
("Harden client identity"). This note is the self-contained on-device checklist
so you can verify + push from anywhere. Full sprint summary lives in
[[../STATUS-BACKEND]]; the register is
[[2026-07-10-opaque-sync-hardening-findings]].

Master is 6 commits ahead of origin. **You push.** Automated gates already green
on the squashed master (typecheck 14/14, crypto 218/0, client-sync 391/0,
auth-service 194/0). What remains is the device-verify of the three
crypto/identity flows, which only a real browser + live backend can exercise.

## What Workstream C landed (`252e47ac`)

- **#1 (Critical) — master-key buffer copy.** `login-online-linked.ts` now copies
  the MK into a fresh buffer before closing the temporary local session.
  Previously the session and the returned key shared one buffer; `close()` zeroed
  it, so a *successful* linked-online login handed the boot identity check an
  all-zero key and **wiped the local vault**. This is the one to convince yourself
  is fixed.
- **#3 (High) — frozen OPAQUE client identifier.** The username used at OPAQUE
  registration is frozen on the `linked_account` row and reused in every client
  OPAQUE ceremony (login, step-up, pairing) instead of the live username, so a
  rename no longer breaks OPAQUE. Server side (auth-service) already returned the
  frozen identifier; C1b added the pairing-start conveyance.
- **R (Medium) — online recovery adopts the access token.** `recoveryOnline` now
  returns an online linked session carrying the server-issued access token (was a
  `void` return → an offline local session), so server-assisted recovery lands
  authenticated for sync.

## Setup

```
./dev.sh            # NOT `pnpm dev` — dev.sh loads --env-file=.env.dev so the
                    # OPAQUE server setup is stable (otherwise recurring
                    # "Server auth failed"). See memory dev_stack_via_devsh.
```
Have a second browser/profile ready for the pairing leg (step 2c).

## Verify

### 1. #1 — a successful linked-online login must NOT wipe the vault
1. Register a local account, create a persona + a chat message (so the vault has
   content).
2. Link the device to the backend (server-linking flow).
3. Log out, then **log in online** (linked + online — the happy path that was
   broken).
4. **Expect:** the persona/chat are still there. The bug wiped the local store on
   this exact path, so an empty "Create your first companion" state = regression.

### 2. #3 — rename must not break OPAQUE (login, step-up, pairing)
1. On a linked account, rename the username (My Account → username).
2. Log out, **log in online** under the new name → succeeds (not "wrong
   passphrase").
3. Trigger a **step-up** ceremony (e.g. an action that requires it) → succeeds.
4. **Pair a second device** to this renamed account (mint a pairing code, join
   from the second browser/profile with the passphrase) → the new device pairs
   and syncs. (This is the C1b sub-case: pre-fix, pairing to a renamed account
   failed with `opaque_protocol_error`.)

### 3. R — online recovery lands ONLINE, not offline-local
1. On a fresh device (or after wiping local data), recover the account **online**
   using the recovery key.
2. **Expect:** the app lands **online + authenticated** — sync starts without a
   re-login. Pre-fix it dropped you into an offline local session (sync couldn't
   authenticate).

If any leg fails, don't push — capture what happened (a console snippet is
usually enough) and it can be triaged.

## Push

```
git log --oneline origin/master..master   # sanity: the 6 commits, tip b894369e
git push origin master
```
`[skip ci]` is on the doc-only commits; the three feature commits will run CI.

## After the push

- Delete the feature branch + worktree (kept for reference until now):
  ```
  git worktree remove .claude/worktrees/opaque-sync-hardening
  git branch -D feat/opaque-sync-hardening
  ```
- The four Low follow-ups (L-A1..L-A4) are tracked in
  [[follow-ups-index]] — none blocks v0.2.0, but **`TRUST_PROXY_HOPS`** on auth
  (needed before the per-IP rate-limit backstop is spoof-resistant) is still owed
  before the real backend go-live.

> Workstreams A (server) and B (client sync engine) are covered by their automated
> suites (auth-service 194/0, client-sync vitest 391/0) and the whole-scope Larissa
> pass; their device-testable bits (e.g. #2 adversarial delete, #6 epoch recovery,
> V knowledge re-embed, #10b prod boot-refusal) are optional extra confidence, not
> gating for the push — but if you want them, they are in the spec §9 manual
> verification list.
