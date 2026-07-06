# Morning merge checklist — tombstone throttle + universal trashcan

Companion to `2026-07-04-trashcan-and-tombstone-throttle.md` (plan) and
`../specs/2026-07-04-trashcan-and-tombstone-throttle-design.md` (spec). Run this
after the overnight worker reports back, before integrating to `master`.

## 0. Take stock

- [ ] Pull the worker's branch and read its hand-off report.
- [ ] `git -C <worktree> log --oneline master..HEAD` — confirm ~15 task commits on
      top of `da295c54` (the overnight-contract commit).
- [ ] Re-run the gate yourself, do not just trust the report:
  - [ ] repo root: `pnpm typecheck --force` → `14 successful, 14 total`.
  - [ ] repo root: `pnpm run build` → success.
  - [ ] `apps/user-client/`: `pnpm vitest run` → ONLY the 8 known Node-localStorage
        baseline failures (6× `cockpit-draft.test.ts`, 1× `chat-page.test.tsx`
        lazy, 1× `chat-route.test.tsx` lazy). A 9th, or any `tests/sync|trash|boot`
        failure, is a real regression — send it back before merging.

## 1. Audit gates (both OWED — the worker could not summon them)

- [ ] **Larissa (security, sync/trash diff).** Summon with the absolute worktree
      path. Focus: durable dead-key H-1 anchor survives purge+restore; the
      `restoredFrom` marker stays inside the sealed payload (server-blind); restore
      is a single Dexie transaction; purge never sweeps the outbox; the throttle
      watermark rule is M-7-safe (page sorted ascending, `lowestDeferredRev − 1`
      hold, page-break at cap). Fix Critical/High before squash; log conscious
      deferrals in `security-deferrals.md`.
- [ ] **Laura (UX, the new surface + delete flow).** Focus: "Recently deleted" in
      My Account beside Recovery Key; card-per-restore-unit with folded children;
      delete-time toast (Undo + "Delete permanently"); purge confirm names the
      cascade counts; "Restored." framing; empty state. Fix hard defects before
      squash; log deferrals in `ux-deferrals.md` (the live-back-reference limit).

## 2. Manual on-device verification (spec §8)

Two browsers linked to the same account (the two-browser setup from the test that
started this).

- [ ] **A. Chat delete + fast Undo + restore.** Delete a chat (its persona live) →
      a calm toast "Moved to Recently deleted · recoverable for 30 days" with Undo
      appears. Tap **Undo** at once → the chat returns with its ORIGINAL id,
      messages intact (identity-preserving fast path). Delete it again, let the
      toast pass → My Account → Recently deleted → **Restore** → the chat is back
      (a new id this time), messages intact, and it appears on the other browser.
- [ ] **B. Parent gate + cascade restore.** Delete a chat, then delete its persona.
      In Recently deleted, the chat has **no own card** — it is folded under the
      persona card (a count). Restore the persona → persona + its chat + messages
      all return in one action.
- [ ] **C. Permanent delete.** Delete something and choose **"Delete permanently"**
      → it never appears in Recently deleted; the deletion still propagates to the
      other browser.
- [ ] **D. Throttle (the original bug).** Mass-delete a lot (> 200 items in a
      cycle) on browser 1. On browser 2: the removals drain over several sync
      cycles with **no stuck "…paused for safety" banner** (that state is gone),
      **nothing is lost**, and the removed items all land in browser 2's Recently
      deleted. The calm "N items removed · recoverable for 30 days" notice appears
      and later clears on its own.
- [ ] **E. Cross-device restore de-dup.** Restore an item on browser 1 → after
      browser 2 next syncs, that item's card **disappears** from browser 2's
      Recently deleted (it no longer offers to restore what A already restored).
- [ ] **F. Purge cascade.** "Delete now completely" on a persona card → it and all
      its descendants vanish from Recently deleted. (The durable dead-key that
      keeps H-1 safe after purge is covered by the Task 4/15 tests — no manual
      malicious-server step needed.)
- [ ] **G. Document.** Delete a document → Recently deleted → Restore under its
      live library.

## 3. Integrate

- [ ] Both audits clean (or deferrals consciously logged), all manual steps pass.
- [ ] Squash per feature unit (throttle and trashcan are natural units — consider
      two squashed commits: Phase 1, then Phase 2), onto `master` via the throwaway
      master-worktree flow (never switch the contested main tree's branch).
- [ ] Confirm the STATUS-TRANSITION entry the worker wrote is accurate; adjust if
      needed.
- [ ] Push.
