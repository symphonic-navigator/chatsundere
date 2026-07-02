# Chatsundere Status — Full Backend Transition

**Last updated:** 2026-07-02 — WS-E (step-up vertical) and WS-B (onboarding
un-gate, Add-a-device, server-synced passkeys) built on a branch cut from
`full-backend-transition`, awaiting Larissa (auth-service + `packages/crypto` +
both interceptor paths) and Laura (pre-squash on WS-B's user-reachable flows)
audits, then squash into two units (`E:` → one squash, `B:` → one squash).
**Last updated:** 2026-07-02 (late evening) — all remaining specs + plans done; WS-B+E building remotely.
This file is the orientation surface for the **Full Backend Transition**: the
focused, deploy-free sprint that integrates the three built backend workstreams
(authenticated proxy, zero-knowledge sync, blob transport) plus the two auth
remainders (step-up, onboarding un-gate) into the `v0.1.3` local-only client —
turning Chatsundere from a local-only companion into a full end-to-end-encrypted
backend client.

It is a **peer to** [[STATUS-BACKEND]] (server side, now built) and
[[STATUS-CLIENT-ONLY]] (client feature history). Read all three at session start
per CLAUDE.md §16; update this one at the end of every transition session. It
lives on the `full-backend-transition` branch and merges back to master turnkey.

> **Sibling note:** the other two STATUS files live under `obsidian/`. This one
> sits in the repo root (of the transition branch) at Chris's request for
> sprint-visibility; move it beside the others if peerage-by-location is
> preferred later.

---

## 1. The sprint frame (settled with Chris 2026-07-02)

- **~4.5 focused days**, deploy-free.
- **No mid-flight compatibility burden.** Because nothing deploys during the
  sprint, the client need not keep working end-to-end at every step. We build
  the transition **straight-line and turnkey**, and reconcile with the live
  world only at merge time. This is the sprint's biggest accelerant — it removes
  the coordinated-proxy-cut / don't-break-local-only dance entirely.
- **Isolated branch: `full-backend-transition`**, checked out as a **dedicated
  git worktree** under `.claude/worktrees/` (CLAUDE.md §8 — never a checkout of
  the main tree; the main tree stays on `master` so Chris's parallel work is
  safe).
- **Pushed to GitHub regularly (2–3× a day) as checkpoints/backup — this is
  safe.** `docker.yml` and `pages.yml` trigger **only** on `push: branches:
  [master]` and `tags: v*.*.*` (plus PRs to master). A push to
  `full-backend-transition` triggers **no workflow at all** — no CI, no image
  build, no Watchtower deploy. Push as often as wanted; it is inert.
- **Merge back to master only when schlüsselfertig** (turnkey): typecheck + full
  vitest green on the branch, Larissa clean on every `packages/crypto`/sync-
  touching unit, Laura clean on every user-reachable flow change.
- **`master` stays Chris's** during the sprint. Liz commits nothing to master;
  Liz pulls master **into** the branch periodically so the final merge is not a
  cliff.

## 2. Parallel master work — the one coordination point

Chris may, on master, in parallel:

- **Curate 1–2 models** for users — **collision-free** (no schema change), do
  anytime.
- Possibly a **tiny "artefact creator model" feature** (let users pick the model
  that generates all artefacts — a genuinely-wanted, sensible ask). Chris will
  **ask before building it.**

**The single collision surface is `apps/user-client/src/boot/client-data-db.ts`
— the Dexie version number.** The sync engine (WS-C) owns **Dexie v33**. If the
artefact-creator feature needs a schema field (e.g. on `SettingsRow`), it needs
its own Dexie bump and **collides with v33**. Resolution, pre-agreed: that
feature takes **v33** and the sync engine moves to **v34** (Chris tells Liz
before Liz locks the engine migrations), or it is sequenced. The concrete
question Chris asks before building: **"does it touch `client-data-db.ts` /
need a Dexie version?"** If no → no coordination needed. (Register:
[[insights/future-feature-couplings]].)

## 3. Scope — IN (this sprint) / OUT (the later go-live event)

**IN — turnkey client code on the branch:**

- WS-0 Foundation, WS-B Onboarding un-gate, WS-A Proxy client, WS-C Sync engine,
  WS-D Blob client, WS-E Step-up. All gated behind Larissa + Laura, green on the
  branch.

**OUT — a separate go-live event afterwards, consuming this branch:**

- The actual VPS deploy of the whole backend (auth + proxy + sync + postgres +
  redis + MinIO).
- The **coordinated `cors-proxy.tidesson.net` cut** (old container stopped-not-
  deleted, 60 s rollback, the constructive in-client cut message).
- The Discord "Chatsundere has a backend" announcement.
- The **v0.2.0** tag + the ADR 0031 / CLAUDE.md §12 roadmap amendment
  (v0.3.0 → v0.2.0).
- Larissa's still-owed **post-merge re-audits of the built 6A/6B/6C server
  diffs** (tracked in [[STATUS-BACKEND]]) — a server-side gate for the go-live,
  not a sprint task.

## 4. The workstreams — ordering, size, audit gates

Ordered by import-dependency and risk-frontloading (deploy pressure removed, so
purely technical sequencing).

| # | Workstream | Size | Audit | Depends on |
|---|---|---|---|---|
| **0** | **Foundation** — `GET /api/v1/config` consumer (`proxyUrl`/`syncUrl`/`features`), a real connectivity (online/offline) store, the "linked-account exists" gate + `features`-driven disabled-over-hidden | S–M | Laura | — |
| **B** | **Onboarding un-gate + verify** — un-gate the 3 disabled matrix cells (`onboarding/matrix.tsx:15-43`), make the server-linking badge real (`server-linking.tsx:21`), decide the unused server-passkey-linking caller, device-verify the already-built join/pairing/recovery flows against a live backend | S build / M verify | Laura | 0 |
| **E** | **Step-up client** — `<StepUpModal>` + a `step_up_required`/`webauthn_uv_required` interceptor (today `apiFetch` has no step-up branch; MCP/LLM bypass it), admin-client Tier-4 wire-up | S–M | Laura | B |
| **A** | **Proxy client** — swap the static MK-sealed `x-cors-proxy-api-key` for `x-chatsundere-authorization: Bearer <account JWT>` in `transport.ts:94` + `mcp-client.ts:43` (`Authorization` keeps the upstream key), consume discovery `proxyUrl`, 3xx re-issue, `CorsProxyBlock` collapses to "active because you're connected" | M | Laura (+ light Larissa on the token-attach path) | 0, B |
| **C** | **Sync engine — the long pole** — Dexie **v33** (`syncOutbox`/`syncState`/`trash` + migration), engine-stamped `updatedAt` on the 4 rows lacking it (chats/messages/mindspaces/attachments), outbox enqueue at the ~35 scattered write sites, two-class write discipline, single-flight worker (drain → pull-apply), `sync-envelope` consumption, conflict resolution (per-collection LWW keys, delete-wins + trash, journal state-precedence, vectors stamp-adopt, settings server-wins, memoryBody re-dream), watermark/epoch + recovery, doorbell WS consumer, the **27 `db.verno` assertion sweep**. Carries the two cross-flags: vectors shrunk-tail cleared-state, epoch-restore mechanics | **XL** | **Larissa** (zero-knowledge boundary in the client) + Laura (offline-disabled UX) | 0, B |
| **D** | **Blob client — rides on C** — `BlobRef` transform (artefacts/attachments/personaAvatars), outbox ordering (PUT-before-record, tombstone-before-DELETE), `sync-blob` consumption, fetch strategy (thumbnails/avatars eager, originals lazy — Laura), inert-resolution + repair PUTs (409/501/413), trash interplay, quota display, epoch-recovery re-upload | L | **Larissa** + Laura | C |

**Natural cut-line if 4.5 days squeeze: WS-D.** "Sync without blobs" is a
coherent intermediate — the sync spec itself names "artefacts/attachments not yet
following" as an ordered consequence. Records sync; images follow one iteration
later.

**Per-workstream discipline:** each of 0/B/A/C/D/E gets its own
brainstorm → spec (Chris reads every spec) → plan → subagent-driven build, with
the audit gate for that unit. This file tracks the sprint; the specs/plans live
in `superpowers/`.

## 5. Open decisions — carry into the per-workstream specs

1. **Local-only user vs. authenticated proxy (WS-A, gating decision).** The new
   proxy is **token-only** (shared-key mode dropped). A local-only user has no
   account JWT → after the cut cannot use the proxy without linking an account.
   Is linking then de-facto required for egress? A real UX consequence for the
   ~10 alpha users — decide, don't discover.
2. **Sync spec §12.1 reference is wrong (WS-C).** It cites the memory-body editor
   as the two-phase-commit precedent; the editor is purely local. The real
   precedent is the **passphrase-change staging**
   (`packages/crypto/src/flows/change-passphrase.ts` + `db/staging.ts` +
   `reconcileStagingOnBoot`) — a better model (write-ahead staging + boot
   reconcile). Correct the reference and adopt the staging pattern.
3. **Server-passkey-linking caller (WS-B).** ✅ **Resolved — wired in WS-B.**
   `registerServerSyncedPasskey` (`apps/user-client/src/lib/server-passkey.ts`)
   now drives `linkPasskeyStart`/`addPasskeyPostLink` from the post-onboarding
   biometric prompt and the Account → Biometric unlock page, with a
   local-fallback path when the server-sync step fails after a credential is
   minted (never an orphan credential, never a second `credentials.create`).

## 6. Doing now

- **WS-E (step-up vertical) + WS-B (onboarding un-gate) BUILT on a branch cut
  from `full-backend-transition`** — spec
  `superpowers/specs/2026-07-02-ws-b-e-onboarding-and-step-up-design.md` (v2,
  Laura-passed), plan `superpowers/plans/2026-07-02-ws-b-e-onboarding-and-step-up.md`,
  all 11 implementation tasks green. **WS-E** (Tasks 1–7): step-up wire shapes
  in `shared-types`; auth-service t1-seeding on fresh OPAQUE/recovery evidence +
  the recovery `opaque_client_identifier` fix + tier enforcement on
  passkey-link / auth-method removal / passphrase-change / account-delete; the
  `packages/crypto` step-up ceremony flows (`stepUpWithPasskey`/`…Passphrase`);
  the `packages/ui-shared` step-up store + shared `StepUpModal`; the `apiFetch`
  403 `step_up_required` interceptor + modal host in both user-client and
  admin-client. **WS-B** (Tasks 8–11): un-gated onboarding matrix +
  probe-validated URL entry; the server-linking page made real off the
  `account-link.store`; Add-a-device pairing-code generation UI; server-synced
  passkeys (§5 decision #3). Verification battery: typecheck 14/14 (0 cached),
  crypto 189, ui-shared 68, admin-client 45, user-client 0-failure baseline (one
  known load-dependent `stream-manager-store` flake, unrelated — passes in
  isolation and on clean runs), auth-service 149 pass / 12 skip / 4 fail (the 4
  are the pre-existing `bootstrap.test.ts` environmental subprocess baseline),
  `pnpm build` 9/9, Biome clean. **Awaiting Larissa (auth-service +
  `packages/crypto` + both interceptor paths) and Laura (pre-squash on WS-B's
  user-reachable flows), then squash as two units and Chris's §15 manual
  verification.**
- **WS-0 Foundation** — built earlier on `full-backend-transition`; consumed by
  the WS-B work above (matrix `probeServer`, `account-link.store`,
  `discovery.store`).

## 7. Next

1. **WS-0 Foundation** — ✅ built, done-pending-verify (Liz review + Chris's
   spec §13 manual verification on a dev build).
2. **WS-B + WS-E** (onboarding un-gate + step-up) — ✅ built on the branch,
   awaiting Larissa + Laura audits and squash; produces linked accounts to
   exercise the rest.
3. **WS-A** proxy client — the next spec session.
4. **WS-C** sync engine (its own multi-step effort; Larissa + Laura).
5. **WS-D** blob client (rides on C; the deferrable tail).
6. Turnkey gate → merge to master → hand off to the separate go-live event.
- **WS-B + WS-E BUILDING remotely** — spec
  `superpowers/specs/2026-07-02-ws-b-e-onboarding-and-step-up-design.md` (v2,
  Laura-passed), plan
  `superpowers/plans/2026-07-02-ws-b-e-onboarding-and-step-up.md` handed to an
  overnight worker; PR to this branch expected. Integration pipeline on
  arrival: Liz review → Larissa (auth-service + crypto touched) → Laura →
  merge.
- **WS-A / WS-C / WS-D fully specced and planned (2026-07-02 evening):**
  - WS-A: spec `…ws-a-proxy-client-design.md` (v2, Laura-passed) + plan
    `…ws-a-proxy-client.md`. Open decision 1 RESOLVED: linking is the
    prerequisite for proxy egress, no legacy escape hatch. Found + pinned:
    browser fetch cannot read a proxied 3xx's Location — client re-issue
    (server spec §5.3) is impossible; terminal constructive error + a
    server-side 3xx-envelope follow-up registered for go-live.
  - WS-C: spec `…ws-c-sync-engine-design.md` (**v2** — Larissa spec-pass
    H-1/M-1–M-8/L-1–L-7/I-1–I-5 + Laura 2-hard/7-soft folded) + plan
    `…ws-c-sync-engine.md` (16 tasks). Open decision 2 RESOLVED (staging
    pattern, reference corrected). Chris decisions: trash internal-only v1,
    minimal status line (enriched vocabulary), Dexie v33 confirmed, offline
    bookmarking stays Class 2 with gentle copy.
  - WS-D: spec `…ws-d-blob-client-design.md` (**v2** — Larissa M-1–M-4/
    L-1–L-5/I-1–I-3 + Laura 1-hard/5-soft folded) + plan
    `…ws-d-blob-client.md`. Chris decisions: simple fetch strategy (eager
    thumbs/avatars, lazy originals), quota in the status line.
  - Spec-pass auditor models this sprint: Larissa as Fable, Laura on Opus 4.8
    (Chris 2026-07-02).

## 7. Next

1. **WS-0** — built; Chris's spec §13 manual verification on a dev build
   still owed.
2. **WS-B + WS-E** — remote build in flight → integrate on PR arrival
   (Liz review, Larissa, Laura, merge).
3. **Hand off the remaining plans SEQUENTIALLY: A → C → D**, each cutting
   from the branch tip after the previous PR merges. A and C both touch
   `send-message.ts`/`stream-engine.ts`/settings routes (A removes corsProxy
   threading, C adds enqueue calls) — parallel runs would manufacture
   integration conflicts. D's STOP-guard requires C landed.
4. Post-build per workstream: Liz review → Larissa re-audit of the built
   diff (A: token-attach path light; C: full zero-knowledge boundary; D:
   blob-transport/repair) → Laura pre-squash → merge to this branch.
5. Weekend: device testing (the specs' §-manual-verification lists),
   bugfixing, polish.
6. Turnkey gate → merge to master → hand off to the separate go-live event
   (which now also owns: the proxy 3xx JSON-envelope follow-up, the
   shared-proxy-retired cut message — a REQUIRED artefact coupled to WS-A).

## 8. Pointers

- Backend contracts (the client seams live in each spec's "§ client engine" +
  "scope boundary" sections):
  - Proxy: `superpowers/specs/2026-07-01-authenticated-cors-proxy-design.md`
    (§7 discovery, §12 seam)
  - Sync: `superpowers/specs/2026-07-01-client-sync-design.md`
    (§11 discovery, §12 client engine, §16 seam)
  - Blob: `superpowers/specs/2026-07-02-blob-transport-and-deployment-docs-design.md`
    (§11 dispositions, §12 client engine, §16 seam)
- Server-side status + owed re-audits: [[STATUS-BACKEND]]
- Client feature history: [[STATUS-CLIENT-ONLY]]
- Future-feature couplings register (Dexie-version ownership): [[insights/future-feature-couplings]]
- Roadmap / ADR 0031: [[ROADMAP]]
