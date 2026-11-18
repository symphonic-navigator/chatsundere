# Back means one thing — implementation plan

**Spec:** `superpowers/specs/2026-11-18-back-means-one-thing-design.md` (approved by Chris, 2026-11-18)
**Branch:** `feat/050-back-means-one-thing` · **Package:** `apps/user-client` · **Larissa paths:** none

Discipline for every task: write the test first, run it and see it fail for the expected reason, write the code, run it green, then run the package's typecheck. After each task a reviewer subagent checks the diff against the spec section named in the task. Layer one and layer two are committed separately, layer two after layer one.

## Architecture

- `src/lib/nav-trail.ts`, pure: `nextTrail(prev, nav)` (push/replace/pop rules, 50-entry cap, the `idx` cut) and `findReturnDepth(trail, pathname)`.
- `src/state/nav-trail.store.ts`: an in-memory map `location.key → trail`, the last tracked location, and the reset state (`target`, `deadline`).
- `src/components/NavTrailTracker.tsx`, mounted once in `Root`: records the trail during render (idempotent, keyed by `location.key`, so pages' own mount effects already see it), mirrors it into `window.history.state.csTrail` in a layout effect (only when `history.state.key === location.key`, i.e. under `BrowserRouter`), and finishes a running `resetTo`.
- `src/lib/use-app-nav.ts`: `useAppNav()` returns `{ back, returnTo, resetTo }` plus `trail()`.
- Reading on a cold `POP`: the map first, then `window.history.state.csTrail` when its `key` matches, else `[]`. `idx` comes from `window.history.state.idx` when its `key` matches, else `null` (MemoryRouter in tests: `resetTo` unwinds by the trail length).

## Layer one — the way back

1. **Trail reducer and depth search** (`lib/nav-trail.ts`). Tests: push appends the previous pathname, replace inherits, pop with/without a stamp, the 50 cap, the `idx` cut, `findReturnDepth` hit at depth 1 and 2, miss.
2. **Store, tracker, `useAppNav` (`back`, `returnTo`)**. Tests in a `MemoryRouter` harness with the tracker: `back` pops with a trail and replaces with the fallback without one; `returnTo` pops 1 and 2 and replaces on a miss; reading the stamp from `window.history.state` on a cold pop; the tracker mirrors into `history.state` under `BrowserRouter`. The Hall miss in `returnTo` replaces in layer one.
3. **PageBar, PageScaffold**. `‹` → `back(props.back)`, crumbs → `returnTo`; the interceptor receives the move; the dirty-guard confirm runs the move; JSDoc of `back` says fallback. Update the existing PageBar and dirty-guard tests to the new contract (tests first).
4. **Route journey tests** (`tests/routes/back-journeys.test.tsx`) with a `BrowserRouter` over jsdom's history, the tracker and small stand-in pages using the real `PageScaffold`: J1 with the crumb variant, J6 (cold start), the dirty-guard confirm, and system Back (`history.back()`) landing where `‹` did.
5. **Call sites, save/create/delete/home** (spec "What changes where" items 3–7, 9, 11): provider save, knowledge document save and delete, treasury template save and delete, the integration server's back, create-then-show replaces (persona, library, integration server, Chatsune import when on the create page), library delete, project tree delete, brand logo and the chat's Hall exit (`returnTo('/app')`), the persona hub's crumb, post-unlock return in `routes/login/index.tsx` (navigation calls only), the wizards' Back links, the missing-chat guard's `back()`. Each with a test where a test file already covers that page; otherwise covered by item 4's harness.
6. **#56 and #57 follow-ups**, after they are merged into `master` and `master` is merged here: `goHistory()`'s directly-behind check reads the trail; route test Roleplay → Model behaviour → `‹` → Roleplay. If either is not merged when the build ends, report it as waiting.

Commit layer one.

## Layer two — clearing the way back

7. **`resetTo`** with the curtain and the 400 ms bound. Tests: unwinds and replaces; with `idx` known, unwinds by `idx` (entries without a stamp are cleared); the timeout path replaces the current entry, lifts the curtain and ignores a late pop; `NavTransitionOutlet` renders nothing while resetting. The Hall miss in `returnTo` switches to `resetTo('/app')`.
8. **Sign-out, first run, panic**: `logout.tsx`, the first-run completions (spec item 10), `nsfw-panic.ts` (navigate becomes `resetTo`, and it also resets when an adult chat is in the trail).
9. **Recovery-key point of no return**: invitation routes replace themselves with the reveal while `invitation_recovery` is set; the local wizard's reveal moves into the onboarding store (`local_recovery`), and `/onboarding` and `/onboarding/local` show it while set; Continue clears and resets/returns. Tests for both journeys.
10. **Adult-chat guard** around `/app/chat/:chatId` and its sub-pages in `App.tsx`. Tests: an adult chat in `sfw` never paints and resets to the Hall with the toast; with the persona cached, in either mode, the chat's content is in the first render; flipping the mode while open resets.

Commit layer two.

## Gates and finish

- `pnpm test`, `pnpm typecheck`, `pnpm run build`, Biome (`pnpm lint` or `pnpm exec biome check`).
- A whole-branch review subagent; Laura's pre-squash pass; fix, re-run gates.
- Merge `master` (and whatever of #56, #57, #58, #60 is in it), re-run gates, make sure the last commit is not `[skip ci]`, mark PR #61 ready, report to the coordinator.
