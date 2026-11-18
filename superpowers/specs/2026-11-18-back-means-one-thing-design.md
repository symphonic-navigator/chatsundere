# Back means one thing — design

**Date:** 2026-11-18 · **Target:** 0.5.0 on `master` · **Branch:** `feat/050-back-means-one-thing` (based on `feat/050-papercuts`, PR #58) · **Size:** one unit, one squash · **Larissa paths:** not touched

## Why

Laura's holistic sweep of 2026-11-18 found a hard defect, confirmed in the code: the `‹` in the page bar **pushes** a fixed parent route (`components/ui/PageBar.tsx`, `go(back)` is a plain `navigate`), while the phone's own Back **pops** the history. The same push happens in the dirty-guard confirm (`PageScaffold.tsx:72`), after saving a provider (`routes/app/settings/provider.tsx:98`) and after creating a persona (`routes/app/persona/create.tsx:173`). So:

- after Hall → Settings → AI Providers and `‹ ‹` back to the Hall, Android Back opens Settings, then AI Providers, then Settings again;
- leaving the app means unwinding every page ever visited;
- after creating a persona, Back reopens the empty New-persona form;
- after the NSFW panic (`lib/nsfw-panic.ts:43`, a push to `/app`), Back reopens the adult chat that was just closed.

0.5.0 is the last large release before Eidolon and has to carry users for a long time (Chris, 2026-11-18). Back is touched on every page, every day; it has to be right.

## Goals

- `‹` and the system Back (Android button or gesture, browser button, iOS edge swipe) do the same thing whenever the app has a page behind the current one.
- Going up (a crumb, "Home", a save that leaves, the end of a flow) never grows the history: it unwinds to the page if it is behind, else it replaces.
- Leaving the app from the Hall takes one Back.
- Back never leads into a signed-out, half-done or just-hidden state.
- One answer to "where does Back go", shared by the `?return=` convention of the papercut unit and the History return of the chat-search unit.

## Non-goals

- **Back closing an open overlay** (help reader, quick menu, dialogs, sheets). Today the system Back leaves the page under an open overlay. Making each overlay own a history entry touches every overlay; it is a unit of its own (open question Q3).
- **A router-level guard for unsaved edits** on the system Back. The deferral of 2026-10-09 in `ux-deferrals.md` stays open: `useBlocker` needs a data router (`createBrowserRouter`), and moving `App.tsx` off `<BrowserRouter>` is a migration, not a fix (see "Unsaved edits").
- Moving or restyling the page bar, crumbs or `‹` (the thumb pass's area).
- Anything Eidolon rebuilds: Projects, memory, knowledge editing, the tool loop. Their pages get the new `‹` through the shared `PageBar` and their own Back calls (a save or delete that leaves), nothing else.
- `routes/app/integrations/**` and `tools/**` beyond their Back calls (a sibling unit builds there).

## Anti-goals

- **No content in the URL or in storage keys.** The stamp lives in `history.state` only, and holds route pathnames (which are already in the URL), never search text, queries or titles. This is the hard constraint of the chat-search unit, and it holds here.
- No second return convention. `?return=` through `safeReturnPath` stays the only one; this unit makes it a fallback, not a rival.
- No change to the page-transition motion beyond what the new history moves cause (see "Motion").

## The model, as a user would read it

> **`‹` takes you back to where you were, exactly like your phone's Back.** If you arrived on a page from nowhere (a link, a bookmark, a fresh start), `‹` takes you up to the page above it instead, so it never throws you out of the app. **A crumb takes you up** to that place; if you came through it, you go back to it, so the way back stays short. When you finish something (save a provider, create a persona, sign in), the app takes you back to where you started, and the finished form is gone from Back. Signing out, the adult-mode switch and the end of the first run clear the way back, so Back can never show what you just closed.

Why they agree: `‹` *is* a history step whenever there is a step to take, and every other move is either a new page (forward, one step deeper) or a return (unwind, never a new entry). Going up and finishing therefore never create loops in the history (a forward link may still revisit a page, which is honest chronology), and the phone's Back walks the same path the `‹` walks.

## How the app knows where it came from

### The trail stamp

Every history entry the app creates gets a **trail**: the pathnames of the in-app entries behind it, oldest first, at most 50. It is written into the entry's `history.state` under a key of its own (`csTrail`), next to React Router's `usr`, `key` and `idx`, so `location.state` and every page that reads it are untouched.

One component, `NavTrailTracker`, mounted once inside `<BrowserRouter>` (in `Root`), keeps it. On every location change, by navigation type:

| Navigation | Trail of the new entry |
|---|---|
| `PUSH` | trail of the previous entry + the previous pathname |
| `REPLACE` | trail of the replaced entry (inherited) |
| `POP` (Back, Forward, swipe, a `go(-n)`, a reload, a cold start) | read from the entry's `history.state`; none there → empty |

Sanity rule: a trail is never longer than React Router's `idx` for the entry (cut from the front if it is), so the app can never believe in more in-app entries than the tab has.

Central stamping means no call site has to remember it: plain `<Link>`s, `useNavZoom`, `navigate()` and `setSearchParams` are all covered. Laura's suggestion of stamping at `useNavZoom` and the call sites is kept in spirit, done in one place.

### Three moves (new hook `useAppNav()`, `lib/nav-trail.ts`)

| Move | Rule | Used by |
|---|---|---|
| `back(fallback)` | trail not empty → `navigate(-1)`; empty → `navigate(fallback, { replace: true })` | `‹`, save-then-leave, cancel-then-leave |
| `returnTo(target)` | the nearest entry behind whose pathname is `target`'s → `navigate(-k)`; none → `navigate(target, { replace: true })`, except for the Hall (`/app`), the root, where a miss runs `resetTo('/app')` so Back from the Hall always leaves | crumbs, "Home" (brand logo, the chat's exit to the Hall), the end of an in-session flow (post-unlock return, the server-linking wizard), a delete that leaves its page |
| `resetTo(target)` | unwind to the document's first entry by React Router's `idx` (`navigate(-idx)`; `idx` is exact for the current document and 0 on its first entry, so it never crosses into another site, and it covers entries without a stamp), then replace that first entry with `target`, behind a curtain | sign-out, the end of the first run (onboarding, pairing, local account), the NSFW panic |

The **fallback** of `back` is the page's existing `back` prop, which already reads `?return=` where the papercut unit added it: `safeReturnPath(search.get('return'), <parent>)`. So the one answer is:

> **Back goes to the entry behind, if there is one in the app; else to `?return=`, if valid; else to the page's parent.**

The `?return=` links stay as they are. They now matter only when the history is gone (a cold start on a copied link, a killed PWA that reopens at a URL), and they still guard every sink against open redirects.

Matching is by pathname, not search: popping back to an entry restores its own search and `location.state` (a History query, a filter, a `?return=`), which is more faithful than rebuilding them.

The **curtain** of `resetTo`: while the unwind runs, `NavTransitionOutlet` renders nothing (the brand bar stays), so the first entry, which may be the chat the panic just closed, is never painted. The curtain lifts on the replace.

**`resetTo` never leaves a blank page** (coordinator's review). A traversal is asynchronous and may not arrive: `history.go(-n)` is least trustworthy in an installed iOS PWA, an `idx` may not match the real stack, a bfcache restore may swallow the `popstate`. So the unwind has a bounded wait of **400 ms**. If the location has not landed on the first entry by then, `resetTo` replaces the *current* entry with the target, lifts the curtain and stops waiting (a late `popstate` after that is ignored by the reset). What is then left behind is the pages the unwind did not clear. That is still safe:

- **after sign-out**, every app page behind re-checks the session (`ProtectedRoute`), so Back lands on Login, never on content;
- **after the panic**, every adult chat and its sub-pages re-check the adult mode (the Q2 guard), so Back lands on the Hall, never on the chat;
- **after the first run**, the onboarding routes behind are covered by the recovery-key rule and, past it, show their own first step with a live session, which is the pre-existing state (no key is lost).

The one cost is that leaving the app may then take more than one Back. The timeout path has its own test and its own manual step (SI). If the unwind arrives late after all (within 2 s), a landing on the first entry is still replaced with the target.

**Every step back has the same bound** (Laura's pre-squash pass, hard defect). `back` and a `returnTo` that finds its page behind wait the same 400 ms for a new page; if none shows (a lost traversal, or iOS reopening a URL with its `history.state` but without its history), they replace with the fallback or the target instead. So `‹` is never dead, least of all in the installed iPhone app where it is the only Back. A second move from the same page within a second (a double tap, an effect run twice) is ignored, so one tap never skips a page.

### Surviving the awkward cases

| Case | What happens |
|---|---|
| **Reload** (browser, SW update) | `history.state` survives a reload in every browser, so the trail does; `‹` keeps popping. |
| **Cold start on a deep link**, nothing behind | Trail empty: `‹` replaces with the parent, step by step up to the Hall; from the Hall, Back leaves the app. Never an exit from a deep page by `‹`. |
| **Installed PWA, Android, killed and relaunched** | Opens fresh at the start URL: empty trail, as a cold start. |
| **Installed PWA, iOS** (no browser Back) | `‹` is the only Back; it walks the trail. When iOS restores the last URL without its history, the trail is empty and `‹` goes up. |
| **iOS edge swipe** (Safari, and installed where iOS offers it) | It is a `POP`, so it walks the same path as `‹`. |
| **A different document behind** (after an OAuth round trip, after the device wipe's `location.assign`) | The first entry of the new document has no stamp: trail empty, `‹` goes up within the app. The system Back still goes to the provider's page; the app cannot remove other sites' entries (known limit, see below). |
| **An entry from before this release** (a tab or PWA kept open across the update) | No stamp: treated as empty, so `‹` goes up. `resetTo` unwinds by `idx`, not by the trail, so sign-out and the panic still clear these entries on update day. |

## What changes where

1. **`PageBar`**: `‹` calls `back(props.back)`; the prop's JSDoc (and the component's) says it is the fallback when nothing is behind, not where `‹` always goes; an ancestor crumb calls `returnTo(crumb.to)`. The `onNavigate` interceptor receives the move, not a path (`{ kind: 'back' } | { kind: 'to', to }`), so a guard can run the same move after its confirm.
2. **`PageScaffold`**: the discard confirm runs the pending move (today it pushes the path, `PageScaffold.tsx:72`).
3. **Save-then-leave and cancel-then-leave** call `back(<the page's back>)`: the provider page (`provider.tsx:98`), the knowledge document (`document.tsx:141`), the treasury template (`template.tsx:143`), the integration server page's back (`server.tsx:329`, Back only).
4. **Create-then-show replaces** the form: a new persona (`create.tsx:173`), a Chatsune import landing on the hub (`ChatsuneImportControl.tsx:73` when it runs on the New-persona page), a new knowledge library (`library.tsx:109`), a new integration server (`server.tsx:191`, Back only).
5. **Deletes that leave their page** call `returnTo(<list>)`. A deleted persona's chats can still sit behind (Hall, Chat, Circle after a crumb, then the persona deleted in My Circle): the chat page's missing-chat guard (`chat-page.tsx:186`, today a replace with History) calls `back()` again when the trail is not empty, so `‹` on My Circle skips the orphan and lands on the Hall; with nothing behind it replaces with History as today. (`library.tsx:320`, `document.tsx:308`, `template.tsx:379`, `tree.tsx:200`, `server.tsx:187` and `sign-in.tsx:44` Back only).
6. **Home**: the brand logo (`root.tsx:168`, today a push to `/` that the Gate replaces with `/app`) and the chat's exit to the Hall (`chat-page.tsx:580`) call `returnTo('/app')`.
7. **The persona hub**: its "My Circle" crumb always means My Circle (`returnTo('/app/circle')`), and `‹` keeps going where the user came from. Today the crumb carries `returnPath`, so after a quick-menu visit it leads to the chat (papercut session's Laura finding). The ledger's "thread `?return=` through the Hub's NavTiles and each sub-page back" is **subsumed**: a sub-page's `‹` now pops to the hub, which still holds its own `?return=`.
8. **Roleplay → Model behaviour** (PR #57's new link, not in this base): nothing to add. The link pushes, so Model behaviour's `‹` pops back to Roleplay. The `?return=` proposed in #57 is not needed. A route test for the journey lands with this unit after #57 is merged into `master`; if #57 merges after this unit, its session adds the test instead (the coordinator decides the order).
9. **Post-unlock return** (`routes/login/index.tsx:196, 276, 362`; in that file this unit changes only these navigation calls, because the papercut unit and the passkey fix of #60 also edit it, and the merge order is #58, #60, then this unit) and the invitation wizard's end when started from Server linking (`confirm.tsx:241`, `recovery-reveal.tsx:20` with a `?return=`) call `returnTo(target)`: re-entering a passphrase from a page pops back to it instead of stacking a copy.
10. **The first run** (see also "The recovery-key reveal" below) (`onboarding/invitation/confirm.tsx:241` without a `?return=`, `recovery-reveal.tsx:31`, `pairing/confirm.tsx:128`, `onboarding/local/index.tsx:71`, `onboarding/recovery.tsx:122`, `join.tsx:55`, `login/recovery.tsx:225, 258`) calls `resetTo('/app')`: the wizard's steps are gone from Back.
11. **The wizards' own Back links** (`aria-label="Back"` `<Link>`s in `routes/onboarding/**` and `routes/login/**`) call `back(<their current to>)`, so they pop like everywhere else.
12. **Sign-out** (`logout.tsx:51`) calls `resetTo('/login')`. The device wipe keeps its full-page `location.assign`; the data behind it is gone.
13. **The NSFW panic** calls `resetTo('/app')` (the `navigate` argument becomes the `resetTo`). And see the adult-chat guard below.
14. **History return** (PR #56's `lib/history-return.ts`, not in this base): the mechanism **sits beside it** and replaces one check. `goHistory()` decides "a step back" by comparing React Router's `idx` with a memory-only target, so after a reload the quick menu's History opens a fresh visit. After #56 is merged, its check becomes "is `/app/history` the entry directly behind?" read from the trail, which survives a reload; popping restores History's own `location.state` (query, scroll), which already lives in `history.state` and never in the URL or a storage key. The memory-only return target, the search cache and the generation token stay as they are. The deferral (killed PWA relaunched in a chat) closes for a reload; after a kill the history is gone and a fresh visit is the honest answer. Applied in this unit if #56 is merged first, else handed to the coordinator as a two-line follow-up.

### The recovery-key reveal is a point of no return

Laura's spec-pass found that `form.tsx:77` pushes the confirm step and `confirm.tsx:281` *replaces* it with the reveal after `activateSession` has run, so during the reveal the stack is Welcome, Invitation form, **Recovery**. One system Back pops to an empty invitation form with a live session and a spent token, and on Android there is no Forward back to the key, which is shown only once. The local wizard (`onboarding/local/index.tsx`, one route, the key in component state) has the same exposure: Back leaves the route mid-reveal with the account created.

Rule: **while a recovery key is waiting to be acknowledged, every onboarding route replaces itself with the reveal.**

- Invitation: Welcome (`/onboarding`), the invitation form, scan and confirm check `useOnboardingStore`; while `state.kind === 'invitation_recovery'` they replace themselves with `/onboarding/invitation/recovery` (keeping its `?return=`). Back from the reveal therefore lands on the reveal again; the ways out are "Continue" or leaving the app.
- Local: the wizard moves its reveal into the same store (a new `local_recovery` state with the key, memory only, as `invitation_recovery` holds it today), and `/onboarding` and `/onboarding/local` show the reveal while it is set.
- "Continue" clears the state and then runs `resetTo('/app')` (first run) or `returnTo(<return>)` (from Server linking).
- Pairing has no reveal (the recovery key already exists) and needs nothing.
- Found while building: the sign-in recovery (`login/recovery.tsx`, step 3) shows a newly generated key the same way, so it is held by the same rule (`local_recovery` with `at: '/login/recovery'`).

### The adult-chat guard (open question Q2)

The panic pushes the user out, but nothing stops a Forward, a reload of a stale tab or a chat sub-page (Bookmarks, Artefacts, Knowledge of an adult chat, where `nsfwPanic` does not act because no chat page is mounted) from showing an adult chat in SFW mode. Proposal: a small guard on `/app/chat/:chatId` and its sub-pages. It renders nothing until the chat's persona is read (the flag comes from an async Dexie read, so the chat must not paint for a frame first). When the persona is an adult persona and Adult Mode is `sfw`, it runs `resetTo('/app')` with the panic's toast, both on arrival and when the mode flips while the page is open; a plain replace would leave "Hall, Hall" and make Back from the Hall look dead. The panic itself also runs `resetTo('/app')` when an adult chat's `/app/chat/:id` is anywhere in the trail, not only when the chat is mounted, so an adult persona's hub or Roleplay page reached from its chat is cleared as well. **The guard must not slow an ordinary chat.** It defers rendering only while it does not yet know the chat's persona. For a chat whose persona is already in the query cache (the normal case: the Hall, History and My Circle load it), the flag is known on the first render and nothing is deferred. In adult mode (`nsfw`) the guard has nothing to check and renders at once, and for a non-adult persona it renders as soon as the persona is known, the same moment the chat page itself can render it today. So no chat opens later than today. Pinned by a test: with the persona cached, in either mode, the chat's content is in the first render. Persona pages are left as they are (My Circle shows adult personas in SFW with their badge today; changing that is a design question, not Back).

## Two layers, built and reverted separately

This unit touches every page in a release that has to carry users for a long time, so it is built in two layers, each in its own commits, layer two after layer one. If Chris's device test fails on something in layer two, it can be reverted without losing layer one.

- **Layer one — the way back.** The trail stamp and `NavTrailTracker`, `back`, `returnTo` (including the Hall miss, which then replaces until layer two adds `resetTo`), the page bar and crumbs, the dirty-guard confirm, save-then-leave, create-then-show, deletes, Home, the persona hub's crumb, the post-unlock and Server-linking returns, the wizards' Back links, the missing-chat guard's `back()`, the History check of #56 and the Roleplay test of #57. (What changes where: items 1–9, 11, 14.)
- **Layer two — clearing the way back.** `resetTo` with its curtain and timeout, the Hall miss switched to `resetTo`, sign-out, the end of the first run, the NSFW panic, the recovery-key point of no return, and the adult-chat guard. (Items 10, 12, 13 and the two sections after the list.)

Manual steps by layer: **layer one** 1–13, 15, 18, 19; **layer two** 4 (its Back-leaves check, with the Hall reached by a miss), 14, 16, 16b, 17, 20, 21.

## Journeys (the history before and after each step)

Notation: entries oldest first, the current one in **bold**, `›…` the forward entries a pop leaves behind (unreachable without a Forward button; harmless). "Today" is the stack the current code produces.

### J1 — Hall → Settings → AI Providers → a provider → Save

| Step | After |
|---|---|
| start | **Hall** |
| tap My Settings | Hall, **Settings** |
| tap AI Providers | Hall, Settings, **Providers** |
| tap OpenRouter | Hall, Settings, Providers, **Provider** |
| Save | Hall, Settings, **Providers** ›Provider *(today: …, Provider, **Providers**)* |
| `‹` | Hall, **Settings** ›… *(today: …, Providers, **Settings**)* |
| `‹` | **Hall** ›… *(today: a seventh entry)* |
| system Back | leaves the app *(today: Settings, then Providers, …)* |

Variant, crumb from the provider page: tap "My Settings" → `returnTo` pops two entries → Hall, **Settings**.

### J2 — Create a persona

| Step | After |
|---|---|
| Hall → My Circle | Hall, **Circle** |
| New persona | Hall, Circle, **New** |
| Create | Hall, Circle, **Hub (new)** *(replaces New; today: …, New, **Hub**)* |
| `‹` / Back | Hall, **Circle** *(today: the empty form)* |

### J3 — Chat → quick menu → persona hub → sub-page → back to the chat

| Step | After |
|---|---|
| Hall → chat | Hall, **Chat** |
| quick menu → the persona | Hall, Chat, **Hub ?return=chat** |
| tile Roleplay | Hall, Chat, Hub, **Roleplay** |
| (after #57) link Model behaviour | Hall, Chat, Hub, Roleplay, **Model** |
| `‹` | …, Hub, **Roleplay** *(today, with #57: Hub)* |
| `‹` | Hall, Chat, **Hub** |
| `‹` / Back | Hall, **Chat** |

Variant, the hub's "My Circle" crumb: My Circle is not behind, so it replaces → Hall, Chat, **Circle**; then `‹` / Back → Hall, **Chat** *(today: the crumb leads to the chat)*.

### J4 — A repair link out of the chat and home again

| Step | After |
|---|---|
| in a chat, a send fails, tap "Re-enter key" | Hall, Chat, **Provider ?return=chat&focus=key** |
| Save | Hall, **Chat** ›Provider *(today: Hall, Chat, Provider, **Chat**)* |
| Back | **Hall** |

Same with Settings → Voice from the cockpit, Expert from the cockpit, and Model behaviour from the persona greeting: one step out, one step home.

### J5 — History → chat → Back (after #56)

| Step | After |
|---|---|
| Hall → History, search "lantern" | Hall, **History** (query in its `history.state`) |
| tap a hit | Hall, History, **Chat ?focus=…** |
| Back, `‹`-less chat: quick menu → History | Hall, **History**, query and scroll restored |
| variant: reload in the chat first, then quick menu → History | the same (today: a fresh History visit) |
| variant: installed PWA killed, relaunched at the chat | **Chat** alone; quick menu → History opens a fresh visit (no history exists) |

### J6 — A cold start on a deep link

| Step | After |
|---|---|
| open a copied link to a provider page | **Provider** (empty trail) |
| `‹` | **Providers** (replaced) |
| `‹` | **Settings** (replaced) |
| `‹` | **Hall** (replaced) |
| Back | leaves the app |

### J7 — Onboarding, login, re-entering a passphrase

| Journey | After |
|---|---|
| first run: Welcome → Invitation → Confirm | Welcome, Invitation, **Recovery** (confirm replaced by the reveal, as today) |
| on the reveal, system Back | Welcome, **Invitation** → replaces itself with **Recovery** (the key is still shown; today: an empty form with a live session, the key gone) |
| Continue | **Hall** ›… (`resetTo`; today: Back re-enters the wizard with a live session) |
| local account: name → passphrase → reveal, system Back | **Welcome** → replaces itself with the local reveal (today: the key is gone) |
| from the Hall, Back | leaves the app |
| cold start, signed out: `/app/chat/x` → Gate → Login | **Login** (both redirects replace, as today) |
| unlock | **Chat x** (replaced) |
| signed in, Memory asks for the passphrase | …, Memory, **Login ?return=memory** |
| unlock | …, **Memory** ›Login *(today: …, Memory, Login, **Memory**)* |
| Account → Server linking → invitation wizard → done | …, Account, **Server linking** ›… |

### J8 — Sign out

| Step | After |
|---|---|
| Hall → Account → Sign out page → Sign out | **Login** ›… (`resetTo`; today: Hall, Account, Logout, **Login**) |
| Back | leaves the app *(today: each Back lands on the Login again through the guard, one press per page visited)* |
| Forward (desktop browser only) | an app page without a session → the existing guard → **Login** |

### J9 — The NSFW panic

| Step | After |
|---|---|
| Hall → My Circle → an adult chat | Hall, Circle, **Chat (adult)** |
| Adult Mode → SFW | **Hall** ›… behind the curtain, toast "Adult mode off — chat closed" *(today: Hall, Circle, Chat, **Hall**, and Back reopens the chat)* |
| Back | leaves the app |
| Forward, or a stale tab reloaded on the chat | the adult-chat guard (nothing painted) → `resetTo` → **Hall** with the toast (Q2) |
| Hall → adult chat → quick menu → persona → Roleplay, then Adult Mode → SFW | the chat is in the trail → **Hall** ›… (Q2) |
| on the adult chat's Bookmarks when the mode flips | **Hall** ›… (Q2; today: the page stays open) |

## Motion

`NavTransitionOutlet` keys its stage on the pathname and plays the origin-zoom collapse whenever the location arrives at the path the last tile was tapped on (`peekLast`), whatever the navigation type. So:

- **`‹` after a tile** (now a `POP`): the page collapses into the tile it came from, as the push does today.
- **A multi-step `returnTo`** (`go(-k)`): one traversal, one render, the collapse plays if the target is the tile's page, else a plain cut.
- **A fallback replace**: unchanged, as today's push.
- **`resetTo`**: no animation, the curtain.
- **iOS edge swipe**: Safari animates the swipe itself, and the collapse then plays as well (a double motion). That is today's behaviour for every swipe, not new. Left as it is; noted for the thumb pass.

The reduce-animations switch of #57 and `prefers-reduced-motion` keep acting on the CSS as before.

## Unsaved edits

The dirty guard (`PageScaffold` `dirty`) intercepts `‹` and the crumbs and now runs the same move after "Discard", so a guarded `‹` pops like an unguarded one. The system Back and the iOS swipe stay unguarded, as logged on 2026-10-09 in `ux-deferrals.md` (`beforeunload` covers reload and tab close). Solving it needs a data router for `useBlocker` (or a hand-made `popstate` trap that re-pushes an entry, which itself breaks "one Back, one thing"). That is not small, so it stays out; the deferral's text is updated to say that `‹` now matches the system Back everywhere except on a dirty page, where only `‹` asks. Once `‹` and Back are known to be the same, a system Back silently dropping an edit is a sharper surprise than today, so the ledger entry also records Laura's better route for the follow-up: keep the draft on unmount (restore it on return, or save as you go as the Projects tree does), which removes the need for a blocker altogether.

## Known limits

- After an OAuth sign-in round trip in the same tab, the provider's pages sit behind the app's landing entry. `‹` goes up within the app, the system Back goes to the provider. The app cannot remove another site's entries.
- Forward entries stay after a pop (a browser keeps them until the next push). They are reachable only with a Forward button and lead to pages that re-check the session and, with Q2, the adult mode.
- A chat whose persona was deleted can be popped back into; the chat page's existing guard replaces it with History, as today.
- Back with an open overlay leaves the page (Q3).

## Prompt-cache consistency

Nothing in this unit changes what is sent to any provider: it touches routing only.

## Tests

- **Pure trail reducer** (`lib/nav-trail.ts`): push, replace, pop with and without a stamp, the 50-entry cap, the `idx` cut.
- **Moves against a fake history port**: `back` with and without a trail, `returnTo` hit at depth 1 and 2 and miss, `resetTo` unwinds and replaces, never beyond `idx`, and its timeout path (the traversal never arrives: after 400 ms the current entry is replaced, the curtain lifts, a late `popstate` is ignored).
- **Adult-chat guard**: an adult chat in `sfw` is never painted; with the persona cached, in either mode, a chat's content is in the first render.
- **Route tests** with a real `BrowserRouter` over jsdom's `window.history`: J1 (including the crumb variant), J2, J3, J4, J6, J7 (the reveal rows, invitation and local), J8, J9 (including the guard rows and update day: entries without a stamp are cleared by `resetTo`) and the dirty-guard confirm, each asserting the stack after every step and that the system Back (`history.back()`) lands where `‹` landed.
- Tests are written first and seen failing (superpowers TDD, this unit's experiment).

## Audit gates

- **Laura**: spec-pass done on 2026-11-18: one hard defect (Back from the recovery-key reveal into a half-done wizard with the key gone), fixed in this spec ("The recovery-key reveal is a point of no return"); nine soft notes, all worked in (`resetTo` by `idx`, the guard's curtain and reset, Home on a miss resets, the orphaned chat after a persona delete, the wording on loops, the dirty-guard route for the ledger, Q3's priority, the `back` prop's JSDoc, the manual steps). She agrees with Q1 as written, Q2 with the amendment, Q3 with the quick menu first. A pre-squash pass on the built flows follows.
- **Larissa**: not required, no Larissa path is touched. `safeReturnPath` keeps guarding every `?return=` sink; the stamp holds only pathnames in `history.state`.

## Decisions (formerly the open questions)

**Decided by Chris, 2026-11-18** ("ja … sind alle in meinem Sinn"): Q1, Q2 and Q3 as recommended below — `‹` goes where you came from and the crumbs go up; the adult-chat guard is built; Back with an open overlay is deferred and logged with the quick menu first. The 400 ms bound on `resetTo`, the two layers and the guard's no-delay rule stand as written.

### The questions as they were put

- **Q1 — Does `‹` go where you came from, or always up to the parent?** Laura's sweep suggested: pop when the entry behind is the page's parent, else replace with the parent. That keeps `‹` meaning "up", but then `‹` and the system Back differ after every cross-link (Hall's setup card → AI Providers: `‹` goes to Settings, Back goes to the Hall). **Recommendation: `‹` goes where you came from** (this spec), with the parent only when nothing is behind, and the crumbs for "up". Reason: one Back, one thing, on every page, and it is what iOS and Android apps do with their own back arrow.
- **Q2 — Add the adult-chat guard?** **Recommendation: yes.** Reason: the panic's promise is "what was just hidden stays hidden", and today a Forward, a stale tab or a chat's Bookmarks page breaks it; the guard is a few lines on one route group.
- **Q3 — Back with an open overlay: leave it for a later unit?** **Recommendation: yes, log it in the ledger with the chat's quick menu first.** Reason: it touches every overlay (help, quick menu, dialogs, sheets) and is its own design (each overlay owning a history entry); this unit fixes the pages first. The quick menu goes first because Android Back with it open leaves the chat, the most frequent Back surprise that remains (Laura).

## Left to the builder

- Names and file layout of `NavTrailTracker`, `useAppNav` and the port; whether `useNavZoom` takes a `replace` option.
- The curtain's exact form (`NavTransitionOutlet` renders the stage empty while a reset runs).
- Any remaining plain `navigate` call that is a return in disguise, found while building, follows the three moves; list them in the report.

## Manual verification (Chris, on device)

Platforms: **AB** Android Chrome in the browser, **AI** Android installed PWA, **SB** iPhone Safari in the browser, **SI** iPhone installed PWA (no browser Back: use `‹`, and the edge swipe where iOS offers it). "System Back" means the Android Back button or gesture, the browser's Back, or the iOS edge swipe.

**Start condition for every step**, so that "the app closes" means what it says: AB and SB in a fresh tab with the app as its first page; AI and SI killed (swiped away) and relaunched.

1. **(AB, AI, SB, SI) Settings round trip.** Hall → My Settings → AI Providers → any provider. Tap `‹` three times. *Pass:* you are on the Hall. Then press system Back once (SI: skip). *Pass:* the app closes (AI: the home screen; AB, SB: the browser's new-tab page), not Settings.
2. **(AB, AI, SB, SI) Save leaves cleanly.** Hall → My Settings → AI Providers → a provider, re-save its key, tap Save. *Pass:* you are on AI Providers. Press system Back (SI: `‹`). *Pass:* My Settings, not the provider page.
3. **(AB, AI, SB, SI) Crumb goes up.** Open a provider page as in step 2, tap the "My Settings" crumb. *Pass:* My Settings. Then `‹`. *Pass:* the Hall.
4. **(AB, AI, SB, SI) Home logo.** Hall → My Settings → AI Providers → a provider, tap the "Chatsundere" logo in the brand bar. *Pass:* the Hall. Press system Back (SI: skip). *Pass:* the app closes.
5. **(AB, AI, SB, SI) New persona.** My Circle → New persona → a name → Create. On the new persona's page press system Back (SI: `‹`). *Pass:* My Circle, not the empty New-persona form.
6. **(AB, AI, SB, SI) Persona side trip from a chat.** In a chat open the quick menu → the persona → Roleplay. `‹`, `‹`. *Pass:* the persona page, then the chat. Repeat with system Back (SI: edge swipe, if offered). *Pass:* the same pages. On the persona page, tap the "My Circle" crumb. *Pass:* My Circle (not the chat); then `‹` returns to the chat.
7. **(AB, AI, SB, SI) Roleplay → Model behaviour** (once #57 is in). On a roleplay persona's Roleplay page tap "Model behaviour" in the note, then `‹`. *Pass:* Roleplay, not the persona page.
8. **(AB, AI, SB, SI) Repair trip.** In AI Providers remove the key of the provider a persona uses. Open that persona's chat from the Hall and send something; tap the note's link to the provider, enter the key, Save. *Pass:* back in the chat, the draft still there. Press system Back (SI: `‹` is not on the chat; skip). *Pass:* the Hall, not the provider page.
9. **(AB, AI, SB, SI) History and back** (once #56 is in). History → search a word → tap a hit → quick menu → History. *Pass:* the search and its results are as you left them. AB, SB: repeat, but pull to reload in the chat first. *Pass:* the same.
10. **(AB, SB) Deep link.** Copy the URL of a provider page, close the tab, open the URL in a new tab, unlock. Tap `‹` repeatedly. *Pass:* AI Providers, My Settings, the Hall, each once; then system Back leaves the app.
11. **(SI) Relaunch on a deep page.** Walk to a provider page, kill the app, relaunch. If iOS reopens on the provider page: `‹` repeatedly. *Pass:* AI Providers, My Settings, the Hall, each once, and no tap on `‹` ever does nothing (at most a short pause). If it opens on the Hall: pass.
12. **(AB, SB) Reload keeps the way back.** Hall → My Circle → a persona → Font & Voice, pull to reload. `‹` `‹` `‹`. *Pass:* the persona page, My Circle, the Hall. **(AI, SI)** the same walk without a reload. *Pass:* the same pages.
13. **(AB, AI, SB, SI) Delete leaves cleanly.** My Knowledge → a library → a document → Delete → confirm. *Pass:* the library, without the document. `‹`. *Pass:* My Knowledge; you never see the deleted document again.
14. **(AB, AI, SB, SI) Sign out.** Visit a few pages, then Account → Sign out → Sign out. On the Login screen press system Back (SI: skip). *Pass:* the app closes; no app page and no Login loop.
15. **(AB, SB) Unlocking returns to the page.** Signed out (Account → Sign out), open a copied link to a persona's Memory page in a new tab. *Pass:* the Login screen. Unlock. *Pass:* that Memory page. Press system Back. *Pass:* the app closes, not the Login screen. (Before #60 is in, there is a second trigger: sign in with your passkey and open a persona's Memory, which then asks for the passphrase; unlock, and Back goes to the persona page. Once #60 hands the master key to the session, Memory no longer asks, so the deep link is the trigger.)
16. **(AB, AI, SB, SI) First run and the recovery key** (a private window or fresh profile, with an invitation). Go through the invitation onboarding until the recovery key is shown. Press system Back (SB: edge swipe; SI: edge swipe if offered, else skip). *Pass:* the recovery key stays on screen. Tap Continue. *Pass:* the Hall. Press system Back (SI: skip). *Pass:* the app closes; you never see an onboarding step again. Repeat with "Create a local account" up to its recovery key and press system Back. *Pass:* the key stays. On the key, tap the Chatsundere logo. *Pass:* the key comes back, with "Save your recovery key, then Continue." Then Continue, then system Back (SI: skip). *Pass:* the app closes.
16b. **(AB, AI, SB, SI) A new key at sign-in** (a local-only account). Login → Forgot passphrase → recovery key → new passphrase with "generate a new recovery key" → on the new key press system Back (SI: edge swipe, else skip). *Pass:* the new key stays on screen. Continue. *Pass:* the Hall; system Back closes the app.
17. **(AB, AI, SB, SI) NSFW panic.** With Adult Mode on, open an adult persona's chat, switch Adult Mode off in the brand bar. *Pass:* the Hall with the toast "Adult mode off — chat closed", no flash of the chat. Press system Back (SI: skip). *Pass:* the app closes; the chat never reappears. With Q2: open that chat's Bookmarks with Adult Mode on, switch it off. *Pass:* the Hall with the toast. Then: adult chat → quick menu → its persona → Roleplay, switch Adult Mode off. *Pass:* the Hall; Back closes the app.
18. **(AB, AI, SB, SI) Unsaved edit.** Open a knowledge document, type something, tap `‹`. *Pass:* "Discard unsaved changes?"; "Discard" goes back one page (the library), "Keep editing" stays.
19. **(SB, SI) Edge swipe.** Repeat step 1's walk-in, then swipe from the left edge instead of `‹`. *Pass:* the same pages as with `‹`, one per swipe.
20. **(AB, AI) Update day.** Before installing this release, walk Hall → My Circle → a persona → Roleplay on the old build. Let the update arrive (the page reloads), then Account → Sign out. Press system Back. *Pass:* the app closes; none of the old pages come back.
21. **(SI) Reset when the unwind does not arrive.** In the installed iPhone app, walk Hall → My Circle → a persona → Roleplay → Model behaviour, then Account → Sign out. *Pass:* within about half a second the Login screen, never a blank page. Then switch Adult Mode on, open an adult chat, switch it off. *Pass:* the Hall with the toast, never a blank page.
