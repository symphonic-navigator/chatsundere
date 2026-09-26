# App Update Delivery and Cockpit Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New deploys reach heavy users automatically at a safe moment (pristine login, sole client), and a chat whose model cannot be resolved shows a constructive card in the cockpit slot instead of silently omitting the composer.

**Architecture:** A small Zustand store (`sw/app-update.store.ts`) holds update state; a testable wiring module (`sw/update-wiring.ts`) connects it to `vite-plugin-pwa`'s `registerSW`, the check cadence, `controllerchange`, and a `BroadcastChannel` presence responder. `register.ts` stays a thin shell (it is the only importer of `virtual:pwa-register`, which Vitest cannot resolve). On the chat side, a pure `resolveOffering()` returns a discriminated `OfferingResolution`, and a new `CockpitUnavailable` component renders the non-`ok` cases.

**Tech Stack:** React 18, TypeScript strict, Zustand, TanStack Query, Dexie, `vite-plugin-pwa` (`registerType: 'prompt'`), Vitest + Testing Library, Biome.

**Spec:** `superpowers/specs/2026-09-26-app-update-and-cockpit-fallback-design.md` — read it before your task; it is the source of truth for behaviour and copy.

## Global Constraints

- Work only inside the worktree `/home/chris/workspace/chatsundere/.claude/worktrees/app-update` on branch `feat/app-update`. **Never merge, push, switch branches, or touch the main tree.** Commit on `feat/app-update` only; after committing, confirm with `git branch --show-current` that it printed `feat/app-update`.
- All code, comments, identifiers, copy, and commit messages in **British English**. Commit subjects: free-form imperative, capitalised, no Conventional-Commits prefix. End each commit message with `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
- New files start with `// SPDX-License-Identifier: AGPL-3.0-only`.
- TypeScript strict, `noUncheckedIndexedAccess`. No `any` without an inline reason. **No non-null assertion `!`** (Biome bans it; the pre-commit hook runs Biome only).
- Every exported function gets a one-line JSDoc. Comments explain *why*, never *what*.
- Never reload an **unlocked** session automatically. The only automatic apply is from the pristine Login screen when no other client answers the presence ping.
- User-facing copy (use verbatim):
  - `"{Provider} isn't set up on this device."` / button `"Set up {Provider}"`
  - `"{modelId} needs a newer version of Chatsundere."` + subline `"Chatsundere will restart; you'll unlock once and come straight back here."` / button `"Update now"`
  - `"A newer version of Chatsundere is downloading…"`
  - `"Checking for a newer version…"`
  - `"{modelId} isn't available in this version of Chatsundere."` / button `"Choose another model"` / secondary `"Check again"` / offline tooltip `"You're offline"`
  - `"This persona has no model selected."` / button `"Choose a model"`
  - `"Chatsundere was updated in another window."` / button `"Reload"`
  - Account pill: `"update ready · installs at next unlock"`
- sessionStorage key for the return path: `chatsundere.postUpdateReturn`. BroadcastChannel name: `chatsundere-clients`. Presence timeout: `300` ms. Periodic check interval: `60 * 60 * 1000` ms.
- Per-task verification (run from the worktree root):
  - `pnpm --filter @chatsundere/user-client exec vitest run <your test files>`
  - `pnpm --filter @chatsundere/user-client exec vitest run` — the full suite. Expect **exactly 8** known failures (the Node experimental-localStorage trio baseline); a 9th is yours.
  - `pnpm typecheck --force`
  - `pnpm lint`

## Review Focus

1. **User types on the login screen during the 300 ms presence wait:** the apply must not happen. `useApplyUpdateWhenPristine` cancels in its effect cleanup. Test in Task 3.
2. **A first-ever visit (no controller at load) gets a `controllerchange`:** it must not show the "updated in another window" card. Test in Task 2.
3. **The offering query has not resolved yet (`resolution === null`):** render neither the cockpit nor the card, so there is no flash of the card on every chat open. Test in Task 6.
4. **The return path must never loop back to `/login` or leave the app:** `rememberReturnPath` stores only `/app…` paths, and `consumeReturnPath` validates with `safeReturnPath`. Test in Task 3.
5. **`checkForUpdate` finds a waiting worker before `onNeedRefresh` has fired:** it still flips `updateReady`, so the card shows **Update now** rather than "not available". Test in Task 2.

---

### Task 1: App-update store and presence helper

**Files:**
- Create: `apps/user-client/src/sw/app-update.store.ts`
- Create: `apps/user-client/src/sw/presence.ts`
- Test: `apps/user-client/tests/sw/app-update.store.test.ts`
- Test: `apps/user-client/tests/sw/presence.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type UpdateCheckResult = 'none' | 'installing' | 'ready';
  export interface UpdateBindings { apply: () => void; check: () => Promise<UpdateCheckResult> }
  export const useAppUpdateStore: UseBoundStore<StoreApi<{
    updateReady: boolean;
    updatedElsewhere: boolean;
    applyUpdate: () => void;              // at most once per page load; no-op when unbound
    checkForUpdate: () => Promise<UpdateCheckResult>; // 'none' when unbound
    bind: (b: UpdateBindings) => void;    // wiring only
    markUpdateReady: () => void;
    markUpdatedElsewhere: () => void;
  }>>;
  export function isApplyingHere(): boolean;   // true once applyUpdate ran in this tab
  export function _resetAppUpdateForTests(): void;
  // presence.ts
  export const PRESENCE_CHANNEL = 'chatsundere-clients';
  export function startPresenceResponder(): () => void;       // answers 'presence?' with 'presence!'
  export async function otherClientsOpen(timeoutMs?: number): Promise<boolean>; // default 300
  ```

- [ ] **Step 1: Write failing tests**

`tests/sw/app-update.store.test.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it, vi } from 'vitest';
import { _resetAppUpdateForTests, isApplyingHere, useAppUpdateStore } from '../../src/sw/app-update.store.js';

beforeEach(() => _resetAppUpdateForTests());

it('is a safe no-op before the service worker is bound (dev/test)', async () => {
  const s = useAppUpdateStore.getState();
  expect(s.updateReady).toBe(false);
  s.applyUpdate();
  expect(isApplyingHere()).toBe(false);
  expect(await s.checkForUpdate()).toBe('none');
});

it('applies at most once per page load', () => {
  const apply = vi.fn();
  useAppUpdateStore.getState().bind({ apply, check: async () => 'none' });
  useAppUpdateStore.getState().applyUpdate();
  useAppUpdateStore.getState().applyUpdate();
  expect(apply).toHaveBeenCalledTimes(1);
  expect(isApplyingHere()).toBe(true);
});

it('delegates checks to the bound checker', async () => {
  useAppUpdateStore.getState().bind({ apply: vi.fn(), check: async () => 'installing' });
  expect(await useAppUpdateStore.getState().checkForUpdate()).toBe('installing');
});

it('marks update-ready and updated-elsewhere', () => {
  useAppUpdateStore.getState().markUpdateReady();
  useAppUpdateStore.getState().markUpdatedElsewhere();
  expect(useAppUpdateStore.getState().updateReady).toBe(true);
  expect(useAppUpdateStore.getState().updatedElsewhere).toBe(true);
});
```

`tests/sw/presence.test.ts` (jsdom has no BroadcastChannel; stub one):
```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, expect, it } from 'vitest';
import { otherClientsOpen, startPresenceResponder } from '../../src/sw/presence.js';

class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(public name: string) { FakeChannel.all.push(this); }
  postMessage(data: unknown) {
    for (const c of FakeChannel.all) {
      if (c !== this && c.name === this.name) queueMicrotask(() => c.onmessage?.({ data } as MessageEvent));
    }
  }
  close() { FakeChannel.all = FakeChannel.all.filter((c) => c !== this); }
}
const original = globalThis.BroadcastChannel;
beforeEach(() => { FakeChannel.all = []; (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = FakeChannel; });
afterEach(() => { (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = original; });

it('reports no other clients when nobody answers', async () => {
  expect(await otherClientsOpen(20)).toBe(false);
});

it('reports another client when a responder answers', async () => {
  const stop = startPresenceResponder();
  expect(await otherClientsOpen(20)).toBe(true);
  stop();
});

it('treats a missing BroadcastChannel as sole client', async () => {
  (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = undefined;
  expect(await otherClientsOpen(20)).toBe(false);
});
```

- [ ] **Step 2: Run, verify failure** — `pnpm --filter @chatsundere/user-client exec vitest run tests/sw` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/sw/app-update.store.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

/** Outcome of an explicit update check (spec 2026-09-26 §2.2). */
export type UpdateCheckResult = 'none' | 'installing' | 'ready';

/** The service-worker operations the store delegates to once registration exists. */
export interface UpdateBindings {
  apply: () => void;
  check: () => Promise<UpdateCheckResult>;
}

interface AppUpdateState {
  updateReady: boolean;
  updatedElsewhere: boolean;
  applyUpdate: () => void;
  checkForUpdate: () => Promise<UpdateCheckResult>;
  bind: (b: UpdateBindings) => void;
  markUpdateReady: () => void;
  markUpdatedElsewhere: () => void;
}

let bindings: UpdateBindings | null = null;
// Guards against a second apply before the reload lands, and lets the
// controllerchange listener tell our own update apart from another tab's.
let applying = false;

/** Whether this tab initiated the pending update (see update-wiring controllerchange). */
export function isApplyingHere(): boolean {
  return applying;
}

/** Update-delivery state shared by the login, cockpit fallback and account screens. */
export const useAppUpdateStore = create<AppUpdateState>((set) => ({
  updateReady: false,
  updatedElsewhere: false,
  applyUpdate: () => {
    if (applying || !bindings) return;
    applying = true;
    bindings.apply();
  },
  checkForUpdate: async () => (bindings ? await bindings.check() : 'none'),
  bind: (b) => {
    bindings = b;
  },
  markUpdateReady: () => set({ updateReady: true }),
  markUpdatedElsewhere: () => set({ updatedElsewhere: true }),
}));

/** Test-only reset of module and store state. */
export function _resetAppUpdateForTests(): void {
  bindings = null;
  applying = false;
  useAppUpdateStore.setState({ updateReady: false, updatedElsewhere: false });
}
```

`src/sw/presence.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Channel every open Chatsundere client listens on (spec 2026-09-26 §2.5). */
export const PRESENCE_CHANNEL = 'chatsundere-clients';

type PresenceMessage = { type: 'presence?' } | { type: 'presence!' };

/** Answers other clients' presence pings for the life of this page; returns a stop function. */
export function startPresenceResponder(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(PRESENCE_CHANNEL);
  channel.onmessage = (e: MessageEvent<PresenceMessage>) => {
    if (e.data?.type === 'presence?') channel.postMessage({ type: 'presence!' } satisfies PresenceMessage);
  };
  return () => channel.close();
}

/** Resolves true if any other Chatsundere client answers within the timeout. */
export async function otherClientsOpen(timeoutMs = 300): Promise<boolean> {
  if (typeof BroadcastChannel === 'undefined') return false;
  const channel = new BroadcastChannel(PRESENCE_CHANNEL);
  try {
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      channel.onmessage = (e: MessageEvent<PresenceMessage>) => {
        if (e.data?.type === 'presence!') {
          clearTimeout(timer);
          resolve(true);
        }
      };
      channel.postMessage({ type: 'presence?' } satisfies PresenceMessage);
    });
  } finally {
    channel.close();
  }
}
```

- [ ] **Step 4: Run tests → PASS.** Then full suite, `pnpm typecheck --force`, `pnpm lint`.
- [ ] **Step 5: Commit** — `git add apps/user-client/src/sw apps/user-client/tests/sw && git commit` with subject `Add app-update store and client presence helper`.

---

### Task 2: Service-worker update wiring

**Files:**
- Create: `apps/user-client/src/sw/update-wiring.ts`
- Modify: `apps/user-client/src/sw/register.ts` (whole file)
- Test: `apps/user-client/tests/sw/update-wiring.test.ts`

**Interfaces:**
- Consumes: `useAppUpdateStore`, `isApplyingHere`, `UpdateCheckResult` (Task 1); `startPresenceResponder` (Task 1).
- Produces:
  ```ts
  export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
  export type RegisterSWLike = (opts: {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  }) => (reloadPage?: boolean) => Promise<void>;
  export function checkRegistration(reg: ServiceWorkerRegistration): Promise<UpdateCheckResult>;
  export function wireAppUpdates(registerSW: RegisterSWLike): void;
  ```

- [ ] **Step 1: Write failing tests** (`tests/sw/update-wiring.test.ts`). Use a fake registration object cast via `as unknown as ServiceWorkerRegistration`, `vi.useFakeTimers()` for the interval, and `Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })`. Cover:
  ```ts
  it('checkRegistration returns ready when a worker is waiting and flips updateReady', …)   // Review Focus 5
  it('checkRegistration returns installing when only installing is set', …)
  it('checkRegistration returns none when neither is set', …)
  it('checkRegistration skips update() while offline', …)                // reg.update not called
  it('checkRegistration swallows a rejected update()', …)                // resolves 'none'
  it('onNeedRefresh marks updateReady', …)   // call the captured opts.onNeedRefresh()
  it('applyUpdate calls updateSW(true)', …)
  it('checks on registration, on visibility → visible, and hourly', …)   // count reg.update calls
  it('shows updated-elsewhere on controllerchange this tab did not initiate', …)
  it('ignores controllerchange when this tab initiated the update', …)
  it('ignores controllerchange when the page had no controller at load', …) // Review Focus 2
  ```
  For the `controllerchange` tests, stub `navigator.serviceWorker` with `Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: fakeContainer })`, where `fakeContainer` is an `EventTarget` with a `controller` property (`{}` or `null`). Dispatch `new Event('controllerchange')`. Reset with `_resetAppUpdateForTests()` in `beforeEach`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `src/sw/update-wiring.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { isApplyingHere, type UpdateCheckResult, useAppUpdateStore } from './app-update.store.js';
import { startPresenceResponder } from './presence.js';

/** How often an open client re-checks for a new deploy (spec 2026-09-26 §2.3). */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** The subset of vite-plugin-pwa's registerSW we use — injected so Vitest never imports the virtual module. */
export type RegisterSWLike = (opts: {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
}) => (reloadPage?: boolean) => Promise<void>;

/** Runs one update check and reports whether a new version is waiting, installing, or absent. */
export async function checkRegistration(reg: ServiceWorkerRegistration): Promise<UpdateCheckResult> {
  if (navigator.onLine) {
    try {
      await reg.update();
    } catch {
      // Background freshness probe — a transient network error must not surface.
    }
  }
  if (reg.waiting) {
    // A worker can be waiting before onNeedRefresh has fired for this page.
    useAppUpdateStore.getState().markUpdateReady();
    return 'ready';
  }
  return reg.installing ? 'installing' : 'none';
}

/** Connects the service worker to the app-update store, the check cadence and the presence responder. */
export function wireAppUpdates(registerSW: RegisterSWLike): void {
  startPresenceResponder();
  const container = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  const hadController = Boolean(container?.controller);
  container?.addEventListener('controllerchange', () => {
    // First-ever install gains a controller too; only a *replacement* strands this tab.
    if (!hadController || isApplyingHere()) return;
    useAppUpdateStore.getState().markUpdatedElsewhere();
  });

  let registration: ServiceWorkerRegistration | undefined;
  const updateSW = registerSW({
    immediate: false,
    onNeedRefresh: () => useAppUpdateStore.getState().markUpdateReady(),
    onOfflineReady: () => {
      /* informational; we are local-first regardless */
    },
    onRegisteredSW: (_url, reg) => {
      registration = reg;
      if (!reg) return;
      void checkRegistration(reg);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void checkRegistration(reg);
      });
      setInterval(() => void checkRegistration(reg), UPDATE_CHECK_INTERVAL_MS);
    },
  });

  useAppUpdateStore.getState().bind({
    apply: () => void updateSW(true),
    check: async () => (registration ? await checkRegistration(registration) : 'none'),
  });
}
```

Rewrite `src/sw/register.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { registerSW } from 'virtual:pwa-register';
import { wireAppUpdates } from './update-wiring.js';

/**
 * Registers the service worker. We never reload an unlocked session on our own:
 * a reload drops the in-memory master key (zero-knowledge) and forces a
 * re-unlock. A waiting update is therefore applied only from the pristine login
 * screen when no other client is open, or on explicit request from a blocking
 * surface such as the cockpit fallback (spec 2026-09-26). Active checks make
 * sure long-lived clients learn about new deploys at all.
 */
export function registerServiceWorker(): void {
  wireAppUpdates(registerSW);
}
```
If `registerSW`'s real type does not match `RegisterSWLike` exactly, adapt `RegisterSWLike` to the real `RegisterSWOptions` shape rather than casting.

- [ ] **Step 4: Run tests → PASS**; full suite, typecheck, lint.
- [ ] **Step 5: Commit** — `Wire service-worker update detection and cross-tab awareness`.

---

### Task 3: Post-update return path and pristine auto-apply on Login

**Files:**
- Create: `apps/user-client/src/sw/post-update-return.ts`
- Create: `apps/user-client/src/sw/use-apply-update-when-pristine.ts`
- Modify: `apps/user-client/src/routes/login/index.tsx` (`returnTarget` around line 45; add the pristine hook call in `Login`)
- Test: `apps/user-client/tests/sw/post-update-return.test.ts`
- Test: `apps/user-client/tests/sw/use-apply-update-when-pristine.test.tsx`

**Interfaces:**
- Consumes: `useAppUpdateStore`, `_resetAppUpdateForTests` (Task 1); `otherClientsOpen` (Task 1); `safeReturnPath` (`src/lib/safe-return.ts`).
- Produces:
  ```ts
  export const POST_UPDATE_RETURN_KEY = 'chatsundere.postUpdateReturn';
  export function rememberReturnPath(path?: string): void; // default location.pathname + location.search; stores only paths starting with '/app'
  export function consumeReturnPath(): string | null;       // reads once, removes, returns a safeReturnPath-validated value or null
  export function useApplyUpdateWhenPristine(isPristine: boolean): void;
  ```

- [ ] **Step 1: Write failing tests.**

`post-update-return.test.ts` — use `sessionStorage.clear()` in `beforeEach`:
```ts
it('round-trips an app path once', () => { rememberReturnPath('/app/chat/c1?x=1'); expect(consumeReturnPath()).toBe('/app/chat/c1?x=1'); expect(consumeReturnPath()).toBeNull(); });
it('never stores a non-app path (no loop back to /login)', () => { rememberReturnPath('/login'); expect(consumeReturnPath()).toBeNull(); });   // Review Focus 4
it('rejects a tampered unsafe value', () => { sessionStorage.setItem(POST_UPDATE_RETURN_KEY, '//evil.example'); expect(consumeReturnPath()).toBeNull(); });
```

`use-apply-update-when-pristine.test.tsx` — `vi.mock('../../src/sw/presence.js', () => ({ otherClientsOpen: vi.fn() }))`, `renderHook` from Testing Library, bind a spy `apply` via `useAppUpdateStore.getState().bind(...)`, and `await waitFor`:
```ts
it('applies when update-ready, pristine and sole client', …)
it('does not apply when another client answers', …)
it('does not apply when not pristine', …)
it('applies once the form becomes pristine again', …)        // rerender(false → true)
it('does not apply if the form stops being pristine during the presence wait', …) // otherClientsOpen returns a deferred promise; rerender(false) before resolving it → apply not called  (Review Focus 1)
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.**

`src/sw/post-update-return.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { safeReturnPath } from '../lib/safe-return.js';

/** sessionStorage key carrying the route to resume after an update reload (spec 2026-09-26 §3.3). */
export const POST_UPDATE_RETURN_KEY = 'chatsundere.postUpdateReturn';

/** Remembers where to resume after an update reload; only in-app routes qualify. */
export function rememberReturnPath(path = `${location.pathname}${location.search}`): void {
  if (!path.startsWith('/app')) return;
  try {
    sessionStorage.setItem(POST_UPDATE_RETURN_KEY, path);
  } catch {
    // Storage blocked — the user lands on /app instead, which is still correct.
  }
}

/** Reads and clears the remembered route, returning it only if it is a safe in-app path. */
export function consumeReturnPath(): string | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(POST_UPDATE_RETURN_KEY);
    sessionStorage.removeItem(POST_UPDATE_RETURN_KEY);
  } catch {
    return null;
  }
  const safe = safeReturnPath(raw, '');
  return safe.startsWith('/app') ? safe : null;
}
```

`src/sw/use-apply-update-when-pristine.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';
import { useAppUpdateStore } from './app-update.store.js';
import { otherClientsOpen } from './presence.js';

/**
 * Applies a waiting update while the login form is untouched and no other
 * client is open — the one moment a reload costs nothing (spec 2026-09-26 §2.4).
 */
export function useApplyUpdateWhenPristine(isPristine: boolean): void {
  const updateReady = useAppUpdateStore((s) => s.updateReady);
  useEffect(() => {
    if (!updateReady || !isPristine) return;
    let cancelled = false;
    void otherClientsOpen().then((othersOpen) => {
      if (!cancelled && !othersOpen) useAppUpdateStore.getState().applyUpdate();
    });
    return () => {
      cancelled = true;
    };
  }, [updateReady, isPristine]);
}
```

`routes/login/index.tsx`:
- import `consumeReturnPath` and `useApplyUpdateWhenPristine`;
- replace line 45 with:
  ```ts
  // Read once per mount: the key is single-use and must not be re-consumed on re-render.
  const [postUpdateReturn] = useState(consumeReturnPath);
  const returnTarget = safeReturnTarget(searchParams.get('return') ?? postUpdateReturn);
  ```
  (place it after the `useState` import is available; `useState` is already imported);
- after the `error` state declaration, add:
  ```ts
  // A visible error counts as not pristine so an update reload never wipes it unread.
  useApplyUpdateWhenPristine(passphrase === '' && !busy && error === null);
  ```
- Add a Login test only if an existing Login test file makes it cheap; the hook and `consumeReturnPath` are covered by their own tests.

- [ ] **Step 4: Run → PASS**; full suite, typecheck, lint.
- [ ] **Step 5: Commit** — `Apply waiting updates from a pristine login and resume the prior route`.

---

### Task 4: "Updated in another window" overlay

**Files:**
- Create: `apps/user-client/src/components/UpdatedElsewhereOverlay.tsx`
- Modify: `apps/user-client/src/App.tsx` (inside the `'ready'` branch, next to `<StepUpModalHost />`)
- Modify: `apps/user-client/src/index.css` (append an `.updated-elsewhere` block near the toast styles)
- Test: `apps/user-client/tests/components/UpdatedElsewhereOverlay.test.tsx`

**Interfaces:**
- Consumes: `useAppUpdateStore` (Task 1); `rememberReturnPath` (Task 3).
- Produces: `export function UpdatedElsewhereOverlay(): JSX.Element | null`.

- [ ] **Step 1: Failing test:**
  - renders nothing while `updatedElsewhere` is false;
  - when true, shows `role="alertdialog"` with the text "Chatsundere was updated in another window." and a single "Reload" button;
  - clicking Reload calls `rememberReturnPath()` and `location.reload()`. Stub `location.reload` via `Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload: vi.fn(), pathname: '/app/chat/c1', search: '' } })` and restore it afterwards. Mock `../../src/sw/post-update-return.js` to spy on `rememberReturnPath`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** The component reads `updatedElsewhere` from the store. When it is true, it renders a fixed full-viewport scrim (`position: fixed; inset: 0; z-index: 60`), because the stranded tab must not keep interacting with a mismatched worker. Centred on the scrim is a calm card: `role="alertdialog"`, `aria-labelledby` on the sentence, the sentence in `font-display`, and one `<button>` "Reload" that autofocuses. Reload is the only safe action, and here it is the user's explicit intent. The button's click handler calls `rememberReturnPath(); location.reload();`. Keep the styling restrained, reusing the existing card colours in `index.css` (dark fill `rgba(10,10,10,0.95)`, border `rgba(255,255,255,0.08)`, rounded). Mount `<UpdatedElsewhereOverlay />` right after `<StepUpModalHost />` in `App.tsx`.
- [ ] **Step 4: Run → PASS**; full suite, typecheck, lint.
- [ ] **Step 5: Commit** — `Offer a reload when another window applied an update`.

---

### Task 5: `resolveOffering` and chat-page wiring

**Files:**
- Create: `apps/user-client/src/lib/resolve-offering.ts`
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx:262-281` (the `offering-for-persona` query)
- Modify: `apps/user-client/src/data/providers.ts` (`useUpsertProvider` and `useDeleteProvider` `onSuccess`)
- Test: `apps/user-client/tests/lib/resolve-offering.test.ts`

**Interfaces:**
- Consumes: `getOffering` from `@chatsundere/llm-unified`; `PersonaRow` and `ProviderRow` from `src/boot/client-data-db.ts`.
- Produces:
  ```ts
  export type OfferingResolution =
    | { kind: 'ok'; offering: Offering }
    | { kind: 'provider-unavailable'; templateId: string }
    | { kind: 'model-unknown'; templateId: string; modelId: string };
  export function resolveOffering(
    persona: Pick<PersonaRow, 'providerId' | 'modelId'>,
    provider: Pick<ProviderRow, 'templateId' | 'apiKey'> | undefined,
  ): OfferingResolution;
  ```
  In `chat-page.tsx`, the local `offeringResolution: OfferingResolution | null` (null while loading) and the unchanged `offering: Offering | null` are used by Task 6.

- [ ] **Step 1: Failing tests** (`resolve-offering.test.ts`), using real catalogue slugs so the test tracks the catalogue. Known slug: `nano-gpt` / `anthropic/claude-opus-5.5`. Stub the `apiKey` as `{} as ProviderRow['apiKey']`, with a comment explaining why the cast is safe (only nullness is read).
  - provider `undefined` → `{ kind: 'provider-unavailable', templateId: persona.providerId }`;
  - `apiKey: null` → `provider-unavailable` with the provider's `templateId`;
  - unknown slug `'anthropic/claude-does-not-exist'` → `model-unknown` with that `modelId`;
  - empty `modelId: ''` → `model-unknown` with `modelId: ''`;
  - known slug → `kind: 'ok'` and `offering.upstreamSlug === 'anthropic/claude-opus-5.5'`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `src/lib/resolve-offering.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { getOffering, type Offering } from '@chatsundere/llm-unified';
import type { PersonaRow, ProviderRow } from '../boot/client-data-db.js';

/** Why a persona's model can or cannot be composed against (spec 2026-09-26 §3.1). */
export type OfferingResolution =
  | { kind: 'ok'; offering: Offering }
  | { kind: 'provider-unavailable'; templateId: string }
  | { kind: 'model-unknown'; templateId: string; modelId: string };

/** Resolves a persona's offering against this build's catalogue, naming the reason when it fails. */
export function resolveOffering(
  persona: Pick<PersonaRow, 'providerId' | 'modelId'>,
  provider: Pick<ProviderRow, 'templateId' | 'apiKey'> | undefined,
): OfferingResolution {
  // apiKey === null is the synced, reversible "removed" state, not a missing row.
  if (!provider || provider.apiKey === null) {
    return { kind: 'provider-unavailable', templateId: provider?.templateId ?? persona.providerId };
  }
  const offering = persona.modelId ? getOffering(provider.templateId, persona.modelId) : undefined;
  return offering
    ? { kind: 'ok', offering }
    : { kind: 'model-unknown', templateId: provider.templateId, modelId: persona.modelId };
}
```
  In `chat-page.tsx`, change the `queryFn` to `return resolveOffering(effectivePersona, (await getClientDataDb().providers.get(effectivePersona.providerId)) ?? undefined);` (keep `if (!effectivePersona) return null;`), then:
  ```ts
  const offeringResolution = modelQuery.data ?? null;
  const offering = offeringResolution?.kind === 'ok' ? offeringResolution.offering : null;
  ```
  Remove the now-unused `getOffering` import only if nothing else in the file uses it.
  In `providers.ts`, both `onSuccess` handlers become:
  ```ts
  // The chat's offering query caches a provider-unavailable resolution; refresh it so a
  // provider set up from the cockpit fallback resolves on return (spec 2026-09-26 §3.3).
  onSuccess: () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: QK.providers }),
      qc.invalidateQueries({ queryKey: ['offering-for-persona'] }),
    ]),
  ```
- [ ] **Step 4: Run → PASS**; full suite (`tests/unit/chat-page.test.tsx` must stay green), typecheck, lint.
- [ ] **Step 5: Commit** — `Resolve a persona's offering with a reason instead of null`.

---

### Task 6: `CockpitUnavailable` card and InteractionMode integration

**Files:**
- Create: `apps/user-client/src/components/chat/CockpitUnavailable.tsx`
- Modify: `apps/user-client/src/components/chat/InteractionMode.tsx` (Props, plus render around line 191)
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx` (the `<InteractionMode>` props around line 1157; add `onSetUpProvider`)
- Modify: `apps/user-client/src/index.css` (add `.cockpit-unavailable` after `.cockpit`, line ~1768)
- Test: `apps/user-client/tests/components/chat/CockpitUnavailable.test.tsx`
- Test: `apps/user-client/tests/components/chat/InteractionMode.test.tsx` (extend)

**Interfaces:**
- Consumes: `OfferingResolution` (Task 5); `useAppUpdateStore` (Task 1); `rememberReturnPath` (Task 3); `getProvider` from `@chatsundere/llm-unified`.
- Produces:
  ```ts
  export function CockpitUnavailable(props: {
    resolution: Exclude<OfferingResolution, { kind: 'ok' }>;
    onSetUpProvider: (templateId: string) => void;
    onChooseModel: () => void;
  }): JSX.Element;
  ```
  New `InteractionMode` props: `resolution: OfferingResolution | null` (required) and `onSetUpProvider: (templateId: string) => void` (required). Update all existing test render sites accordingly: pass `resolution: { kind: 'ok', offering }` where an offering was given, else `null`.

- [ ] **Step 1: Failing tests** (`CockpitUnavailable.test.tsx`). Reset the store with `_resetAppUpdateForTests()`. Bind a fake `check` (a `vi.fn` returning controllable deferred promises) and a spy `apply`. Mock `../../../src/sw/post-update-return.js`. Cases:
  1. `provider-unavailable` for `nano-gpt` → text "Nano-GPT isn't set up on this device." (use `getProvider('nano-gpt')?.displayName` in the assertion rather than hard-coding the name); a single "Set up …" button, focused on mount; the click calls `onSetUpProvider('nano-gpt')`.
  2. `model-unknown` with `updateReady` already true → the slug text, the subline, and an "Update now" button that is **not** focused (the card region with `role="status"` has focus). The click calls `rememberReturnPath` and then the bound `apply`.
  3. `model-unknown`, not ready → it shows "Checking for a newer version…" and calls `check` once on mount. Resolving `'installing'` → "…is downloading…"; then `markUpdateReady()` → "Update now" row.
  4. Resolving `'none'` → the "isn't available in this version" row with "Choose another model" (click → `onChooseModel`) and "Check again" (click → a second `check` call). A later `markUpdateReady()` still switches to the "Update now" row.
  5. Offline (`navigator.onLine` stubbed false) → no `check` call; the "isn't available" row; "Check again" is disabled with `title="You're offline"`.
  6. Empty `modelId` → "This persona has no model selected." with a "Choose a model" button; `check` is never called.

  Extend `InteractionMode.test.tsx`:
  - (a) `offering: null, resolution: { kind: 'model-unknown', templateId: 'nano-gpt', modelId: 'x/y' }` → the card is rendered (regression for the incident);
  - (b) `offering: null, resolution: null` → neither a cockpit textarea nor the card (Review Focus 3).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `CockpitUnavailable.tsx`:
  - Local `phase` state: `'checking' | 'installing' | 'none'`. Initial value: `'none'` if the modelId is empty or `navigator.onLine` is false, else `'checking'`.
  - On mount, only when the case is `model-unknown` with a non-empty modelId, `!updateReady` and online, run `checkForUpdate()` and set `phase` from the result. `'ready'` needs no phase, because `updateReady` drives the row. Guard against setState after unmount with a `cancelled` flag.
  - Row selection:
    - `provider-unavailable` → the set-up row;
    - empty `modelId` → the no-model row;
    - `updateReady` → the update row;
    - `phase === 'checking'` → the checking row;
    - `phase === 'installing'` → the downloading row;
    - otherwise → the not-available row.
  - "Check again" sets `phase = 'checking'` and re-runs the check. It is disabled with `title="You're offline"` when offline; read `navigator.onLine` at render.
  - Focus on mount (a `useEffect` with an empty dependency list, so a later row change does not move focus): the primary button for set-up, choose-model and no-model; the region (`tabIndex={-1}`) otherwise.
  - Markup:
    ```tsx
    <div ref={regionRef} role="status" tabIndex={-1} className="cockpit-unavailable">
      <p className="cockpit-unavailable-text">…</p>
      [optional <p className="cockpit-unavailable-subline">…]
      [one primary <button className="cockpit-unavailable-action">]
      [optional quiet <button className="cockpit-unavailable-secondary">]
    </div>
    ```
    Render slugs in `<code className="cockpit-unavailable-slug">`. The provider name is `getProvider(templateId)?.displayName ?? templateId`.
  - "Update now" click: `rememberReturnPath(); useAppUpdateStore.getState().applyUpdate();`.

  CSS `.cockpit-unavailable`:
  - copy the `.cockpit` box rules (`position: relative; flex-shrink: 0; order: 1000; background: rgba(10,10,10,0.95); backdrop-filter: blur(12px); border-top: 1px solid rgba(255,255,255,0.06); padding: 0.75rem; z-index: 6;`), plus `display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start; outline: none;`;
  - the slug: monospace, small, subtle background pill (inline-marker aesthetic, `font-size: 0.8em; padding: 0.05rem 0.35rem; border-radius: 0.3rem; background: rgba(255,255,255,0.06)`);
  - the primary action: a bordered small button, matching the "Seed from template" button style in chat-page;
  - the secondary: a text button in `text-paper-soft`.

  `InteractionMode.tsx`: add the two props and document `resolution`. Replace the old `offering` doc comment's "stays absent" with "renders CockpitUnavailable (spec 2026-09-26)". Render:
  ```tsx
  {p.offering ? (<div className="cockpit-focus-capture" …>…</div>)
   : p.resolution && p.resolution.kind !== 'ok' ? (
      <CockpitUnavailable
        resolution={p.resolution}
        onSetUpProvider={p.onSetUpProvider}
        onChooseModel={() => p.onOpenPersonaEditor?.()}
      />
    ) : null}
  ```
  `chat-page.tsx`: pass `resolution={offeringResolution}` and
  ```ts
  onSetUpProvider={(templateId) => {
    const returnUrl = `${location.pathname}${location.search}`;
    navigate(`/app/settings/providers/${templateId}?return=${encodeURIComponent(returnUrl)}`);
  }}
  ```
  (Mirror the existing `onOpenPersonaEditor` at `chat-page.tsx:548`.)
- [ ] **Step 4: Run → PASS**; full suite, typecheck, lint.
- [ ] **Step 5: Commit** — `Show a constructive card when the cockpit cannot compose`.

---

### Task 7: Provider page honours `?return=`

**Files:**
- Modify: `apps/user-client/src/routes/app/settings/provider.tsx` (`back` at line 73; `back=` props at lines ~173 and ~193)
- Test: extend the existing provider-page test if one exists (`rg -l "settings/provider" apps/user-client/tests`), else create `apps/user-client/tests/routes/provider-return.test.tsx`

**Interfaces:**
- Consumes: `safeReturnPath` (`src/lib/safe-return.ts`).

- [ ] **Step 1: Failing tests.** Render the page in a `MemoryRouter` with `initialEntries={['/app/settings/providers/nano-gpt?return=%2Fapp%2Fchat%2Fc1']}` and a route that shows a marker at `/app/chat/:id`. The header back link points to `/app/chat/c1`. With `?return=%2F%2Fevil.example` it points to `/app/settings/providers`. (Asserting the back link is sufficient; the save path shares the same `back()` function. If the existing test harness already drives a successful save, assert the navigation there too.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
  ```ts
  const [searchParams] = useSearchParams();
  // A repair trip from the cockpit fallback returns to its chat (spec 2026-09-26 §3.3).
  const backTo = safeReturnPath(searchParams.get('return'), '/app/settings/providers');
  const back = () => navigate(backTo);
  ```
  Use `back={backTo}` for both `PageScaffold` usages. Import `useSearchParams` from `react-router-dom` and `safeReturnPath` from `../../../lib/safe-return.js`.
- [ ] **Step 4: Run → PASS**; full suite, typecheck, lint.
- [ ] **Step 5: Commit** — `Return from the provider page to where the user came from`.

---

### Task 8: Account "update ready" pill

**Files:**
- Modify: `apps/user-client/src/routes/app/account.tsx` (next to the version `<span>` around line 222)
- Test: extend `apps/user-client/tests/routes/account-page.test.tsx`

**Interfaces:**
- Consumes: `useAppUpdateStore` (Task 1).

- [ ] **Step 1: Failing test.** With `useAppUpdateStore.setState({ updateReady: true })`, the Account page shows "update ready · installs at next unlock". With it false, the text is absent. Reset with `_resetAppUpdateForTests()`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
  ```tsx
  const updateReady = useAppUpdateStore((s) => s.updateReady);
  …
  {updateReady && <Badge tone="neutral">update ready · installs at next unlock</Badge>}
  ```
  Place it immediately before the version `<span>`.
- [ ] **Step 4: Run → PASS**; full suite, typecheck, lint.
- [ ] **Step 5: Commit** — `Show a quiet update-ready pill on the account screen`.
