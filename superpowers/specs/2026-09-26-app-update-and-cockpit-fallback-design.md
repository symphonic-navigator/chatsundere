# App Update Delivery and Cockpit Fallback — Design Specification

**Date:** 2026-09-26
**Status:** Draft, awaiting Chris's review
**Authors:** Chris (product owner) + Liz (diagnosis, drafting)

---

## 1. Purpose and Scope

### 1.1 The incident

On 2026-09-26 Chris opened a chat with the persona *Claude Opus 5.5* (`nano-gpt` / `anthropic/claude-opus-5.5`) on the server deploy and found **no composer at all** — only the interaction topbar and the persona greeting. Other personas (e.g. `ollama-cloud` / `glm-5.2:cloud`) worked.

Root cause, confirmed with console probes:

1. The server ran `v0.2.18`, which includes the curation commit `a029b612` that added Opus 5.5 to the catalogue. The browser, however, ran **`v0.2.17 · sha 28e56b0`** (shown on the Account screen), whose catalogue does not know Opus 5.5.
2. The PWA's service worker uses `registerType: 'prompt'` without `skipWaiting` (`apps/user-client/vite.config.ts:97`, `apps/user-client/src/sw/register.ts`). A new deploy is installed but stays *waiting* until **every** Chatsundere client is closed. A user who keeps the PWA open never reaches that "cold start". A hard reload bypasses the service worker for one load only, which is why the fix "worked yesterday" and silently reverted on the next normal load.
3. The persona reached the stale client via sync (or was created on a fresh load). In the stale bundle `getOffering('nano-gpt', 'anthropic/claude-opus-5.5')` returns `undefined`, so the offering query in `apps/user-client/src/routes/app/chat/chat-page.tsx:273-281` resolves to `null`.
4. `apps/user-client/src/components/chat/InteractionMode.tsx:191` renders `<Cockpit>` only when `offering` is set. With `offering === null` the composer is **silently omitted**: a dead end with no explanation and no next step.

The original "never update mid-session" intent is sound: applying an update reloads the page, which drops the in-memory master key (ADR 0005, zero-knowledge), and forces a re-unlock. The flaw is that the only application point, the cold start, never happens for heavy users. For a sync product this is a correctness problem as well as a freshness one: new data from newer clients meets old code.

### 1.2 In scope

- **U1 — Update delivery.** Actively detect new deploys, and apply a waiting update automatically at a moment when nothing can be lost (on the login screen, before unlock, with no input typed). Never apply automatically inside an unlocked session.
- **U2 — Cockpit fallback.** Replace the silent omission of the cockpit with a constructive notice card that names the reason and offers exactly one primary next step.
- **U3 — Update-ready indicator.** A passive "update ready" pill beside the version line on the Account screen.

### 1.3 Out of scope

- A general in-session update banner or marker. Chris chose "quiet, only when needed" (2026-09-26): outside the blocking case, the update simply lands at the next unlock.
- Changes to the master-key lifecycle, session persistence, or any server-side component. No new endpoint, no `/version.json`.
- Surfacing unknown models in the model picker, or migrating personas whose model was de-curated. The fallback card points at the persona editor, which is enough for now.
- `registerType: 'autoUpdate'` / `skipWaiting` + `clientsClaim` on install. Rejected: it reloads mid-session and drops the master key.

---

## 2. U1 — Update Delivery

### 2.1 Mechanism

> **Superseded at pre-squash (2026-09-26, Larissa HIGH-1 + final review).** `vite-plugin-pwa`'s prompt-mode `registerSW` attaches a `controlling → location.reload()` listener in *every* tab that has seen a waiting worker, so one tab's `SKIP_WAITING` would force-reload unlocked sessions elsewhere; its `updateSW(reload)` also ignores its argument. We therefore keep `registerType: 'prompt'` (for the generated worker's `SKIP_WAITING` message handler) but set `injectRegister: false` and own the registration with raw `navigator.serviceWorker` in `sw/update-wiring.ts`: detection via `reg.waiting` / `updatefound → installed`, apply by posting `SKIP_WAITING` to the waiting worker, and a `controllerchange` handler that reloads only the applying tab and strands (overlay + fail-closed quiesce) any other. The original text below is kept for the record.

Original design — we keep `registerType: 'prompt'` and drive `vite-plugin-pwa`'s `registerSW` ourselves:

- `onNeedRefresh()` marks the update as ready in a new store (§2.2).
- The `updateSW(reloadPage = true)` function returned by `registerSW` is kept as the single way to apply an update: it posts `SKIP_WAITING` to the waiting worker and reloads once the new worker controls the page.
- `onRegisteredSW(swUrl, registration)` gives us the `ServiceWorkerRegistration` for active checks (§2.3).

### 2.2 State: `useAppUpdateStore`

A small Zustand store in `apps/user-client/src/sw/app-update.store.ts`:

```ts
interface AppUpdateState {
  /** A new version is installed and waiting to take over. */
  updateReady: boolean;
  /** Applies the waiting update (skipWaiting + reload). No-op when none waits. */
  applyUpdate: () => void;
  /**
   * Asks the browser to check for a new deploy now. `registration.update()`
   * resolves once the new worker is fetched and installation has *started*,
   * not finished, so the result inspects `registration.installing` /
   * `.waiting`: 'installing' means a new version is downloading, and
   * `updateReady` will flip on its own when the precache completes.
   */
  checkForUpdate: () => Promise<'none' | 'installing' | 'ready'>;
}
```

`register.ts` wires the store's setters to the `registerSW` callbacks. In dev and in Vitest, where no registration exists, `applyUpdate` and `checkForUpdate` are safe no-ops and `updateReady` stays `false`.

### 2.3 Detection cadence

`registration.update()` runs:

1. once on registration (boot),
2. on every `visibilitychange` to `visible` (returning to the tab or PWA),
3. every 60 minutes while the page is open.

Checks are skipped while `navigator.onLine === false`. A failed check is swallowed silently: it is a background freshness probe, and a transient network error must not surface.

### 2.4 When an update is applied

| Situation | Behaviour |
|---|---|
| `updateReady` and the user is on `/login` with the form **pristine** (nothing typed, no auth ceremony in flight, no error shown) and this is the **only open Chatsundere client** (§2.5) | Apply immediately (`applyUpdate()`). The page reloads into the same login screen on the new version. |
| As above, but another Chatsundere tab or window is open | Do not auto-apply. The update lands when this tab is the only client left, or through an explicit **Update now** (§3). |
| `updateReady` becomes true **while** the user sits on a pristine `/login` | Same: apply immediately. |
| The user has typed into the login form, or a passkey ceremony is running | Do not apply. It is picked up at the next pristine visit to `/login`. |
| Onboarding, `/join`, `/login/recovery`, `/login/start-over`, `/change-passphrase` | **Never** apply. These flows hold multi-step, in-memory state that a reload would destroy. |
| Unlocked session (`session !== null`) | **Never** apply automatically. Only an explicit tap on **Update now** (§3) applies it. |

Implementation shape: the Login page owns the pristine signal, `isPristine = passphrase === '' && !busy && error === null`. It knows its own inputs, ceremony state and error. A visible error counts as not pristine, so an auto-reload never wipes an error message the user has not read yet. The page calls a small hook, `useApplyUpdateWhenPristine(isPristine: boolean)`, which calls `applyUpdate()` whenever `updateReady && isPristine` and the sole-client check (§2.5) passes. Scoping the auto-apply to the Login component, rather than to "session is null" globally, is what excludes onboarding, recovery, and the other session-less flows by construction.

### 2.5 Multiple open clients

`SKIP_WAITING` activates the new worker for the **whole origin**, but `updateSW(true)` reloads only the calling tab. Any other open tab keeps running the old bundle against the new worker. The new worker's activation cleans up the old precache, and the server no longer serves the old chunk hashes. The old tab's lazy imports (`MermaidBlock`, `stream-manager.store`, `sync/*`, `tool-loop`, persona hub, …) then fail, and a Dexie version bump in the new build would close its DB connection via `versionchange`. This is a real break, not a theoretical one, so there are two rules:

1. **Auto-apply only as the sole client.** Before auto-applying, the tab pings a `BroadcastChannel('chatsundere-clients')` with `{ type: 'presence?' }` and waits 300 ms. Every open client answers `{ type: 'presence!' }`. Any answer means another client is open, so there is no auto-apply this time. The next pristine visit, or the next `updateReady` edge, re-checks.
2. **Old tabs get a constructive exit.** Every client listens for `navigator.serviceWorker`'s `controllerchange`. If the controller changes and this tab did **not** initiate the update, it renders a calm full-surface card: "Chatsundere was updated in another window." with a single **Reload** action. Reloading goes through the normal unlock and returns to the same route (§3.2 return path). There is no silent break.

### 2.6 Loop safety

`applyUpdate()` is idempotent per page load: after the first call it does nothing until the reload happens. After the reload the new worker is active, so `onNeedRefresh` does not fire again for the same version. A reload loop is therefore impossible unless a *newer* deploy lands in between, which is correct behaviour.

### 2.7 Comment update

The doc comment in `sw/register.ts` changes from "activates silently on the next cold start" to "activates at the next unlock (pristine login screen), or on explicit request from a blocking surface", with the rationale kept: we never reload an unlocked session on our own.

---

## 3. U2 — Cockpit Fallback

### 3.1 Data: `OfferingResolution`

The offering query in `chat-page.tsx` returns a discriminated result instead of `Offering | null`, via a pure function `resolveOffering` in `apps/user-client/src/lib/resolve-offering.ts`:

```ts
export type OfferingResolution =
  | { kind: 'ok'; offering: Offering }
  // Provider row missing, or present with apiKey === null (reversible removal).
  | { kind: 'provider-unavailable'; templateId: string }
  // Provider fine, but the persona's model slug is empty or not in this build's catalogue.
  | { kind: 'model-unknown'; templateId: string; modelId: string };
```

`offering` is derived as `resolution.kind === 'ok' ? resolution.offering : null`, so every existing consumer of `offering` in `chat-page.tsx` is unchanged. `InteractionMode` receives the resolution in addition to `offering`.

The query key stays as it is (`persona id + providerId + modelId`). `staleTime: 0` already refetches on remount. Additionally, the providers mutations' `onSuccess` (`apps/user-client/src/data/providers.ts:108,137`) invalidates `['offering-for-persona']`, so setting up a provider from the fallback card resolves the cockpit on return without a remount.

### 3.2 UI: `CockpitUnavailable`

When `resolution.kind !== 'ok'`, `InteractionMode` renders `CockpitUnavailable` **in the cockpit's slot** (same flex-child position, `order: 1000`, same inline padding as `.cockpit`), so the layout does not jump between the two states. It is a calm card: one sentence of explanation, the model slug as a small monospace inline-marker pill where relevant, and exactly **one** primary action.

| Case | Copy (British English, final wording at implementation) | Primary action |
|---|---|---|
| `provider-unavailable` | "{Provider display name} isn't set up on this device." | **Set up {Provider}** → `/app/settings/providers/{templateId}?return=<current chat path>` (§3.3) |
| `model-unknown`, update ready | "`{modelId}` needs a newer version of Chatsundere." Subline: "Chatsundere will restart; you'll unlock once and come straight back here." | **Update now** → store the return path (§3.3), then `applyUpdate()` |
| `model-unknown`, update downloading | "A newer version of Chatsundere is downloading…" | none yet; the card switches to the row above by itself when `updateReady` flips |
| `model-unknown`, checking (on mount) | "Checking for a newer version…" | none yet (the check takes about a second) |
| `model-unknown`, no update available | "`{modelId}` isn't available in this version of Chatsundere." | **Choose another model** → opens the persona editor (existing `onOpenPersonaEditor`, which already round-trips `?return=`) |

**Auto-check on mount.** In the `model-unknown` case without `updateReady`, the card fires `checkForUpdate()` silently when it mounts and shows the *checking* row. In the incident's own situation, the deploy exists but has not been detected yet. The card therefore finds the update by itself and ends on **Update now**, instead of steering the user towards abandoning their chosen model. The tri-state result drives the rows:

- `'ready'` → update-ready row.
- `'installing'` → downloading row, which switches live once `updateReady` flips.
- `'none'` → no-update row.

The no-update row is **not** final. If a later hourly or visibility check sets `updateReady`, the card switches live to the update-ready row. The no-update row carries a quiet secondary text button **Check again**, which re-runs the same check. It is disabled with the tooltip "You're offline" while `navigator.onLine === false` (disabled over hidden). When the check is skipped because the client is offline, the card goes straight to the no-update row with **Check again** disabled.

The copy "isn't available in this version" is deliberately neutral. It is honest both for a model this build does not know *yet* and for one that has been de-curated.

An empty `modelId` is its own sub-case with copy "This persona has no model selected." and the **Choose a model** action. There is no update check for it, because an update cannot fix an empty slug.

**Focus.** When the card mounts in interaction mode, focus goes to:

- the primary button for *Set up* and *Choose another model*, both of which only navigate and are harmless;
- the card region itself (`tabIndex={-1}`) in the update-ready row. There, a reflexive second Enter or Space, from a user who expected the composer, must not end the session.

### 3.3 Return paths

Both repair actions must bring the user back to the chat they came from, not to the Entrance Hall.

- **Update now.** Before `applyUpdate()`, write `location.pathname + location.search` to `sessionStorage` under `chatsundere.postUpdateReturn`. After the reload, `ProtectedRoute` → Gate → `/login` runs as today. The Login page reads the key **once**, validates it with the existing `safeReturnPath` (`apps/user-client/src/lib/safe-return.ts`), removes it, and uses it as the unlock return target when no `?return=` is present. The same key also serves the **Reload** action of the "updated in another window" card (§2.5), so that tab returns to its route too.
- **Set up {Provider}.** The provider page (`apps/user-client/src/routes/app/settings/provider.tsx`) honours `?return=`, validated with `safeReturnPath`: after a successful save, and on its back action, it navigates there instead of `/app/settings/providers`. This is the same pattern as the persona editor (`routes/app/persona/hub.tsx`).
- **Cockpit on return.** The providers mutations' `onSuccess` also invalidates `['offering-for-persona']` (§3.1), so the cockpit resolves on arrival.

### 3.4 Draft preservation

Drafts are persisted per chat in Dexie. Neither the card nor the update reload touches them. After **Update now** → unlock, the user lands back in the same chat (§3.3), and the draft is in the composer. This is verified manually (§6).

### 3.5 Accessibility

The card is a `role="status"` region, so the reason and every live row change (checking → downloading → update ready) are announced. Every action is a real `<button>`.

---

## 4. U3 — Update-ready Indicator

On the Account screen (`apps/user-client/src/routes/app/account.tsx`), beside the existing `v0.2.17 · sha 28e56b0` line, a small pill **update ready · installs at next unlock** appears while `updateReady` is true. It uses the same inline-marker style as the existing *Linked* / *Biometrics not set up* pills. It is informational, with no action. The update lands at the next unlock (the existing Sign out path is one way to get there), and the blocking case has its own action where it is needed.

---

## 5. Audits

- **Laura (spec-pass, before the plan): done 2026-09-26.** She found 3 hard defects and 7 soft findings, all folded in: H1 return path (§3.3), H2 tri-state check (§2.2, §3.2), H3 multiple clients (§2.5); S1 auto-check, S2 focus, S3 cost subline, S4 provider return, S5 error ≠ pristine, S6 pill wording, S7 neutral copy. A light pre-squash pass follows.
- **Larissa (pre-squash, light):** no change touches `auth-service`, `sync-service`, `proxy-service` or `packages/crypto`, and the master-key lifecycle is unchanged. She still gets a short look at §2.4 (auto-apply on the session-less login screen) to confirm nothing sensitive survives or leaks across the update reload.

---

## 6. Testing

### 6.1 Automated (Vitest)

- `resolveOfferingForPersona`: the provider row is missing → `provider-unavailable`; `apiKey === null` → `provider-unavailable`; unknown slug → `model-unknown`; empty slug → `model-unknown` with an empty `modelId`; known slug → `ok`.
- `useAppUpdateStore`:
  - `checkForUpdate` returns `'installing'` when `registration.installing` is set after `update()`, `'ready'` when `waiting` is set, and `'none'` only when both are null;
  - it skips the check offline;
  - `applyUpdate` fires at most once per load;
  - the no-registration case (dev/test) is a safe no-op.
- `useApplyUpdateWhenPristine`:
  - applies when `updateReady && isPristine` and no other client answers the presence ping;
  - does not apply when another client answers;
  - does not apply when not pristine, including when an error is shown;
  - applies later when the form becomes pristine again.
- Other-window update: a `controllerchange` that this tab did not initiate renders the "updated in another window" card; one this tab initiated does not.
- Return path: **Update now** writes `chatsundere.postUpdateReturn`; Login consumes it once, rejects an unsafe value through `safeReturnPath`, and prefers an explicit `?return=`. The provider page honours `?return=` on save and back.
- `CockpitUnavailable`:
  - each row renders the right copy and at most one primary action;
  - on mount in `model-unknown`, it auto-checks, and the `'installing'` → `updateReady` sequence moves the card from checking → downloading → update ready;
  - the no-update row still switches live when `updateReady` flips later;
  - **Check again** is disabled offline with its tooltip;
  - focus lands on the region, not the button, in the update-ready row.
- `InteractionMode`: with `resolution.kind !== 'ok'` it renders `CockpitUnavailable`, not nothing (regression test for the incident).
- Full suite per task (expect exactly the 8 known Node-localStorage baseline failures), `pnpm typecheck --force`, Biome.

### 6.2 Manual verification (Chris, on the server deploy)

1. Open the PWA, unlock, leave it open. Deploy a new tag. Within at most an hour, or immediately on switching away and back, open Account: the **update ready** pill is shown. Chat still works; no reload happened.
2. Lock or sign out to the login screen without typing: the page reloads once by itself, and Account shows the new version after unlock.
3. Repeat step 1, but on the login screen type one character of the passphrase before the update arrives: no reload happens while you type.
4. With an old client and a persona on a model only the new build knows (reproduce with Opus 5.5 against a `v0.2.17` client, or a temporary bogus slug on a test persona): the chat shows the card instead of nothing. It checks by itself and ends on **Update now**; **Update now** → unlock → you land back **in the same chat**, the composer is there, and a draft typed earlier is still in it.
4a. Open two windows, unlock one, leave the other on the login screen: no automatic reload happens in either. Tap **Update now** in one: the other shows "Chatsundere was updated in another window." with **Reload**, which returns it to its route after unlock.
5. Remove the persona's provider in Settings, open its chat: the card says the provider isn't set up; **Set up …** leads to the provider page; saving the key returns you **to the chat** and the composer is there.
6. Test persona with a bogus slug and no update available: after a brief "Checking…", the card reads "… isn't available in this version"; **Choose another model** opens the persona editor and returns to the chat; in offline mode **Check again** is disabled with the "You're offline" tooltip.
