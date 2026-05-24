# Client Block 1 — Phase 2.7 (Account Room + Polish Iteration 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close iteration-3 of Chris's smoke feedback. Remove the bottom
SaveBar from the Persona Editor (the topbar's "Save & Back" is the only persist
path), add a smooth `scrollIntoView` when an accordion opens, introduce a new
"My Account" room in the Entrance Hall (sixth tile), migrate the existing
`/settings` route + sub-pages to a single accordion-style `/app/account` page
that matches the My Settings UX (EditorTopbar + four accordions: Account, Auth
Methods, Server Linking, About), fix the long-standing "Server Linking → Back
lands on Onboarding" bug by giving the invitation wizard a `?return=` URL it
honours from its back-button, and drop the gear icon from the global topbar
(`Root`) so the only path into account-settings is via the Entrance Hall.

**Architecture:** All changes live in `apps/user-client`. The new `/app/account`
route assembles four accordion sections from the existing source code of the
four settings sub-pages — `Account`, `AuthMethods`, `ServerLinking` (newly
authored as a status + link-to-server section), `About` — wrapped in
`EditorTopbar` + the existing accordion shell. The accordion sections are NOT
draft/save (account state changes are immediate per-field — username rename
has its own inline edit; biometric register/regenerate are their own
transactional flows), so no global SaveBar lives at the bottom of
`/app/account`. The invitation wizard route family (`/onboarding/invitation`,
`/onboarding/invitation/scan`, `/onboarding/invitation/confirm`,
`/onboarding/invitation/recovery`) learns to read a `?return=` query parameter
and honour it as its back-target (default: `/onboarding`). The old `/settings`
route + `SettingsLayout` + its four sub-page files get deleted in favour of the
new `/app/account` consolidation. The Entrance Hall gains a sixth `RoomTile`
("My Account", active link to `/app/account`). The global `Root` topbar loses
its gear-icon link.

**Tech Stack:** TypeScript strict, React 18, Tailwind v4, React Router v6
(`useSearchParams` for the return-URL), Vitest + `@testing-library/react`. No
schema changes, no new packages.

**References:**
- Phase-2.6 plan: `superpowers/plans/2026-05-24-client-block-1-phase-2-6-polish-iteration-2.md`
- Block-1 design spec: `superpowers/specs/2026-05-23-client-block-1-design.md`
  (extended with Decisions 42-47 in Task 6)
- Status: `obsidian/STATUS-CLIENT-ONLY.md` (updated in Task 6)

---

## File Structure

### Created

- `apps/user-client/src/routes/app/account.tsx` (new account page, accordion-style)
- `apps/user-client/src/routes/app/account-sections/account-section.tsx`
- `apps/user-client/src/routes/app/account-sections/auth-methods-section.tsx`
- `apps/user-client/src/routes/app/account-sections/server-linking-section.tsx`
- `apps/user-client/src/routes/app/account-sections/about-section.tsx`
- `apps/user-client/tests/components/AccordionCard.scroll-into-view.test.tsx`
- `apps/user-client/tests/routes/account.test.tsx`
- `apps/user-client/tests/routes/account.server-linking.test.tsx`

### Modified

- `apps/user-client/src/components/AccordionCard.tsx` — scrollIntoView on open
- `apps/user-client/src/routes/app/persona-editor.tsx` — SaveBar removed; Cancel
  navigation now goes through Back
- `apps/user-client/src/routes/app/entrance-hall.tsx` — sixth `RoomTile`
  ("My Account" → `/app/account`)
- `apps/user-client/src/routes/root.tsx` — drop the gear-icon link
- `apps/user-client/src/App.tsx` — register `/app/account`; drop the old
  `/settings/*` routes and `SettingsLayout` import; drop `/settings`
  navigations from change-passphrase (see below)
- `apps/user-client/src/routes/change-passphrase.tsx` — link targets
  (`/settings/server-linking` and `/settings`) replaced with `/app/account`
- `apps/user-client/src/routes/onboarding/invitation/form.tsx` — back-button
  reads `?return=` and uses it
- `apps/user-client/src/routes/onboarding/invitation/scan.tsx` — same
- `apps/user-client/src/routes/onboarding/invitation/confirm.tsx` — same
- `apps/user-client/src/routes/onboarding/invitation/recovery.tsx` — same
- All test files that referenced the old `/settings` route — updated

### Deleted

- `apps/user-client/src/routes/settings/` (entire directory: `layout.tsx`,
  `account.tsx`, `auth-methods.tsx`, `server-linking.tsx`, `about.tsx`)
- `apps/user-client/tests/unit/settings-*` and any tests that targeted the old
  `SettingsLayout`-based pages — the new account.tsx + section files have
  fresh tests

---

## Pre-Existing Pitfalls (carry forward)

- **Vitest test glob is `tests/**/*.test.{ts,tsx}`** — put every new test file
  under `apps/user-client/tests/...`.
- **SPDX header line 1, blank line 2, imports from line 3** — Biome's
  `organizeImports` re-sorts; SPDX stays above.
- **Biome rules:** `noForEach` (use `for...of`), `noNonNullAssertion` (no `!`),
  interactive `<div>`s need keyboard support (rarely a problem here — we use
  buttons and links).
- **Tailwind v4 colour tokens** defined in `src/index.css`'s `@theme` block:
  `ink`, `paper`, `paper-soft`, `aurora-*`, `danger`. NOT defined: `bg` (use
  `ink`).
- **`@chatsundere/llm-unified` and `@chatsundere/crypto` must be built first**
  if their `dist/` folders are missing (`pnpm --filter ... build`).
- **Run `pnpm lint` and `pnpm typecheck` from the repo root**.
- **TanStack-Query cache is stale right after `mutateAsync`** — relevant if any
  account-section reads back a freshly-written value.
- **Subagents never push or switch branches.** Commit on master only.
- **The four old settings sub-pages have working content already** — port their
  bodies into the new section components rather than re-implementing from
  scratch.

---

## Task 0: Remove the Persona Editor's bottom SaveBar

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`
- Modify: any test that asserted on the bottom SaveBar's "Save Persona" button

The EditorTopbar's "Save & Back" is the only persist path; discard happens via
the topbar's Back button (with confirm-on-dirty). The bottom `SaveBar` —
together with its Cancel button and "persist + stay" semantic from Phase 2.6 —
is removed.

- [ ] **Step 1: Read the current persona-editor.tsx**

```bash
cat apps/user-client/src/routes/app/persona-editor.tsx
```

Note the `<SaveBar … />` at the bottom of the JSX, and the `onSaveStay` /
`onCancel` functions wired to it.

- [ ] **Step 2: Edit persona-editor.tsx**

2a. Remove the `<SaveBar … />` block from the JSX entirely.

2b. Remove the `SaveBar` import (`import { SaveBar } from '../../components/SaveBar.js';`).

2c. Remove the `onSaveStay` function — only `onSaveAndBack` is used now.

2d. The `padding-bottom` on the outer `<section>` (`pb-32`) is sized for a fixed
SaveBar at the bottom. With the SaveBar gone, reduce to `pb-8`:

```tsx
    <section className="flex flex-col gap-3 px-4 pb-8 pt-4">
```

2e. The `onCancel` wired to SaveBar is no longer needed — Back in EditorTopbar
covers the discard path.

- [ ] **Step 3: Update existing tests that asserted on the bottom Save**

```bash
grep -rn "Save Persona\|saveLabel=\"Save Persona\"\|SaveBar" apps/user-client/tests/
```

For each hit:
- Tests that fire `getByRole('button', { name: /save persona/i })` should fire
  `getByRole('button', { name: /save & back/i })` instead.
- Tests that asserted on Cancel-button behaviour should fire the Back button
  (`getByLabelText(/back/i)`) and expect the confirm dialog when dirty.
- Tests that count buttons in the SaveBar should drop that assertion.

The two principal test files affected:
- `apps/user-client/tests/unit/persona-editor.test.tsx`
- `apps/user-client/tests/routes/persona-editor.required-markers.test.tsx`
- `apps/user-client/tests/routes/persona-editor.dynamic-meta.test.tsx`
- `apps/user-client/tests/routes/persona-editor.font-and-voice.test.tsx`

The last three were primarily structural; spot-check them for any save-button
references.

- [ ] **Step 4: Run the full suite**

```bash
pnpm --filter @chatsundere/user-client typecheck && pnpm --filter @chatsundere/user-client test
pnpm lint
```

All green.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/tests/
git commit -m "$(cat <<'EOF'
Persona Editor: drop bottom SaveBar; Save & Back is the only persist path

Phase-2.6's split (bottom Save + top Save & Back) gave users two
ways to do the same thing — and the bottom Save's "persist + stay"
semantic didn't actually surface anywhere usable since the page is
a form, not a long-running surface. The top-right "Save & Back"
is enough. Discard happens through Back (with confirm-on-dirty).

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1: AccordionCard — scrollIntoView on open

**Files:**
- Modify: `apps/user-client/src/components/AccordionCard.tsx`
- Create: `apps/user-client/tests/components/AccordionCard.scroll-into-view.test.tsx`

When an accordion opens, its top should drift into view so the user can see the
revealed content without manually scrolling. Use `Element.scrollIntoView` with
`{ behavior: 'smooth', block: 'nearest' }` — `nearest` avoids scrolling when
the section is already fully visible, which is the most polite default.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/components/AccordionCard.scroll-into-view.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { AccordionCard } from '../../src/components/AccordionCard.js';

describe('AccordionCard scrollIntoView', () => {
  it('calls scrollIntoView when the accordion opens', () => {
    const scrollSpy = vi.fn();
    // jsdom doesn't implement scrollIntoView — stub it on the prototype.
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy as unknown as typeof Element.prototype.scrollIntoView;
    try {
      render(
        <AccordionCard icon="x" label="Section" meta="m">
          <p>hidden body</p>
        </AccordionCard>,
      );
      // Header click opens the accordion.
      fireEvent.click(screen.getByText('Section'));
      expect(scrollSpy).toHaveBeenCalled();
      const call = scrollSpy.mock.calls[0]?.[0] as ScrollIntoViewOptions | undefined;
      expect(call?.behavior).toBe('smooth');
      expect(call?.block).toBe('nearest');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('does not call scrollIntoView when the accordion closes', () => {
    const scrollSpy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy as unknown as typeof Element.prototype.scrollIntoView;
    try {
      render(
        <AccordionCard icon="x" label="Section" meta="m" defaultOpen>
          <p>visible</p>
        </AccordionCard>,
      );
      // Header click closes (was defaultOpen).
      scrollSpy.mockClear();
      fireEvent.click(screen.getByText('Section'));
      expect(scrollSpy).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm --filter @chatsundere/user-client test tests/components/AccordionCard.scroll-into-view.test.tsx
```

- [ ] **Step 3: Update AccordionCard**

Edit `apps/user-client/src/components/AccordionCard.tsx`:

3a. Add a ref to the root container:

```tsx
import { type ReactNode, useEffect, useRef, useState } from 'react';
```

3b. Inside the component:

```tsx
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [open]);
```

3c. Attach `ref={ref}` to the root `<div>`.

- [ ] **Step 4: Verify**

```bash
pnpm --filter @chatsundere/user-client test tests/components/AccordionCard.scroll-into-view.test.tsx
pnpm --filter @chatsundere/user-client test
```

All green.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/AccordionCard.tsx apps/user-client/tests/components/AccordionCard.scroll-into-view.test.tsx
git commit -m "$(cat <<'EOF'
AccordionCard: scroll into view when opening

Smooth-scrolls the accordion's root into view via Element.scrollIntoView
with block: 'nearest' (no-op when already visible) on every open. Per
Chris's iteration-3 feedback — Upstream Providers in particular would
expand below the viewport and require manual scrolling.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Entrance Hall — add sixth "My Account" tile + drop the global topbar gear icon

**Files:**
- Modify: `apps/user-client/src/routes/app/entrance-hall.tsx`
- Modify: `apps/user-client/src/routes/root.tsx`

Tile choice: place "My Account" as the **sixth** tile in the 2-column grid
(third row, right column — alongside the My Settings tile in third row, left
column). Icon: `⌬` (benzene-ring glyph, reads as "identity/profile" — distinct
from My Settings's `⚙`). If `⌬` looks odd in the prototype, fall back to `◐`.

- [ ] **Step 1: Update Entrance Hall — add the sixth tile**

In `apps/user-client/src/routes/app/entrance-hall.tsx`, locate the grid:

```tsx
      <div className="grid grid-cols-2 gap-3">
        <RoomTile label="My Circle" … />
        <RoomTile label="My Projects" … disabled … />
        <RoomTile label="My History" … disabled … />
        <RoomTile label="My Treasury" … disabled … />
        <RoomTile label="My Settings" … to="/app/settings" />
      </div>
```

Add a sixth `RoomTile` directly after "My Settings":

```tsx
        <RoomTile label="My Account" icon="⌬" meta="Identity & auth" to="/app/account" />
```

The grid stays `grid-cols-2`, so the layout becomes three rows of two tiles.

- [ ] **Step 2: Drop the gear-icon link from Root**

In `apps/user-client/src/routes/root.tsx`, locate the gear link (around line 43):

```tsx
          {session && (
            <Link
              to="/settings"
              aria-label="Settings"
              className="flex items-center gap-1 font-mono text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
            >
              <GearIcon size={15} />
              <span className="hidden lg:inline">Settings</span>
            </Link>
          )}
```

Remove the entire `<Link …>` block. Also remove the `GearIcon` import at the
top of the file (and the `Link` import if no other links remain).

After removal, the right-side header cluster reads:

```tsx
        <div className="flex items-center gap-2 lg:gap-3">
          {session && (
            <span className="hidden font-mono text-xs text-paper-soft lg:inline">
              {session.username}
            </span>
          )}
          <ConnectivityBadge />
        </div>
```

- [ ] **Step 3: Run the typecheck + tests**

```bash
pnpm --filter @chatsundere/user-client typecheck && pnpm --filter @chatsundere/user-client test
```

Expected: existing tests that asserted on the gear icon or `Settings` topbar
link will fail. Find them:

```bash
grep -rn "GearIcon\|aria-label=\"Settings\"\|/settings'\|/settings\"" apps/user-client/tests/
```

For each hit:
- Tests asserting on the gear's presence become stale — remove those expectations.
- Tests that navigated to `/settings` via the gear should be removed or rewritten
  to navigate via the new Hall tile to `/app/account` (the new Task-5 test file
  covers that flow more directly).

Mark this task complete only after the suite stays green.

- [ ] **Step 4: Lint**

```bash
pnpm lint
```

Clean.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/entrance-hall.tsx apps/user-client/src/routes/root.tsx apps/user-client/tests/
git commit -m "$(cat <<'EOF'
Entrance Hall: add My Account tile; drop topbar gear icon

The Hall gains a sixth RoomTile — "My Account" — sitting alongside
My Settings. Identity / auth / server-linking live there.

The global topbar's gear shortcut disappears: every settings-style
surface is now reachable through the Hall, matching the rooms model
of UX-CONCEPT. One way to reach a thing.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Build the four account-section components (ports of the old settings sub-pages)

**Files:**
- Create: `apps/user-client/src/routes/app/account-sections/account-section.tsx`
- Create: `apps/user-client/src/routes/app/account-sections/auth-methods-section.tsx`
- Create: `apps/user-client/src/routes/app/account-sections/server-linking-section.tsx`
- Create: `apps/user-client/src/routes/app/account-sections/about-section.tsx`

Each new file is a focused "body" component that renders the accordion's
contents — the parent `AccountPage` (Task 4) wraps each in an `AccordionCard`.
The existing logic in `apps/user-client/src/routes/settings/{account,auth-methods,about}.tsx`
ports almost verbatim into these section files (with the top-level
`<h2 className="font-display text-2xl italic text-paper">…</h2>` removed — the
accordion's `label` now carries the section title).

- [ ] **Step 1: Create `account-section.tsx`**

Copy the body of `apps/user-client/src/routes/settings/account.tsx` into
`apps/user-client/src/routes/app/account-sections/account-section.tsx`. Two
changes from the original:

1. Drop the `<h2 className="font-display text-2xl italic text-paper">{copy.settings.account.title}</h2>`
   line at the top — the accordion label replaces it.
2. The outer `<section className="space-y-10">` becomes `<div className="space-y-10">`
   (semantically the accordion is the section; this is its body).
3. Export the component as `AccountSection` instead of `Account`.

SPDX line 1, blank line 2, imports.

- [ ] **Step 2: Create `auth-methods-section.tsx`**

Copy the body of `apps/user-client/src/routes/settings/auth-methods.tsx` into
`apps/user-client/src/routes/app/account-sections/auth-methods-section.tsx`.
Same three changes (drop `<h2>`, `<section>` → `<div>`, rename export to
`AuthMethodsSection`).

- [ ] **Step 3: Create `about-section.tsx`**

Copy the body of `apps/user-client/src/routes/settings/about.tsx` into
`apps/user-client/src/routes/app/account-sections/about-section.tsx`. Drop the
`<h2>`, change `<section>` → `<div>`, rename export to `AboutSection`.

- [ ] **Step 4: Create `server-linking-section.tsx`**

This is the only new section — the old `server-linking.tsx` was just a
`<Navigate to="/onboarding/invitation" replace />` redirect, which is what
caused Chris's bug. The new section renders a status block + a "Link to server"
button that navigates to `/onboarding/invitation?return=/app/account`.

Create `apps/user-client/src/routes/app/account-sections/server-linking-section.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useNavigate } from 'react-router-dom';

interface Props {
  serverUrl?: string | null;
}

/**
 * Server-linking accordion body. Shows whether this device is linked to a
 * server (Block-1 baseline: never — local-only mode), and a "Link to server"
 * action that hands off to the invitation wizard with a return-URL set to
 * /app/account so its Back button comes home.
 */
export function ServerLinkingSection({ serverUrl }: Props): JSX.Element {
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
        <div className="text-xs uppercase tracking-widest text-paper-soft">Status</div>
        <div className="mt-1 font-mono text-sm text-paper">
          {serverUrl ? `Linked to ${serverUrl}` : 'Not linked — local-only mode'}
        </div>
      </div>
      <p className="text-[11px] text-paper-soft">
        Link this device to a server to enable cross-device sync (Block 2).
        Block 1 ships local-only — you can run Chatsundere without ever talking
        to a server.
      </p>
      <button
        type="button"
        onClick={() => navigate('/onboarding/invitation?return=/app/account')}
        className="rounded-md border border-paper px-4 py-2 text-xs uppercase tracking-wider text-paper hover:bg-paper/10"
      >
        Link to server
      </button>
    </div>
  );
}
```

For Block 1 we don't actually have server-link state on the device, so the
`serverUrl` prop will always be passed `null` from the parent — but the prop
exists so a future Block-2 work can hand the URL through without a structural
change.

- [ ] **Step 5: Run the typecheck + verify the section files compile in isolation**

```bash
pnpm --filter @chatsundere/user-client typecheck
```

No errors. (The Tests for these sections land alongside Task 4's `account.tsx`
parent — they're not exercised separately.)

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/routes/app/account-sections/
git commit -m "$(cat <<'EOF'
Add four account-section components

Ports the bodies of the old /settings sub-pages — Account, Auth
Methods, About — into focused section components under
src/routes/app/account-sections/, ready to be composed into accordions
by the new /app/account route. The fourth section, Server Linking,
is newly authored: it shows link-status + a "Link to server" button
that navigates to the invitation wizard with ?return=/app/account so
Back returns here instead of to /onboarding.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Build `/app/account` route — the new accordion-style page

**Files:**
- Create: `apps/user-client/src/routes/app/account.tsx`
- Create: `apps/user-client/tests/routes/account.test.tsx`
- Modify: `apps/user-client/src/App.tsx` (register the new route)

The page composes the four section components into four `AccordionCard`s with
an `EditorTopbar` at the top. No bottom SaveBar — each section persists its own
state (username rename has its inline save; passkey add/regen/remove are
transactional; server-linking hands off to the wizard).

`isDirty` for the topbar: always `false` here — there is no global draft. The
Back button on EditorTopbar simply navigates to `/app`. The "Save & Back" button
is hidden (we suppress it via a new optional prop — see Step 1 below).

- [ ] **Step 1: Extend EditorTopbar with an optional `hideSaveAndBack` prop**

Edit `apps/user-client/src/components/EditorTopbar.tsx`:

1a. Add the prop to `interface Props`:

```ts
  hideSaveAndBack?: boolean;
```

1b. In the destructured props:

```ts
export function EditorTopbar({
  title,
  isDirty,
  onBack,
  onSaveAndBack,
  saveDisabled = false,
  saveTooltip,
  hideSaveAndBack = false,
}: Props): JSX.Element {
```

1c. Wrap the Save & Back button render:

```tsx
      {hideSaveAndBack ? (
        <span className="w-[88px]" />
      ) : (
        <button
          type="button"
          onClick={onSaveAndBack}
          …
        >
          Save &amp; Back
        </button>
      )}
```

(The empty `<span>` keeps the centre title visually centred — match the rough
width of the Save & Back button.)

1d. Extend `apps/user-client/tests/components/EditorTopbar.test.tsx` with a case:

```tsx
  it('omits the Save & Back button when hideSaveAndBack is true', () => {
    render(
      <EditorTopbar
        title="X"
        isDirty={false}
        onBack={() => {}}
        onSaveAndBack={() => {}}
        hideSaveAndBack
      />,
    );
    expect(screen.queryByRole('button', { name: /save & back/i })).toBeNull();
  });
```

- [ ] **Step 2: Write the account.tsx route test**

Create `apps/user-client/tests/routes/account.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@chatsundere/crypto', () => ({
  CryptoError: class CryptoError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  changeUsername: vi.fn(),
  deleteLocalAccount: vi.fn(),
  getLocalAccount: vi.fn(async () => ({ username: 'liz', created_at: new Date('2026-01-01') })),
  listLocalBiometric: vi.fn(async () => []),
  regenerateRecoveryKey: vi.fn(),
  deletePasskeyCredential: vi.fn(),
}));

vi.mock('@chatsundere/ui-shared', async () => {
  return {
    ConfirmTyped: () => null,
    InlineMarker: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    useSessionStore: Object.assign(
      vi.fn(() => ({ mk: new Uint8Array(32) })),
      {
        getState: () => ({ mk: new Uint8Array(32), closeAndForget: vi.fn() }),
      },
    ),
  };
});

vi.mock('../../src/boot/open-db.js', () => ({
  getDb: () => ({}),
}));

vi.mock('../../src/lib/webauthn-availability.js', () => ({
  isWebAuthnAvailable: () => true,
}));

vi.mock('../../src/lib/webauthn.js', () => ({
  registerLocalBiometric: vi.fn(),
  PrfRequiredError: class extends Error {},
}));

vi.mock('../../src/lib/passkey-management.js', () => ({
  renamePasskey: vi.fn(),
}));

vi.mock('../../src/version.js', () => ({ APP_VERSION: '0.0.0-test' }));

import { AccountPage } from '../../src/routes/app/account.js';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccountPage', () => {
  it('renders the four accordion sections in the expected order', () => {
    setup();
    const headers = Array.from(
      document.querySelectorAll('[data-accordion-card] [data-accordion-label]'),
    ).map((n) => n.textContent?.trim() ?? '');
    expect(headers).toEqual(['Account', 'Auth Methods', 'Server Linking', 'About']);
  });

  it('renders the EditorTopbar with "My Account" title and no Save & Back button', () => {
    setup();
    expect(screen.getByText('My Account')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save & back/i })).toBeNull();
  });
});
```

- [ ] **Step 3: Verify it fails**

```bash
pnpm --filter @chatsundere/user-client test tests/routes/account.test.tsx
```

- [ ] **Step 4: Create `apps/user-client/src/routes/app/account.tsx`**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useNavigate } from 'react-router-dom';
import { AccordionCard } from '../../components/AccordionCard.js';
import { EditorTopbar } from '../../components/EditorTopbar.js';
import { AboutSection } from './account-sections/about-section.js';
import { AccountSection } from './account-sections/account-section.js';
import { AuthMethodsSection } from './account-sections/auth-methods-section.js';
import { ServerLinkingSection } from './account-sections/server-linking-section.js';

/**
 * My Account — the identity / auth / server-linking surface.
 *
 * Composes four sections into accordions: Account (username, sign-out,
 * destructive delete), Auth Methods (passkeys, recovery), Server Linking
 * (link-to-server hand-off), About (version, licence, docs). Each section
 * owns its own persistence (no global SaveBar); the topbar's Save & Back
 * is hidden because there is no global draft to persist.
 */
export function AccountPage(): JSX.Element {
  const navigate = useNavigate();

  return (
    <section className="flex flex-col gap-3 px-4 pb-8 pt-4">
      <EditorTopbar
        title="My Account"
        isDirty={false}
        onBack={() => navigate('/app')}
        onSaveAndBack={() => {}}
        hideSaveAndBack
      />

      <AccordionCard icon="◉" label="Account" meta="Username · sign-out · delete">
        <AccountSection />
      </AccordionCard>

      <AccordionCard icon="⚿" label="Auth Methods" meta="Passphrase · biometrics · recovery key">
        <AuthMethodsSection />
      </AccordionCard>

      <AccordionCard icon="⇄" label="Server Linking" meta="Link this device to a server">
        <ServerLinkingSection serverUrl={null} />
      </AccordionCard>

      <AccordionCard icon="ⓘ" label="About" meta="Version · licence · docs">
        <AboutSection />
      </AccordionCard>
    </section>
  );
}
```

- [ ] **Step 5: Register the new route in App.tsx**

Edit `apps/user-client/src/App.tsx`:

5a. Add the import:

```ts
import { AccountPage } from './routes/app/account.js';
```

5b. Inside the `<Route element={<ProtectedRoute />}>` block, add a new line
near the other `/app/*` routes:

```tsx
                  <Route path="/app/account" element={<AccountPage />} />
```

(Place it directly after the `<Route path="/app/settings" element={<MySettings />} />`
line for ordering symmetry.)

- [ ] **Step 6: Run the tests**

```bash
pnpm --filter @chatsundere/user-client test tests/routes/account.test.tsx
pnpm --filter @chatsundere/user-client typecheck
```

All green.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/EditorTopbar.tsx apps/user-client/src/routes/app/account.tsx apps/user-client/src/App.tsx apps/user-client/tests/
git commit -m "$(cat <<'EOF'
Add /app/account — accordion-style identity & auth page

Four accordions: Account (username/sign-out/delete), Auth Methods
(passkeys/recovery), Server Linking (link-to-server hand-off), About
(version/licence/docs). EditorTopbar with title "My Account"; no
global SaveBar because each section persists its own state. Topbar's
Save & Back is hidden via the new EditorTopbar.hideSaveAndBack prop.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Invitation wizard — respect `?return=` query param

**Files:**
- Modify: `apps/user-client/src/routes/onboarding/invitation/form.tsx`
- Modify: `apps/user-client/src/routes/onboarding/invitation/scan.tsx`
- Modify: `apps/user-client/src/routes/onboarding/invitation/confirm.tsx`
- Modify: `apps/user-client/src/routes/onboarding/invitation/recovery.tsx`
- Create: `apps/user-client/tests/routes/account.server-linking.test.tsx`

The invitation wizard's back-buttons currently navigate to `/onboarding` or to
the previous wizard step. When the wizard is reached via the new Server-Linking
section, the entry-point's back-target should be `/app/account` (the page that
sent us). Add a `?return=…` query param to all four step files: the first step
(form) uses `return` as its back-target; subsequent steps preserve the param
when they navigate forward, and read it from the URL when they need to support
a "back-out" of the wizard.

The cleanest pattern: each step calls a tiny helper `useReturnUrl()` that reads
`searchParams.get('return') ?? '/onboarding'` and exposes the back-URL. Forward
navigations preserve the search params (`navigate({ pathname, search })`).

- [ ] **Step 1: Read the current wizard step files**

```bash
ls apps/user-client/src/routes/onboarding/invitation/
cat apps/user-client/src/routes/onboarding/invitation/form.tsx
```

Notice the current back-button targets and how each step navigates to the next.

- [ ] **Step 2: Add the back-target reader**

In each of the four files, add at the top of the component:

```tsx
import { useSearchParams } from 'react-router-dom';

function useReturnUrl(): string {
  const [params] = useSearchParams();
  return params.get('return') ?? '/onboarding';
}
```

(The helper can be inlined per file or hoisted to a shared module. Hoisting is
not required — four uses is fine.)

Then in each step, replace the back navigation:
- `navigate('/onboarding')` → `navigate(useReturnUrl())`
- `navigate(-1)` → if the previous step also lives inside the wizard, preserve
  the relative `-1`; only the first step's back-button needs the return-URL.

For step transitions (forward), preserve the query string. Example: if `form.tsx`
navigates to `/onboarding/invitation/scan`, change it to:

```ts
const [search] = useSearchParams();
…
navigate({
  pathname: '/onboarding/invitation/scan',
  search: search.toString(),
});
```

This ensures `?return=/app/account` survives through every wizard step.

- [ ] **Step 3: Write the server-linking → wizard → back test**

Create `apps/user-client/tests/routes/account.server-linking.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServerLinkingSection } from '../../src/routes/app/account-sections/server-linking-section.js';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

describe('ServerLinkingSection → invitation wizard', () => {
  it('passes ?return=/app/account when the "Link to server" button is clicked', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/app/account']}>
          <Routes>
            <Route path="/app/account" element={<ServerLinkingSection serverUrl={null} />} />
            <Route path="/onboarding/invitation" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /link to server/i }));
    expect(screen.getByTestId('location').textContent).toBe(
      '/onboarding/invitation?return=/app/account',
    );
  });
});
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @chatsundere/user-client test tests/routes/account.server-linking.test.tsx
```

This test verifies just the section's navigation. The wizard's `return`
handling is verified manually in Chris's smoke.

- [ ] **Step 5: Run the full suite**

```bash
pnpm --filter @chatsundere/user-client typecheck && pnpm --filter @chatsundere/user-client test
pnpm lint
```

All green.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/routes/onboarding/invitation/ apps/user-client/tests/routes/account.server-linking.test.tsx
git commit -m "$(cat <<'EOF'
Invitation wizard: honour ?return= query param for back navigation

The wizard's first-step back-button now reads ?return= from the URL
(default /onboarding). Forward navigations preserve the search string
so the return-URL survives across all four steps. Fixes the bug Chris
caught: opening /settings/server-linking from the gear icon used to
redirect to /onboarding/invitation and then Back stranded the user on
the Onboarding matrix instead of returning to settings.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Delete the old `/settings` route + spec / STATUS updates

**Files:**
- Delete: `apps/user-client/src/routes/settings/` (entire directory)
- Modify: `apps/user-client/src/App.tsx` — drop the `/settings/*` routes
- Modify: `apps/user-client/src/routes/change-passphrase.tsx` — link targets
  swap from `/settings*` to `/app/account`
- Delete: any `apps/user-client/tests/unit/settings-*` test files that targeted
  the deleted sub-pages
- Modify: `superpowers/specs/2026-05-23-client-block-1-design.md` — add
  Decisions 42-47
- Modify: `obsidian/STATUS-CLIENT-ONLY.md` — Phase-2.7 Done block

- [ ] **Step 1: Drop the `/settings/*` routes from App.tsx**

In `apps/user-client/src/App.tsx`, remove the entire block:

```tsx
                  <Route path="/settings" element={<SettingsLayout />}>
                    <Route index element={<Navigate to="account" replace />} />
                    <Route path="account" element={<Account />} />
                    <Route path="auth-methods" element={<AuthMethods />} />
                    <Route path="server-linking" element={<ServerLinking />} />
                    <Route path="about" element={<About />} />
                  </Route>
```

Also remove the imports of `SettingsLayout`, `Account`, `AuthMethods`,
`ServerLinking`, `About`, and `Navigate` if no other route in the file uses
`Navigate`.

- [ ] **Step 2: Delete the old settings directory**

```bash
rm -rf apps/user-client/src/routes/settings/
ls apps/user-client/src/routes/
```

The directory and its five files (`layout.tsx`, `account.tsx`,
`auth-methods.tsx`, `server-linking.tsx`, `about.tsx`) are gone.

- [ ] **Step 3: Update change-passphrase.tsx**

```bash
grep -n "/settings" apps/user-client/src/routes/change-passphrase.tsx
```

Two hits (around lines 258 and 277). Replace:
- `to="/settings/server-linking"` → `to="/app/account"`
- `to="/settings"` → `to="/app/account"`

Both links should land the user on the new account page. (The previous
`/settings/server-linking` link was already broken — it would redirect to
`/onboarding/invitation` — so the new `/app/account` target is unambiguously
the right destination.)

- [ ] **Step 4: Remove any leftover tests targeting the deleted pages**

```bash
ls apps/user-client/tests/unit/ | grep -i settings
```

For each hit (e.g. `settings-layout.test.tsx`, `settings-account.test.tsx`,
`settings-auth-methods.test.tsx`, `settings-about.test.tsx`):
- Check if it's still relevant (i.e. it tests the deleted source files): delete
  it.
- If a test legitimately covers a behaviour we kept (e.g. the new
  `account-section.tsx` ports the same code), port the test to a new location
  under `tests/routes/account*.test.tsx`. Use judgement; most should be
  deletable since the new `tests/routes/account.test.tsx` covers the high-level
  composition.

Note: `tests/routes/settings.test.tsx` (My Settings, `/app/settings`) and
`tests/routes/settings.draft-save.test.tsx` (also My Settings) stay — they
target the active `/app/settings` route, not the deleted `/settings` route.

- [ ] **Step 5: Append Decisions 42-47 to the design spec**

Inside § 2 of `superpowers/specs/2026-05-23-client-block-1-design.md`, after
Decision 41, append:

```markdown
42. **My Account is a sixth Hall room.** The Entrance Hall gains a sixth
    `RoomTile` ("My Account", icon `⌬`, route `/app/account`). Together with
    My Settings (Decision 27's fifth room) the Hall has six tiles total: two
    active (My Circle, My Settings) — three active after this phase (plus My
    Account) — and three disabled stubs (My Projects, My History, My Treasury).
    Replaces UX-CONCEPT's "5 rooms" baseline. Rationale: Identity / auth /
    server-linking are distinct from per-persona defaults / providers / prompts;
    one room per concept matches the rooms model cleaner than overloading
    My Settings.

43. **One way to reach a thing.** The global topbar's gear-icon shortcut to
    `/settings` is removed. Account is reachable only via the Entrance Hall's
    My Account tile. Consistent with the rooms model; eliminates the
    inconsistency that arose when the gear icon (top-right shortcut) and the
    tile (in-Hall navigation) both pointed at the same place.

44. **`/app/account` is an accordion-style page with EditorTopbar.** Identical
    structural pattern to `/app/settings`: a single page with four sections
    rendered as `AccordionCard`s. Sections: **Account** (username,
    sign-out, delete-local), **Auth Methods** (passphrase, biometrics,
    recovery key), **Server Linking** (status + link-to-server hand-off),
    **About** (version, licence, docs). Each section persists its own state
    (username rename is inline; biometric flows are transactional; server-link
    hands off to the wizard) so there is no global draft / SaveBar. The
    EditorTopbar's Save & Back is hidden via the new `EditorTopbar.hideSaveAndBack`
    prop. Replaces the deleted tab-based `SettingsLayout` plus `/settings/*`
    sub-pages.

45. **Server Linking is not a route, it's an accordion section.** The previous
    `/settings/server-linking` was a redirect to `/onboarding/invitation` —
    which left the user on the onboarding matrix when they hit Back, the bug
    Chris caught. The new section renders status + a "Link to server" button
    that navigates to `/onboarding/invitation?return=/app/account`. The
    invitation wizard's back-button reads `?return=` (defaulting to
    `/onboarding`) and navigates there; forward-step navigations preserve the
    search params so the return-URL survives through all four wizard steps.

46. **Persona Editor: no bottom SaveBar.** The Phase-2.6 split of Save (bottom,
    persist + stay) + Save & Back (top, persist + navigate) collapsed to a
    single Save & Back path: a persona-edit form has no "stay" use-case, and
    two save-buttons doing similar things created confusion. Discard still
    happens through Back (with confirm-on-dirty). My Settings keeps its
    SaveBar — settings have a "stay" use-case (a long About-Me edit doesn't
    need to leave the page to commit). Asymmetry is fine; the surfaces have
    different shapes.

47. **AccordionCard `scrollIntoView` on open.** Every `AccordionCard` smooth-
    scrolls itself into view (`block: 'nearest'`) when it opens. Polite —
    only scrolls if needed. Fixes the Upstream Providers case where expanding
    the accordion would push the provider list below the viewport on small
    screens.
```

Also annotate Decision 27 in-place: the "Rooms-Grid" now has six tiles, not
five — add a parenthetical: `(extended to six tiles by Decision 42)`.

- [ ] **Step 6: Update `STATUS-CLIENT-ONLY.md`**

Add a Phase-2.7 Done block summarising what landed; update the `Doing now` to
"Phase 2.7 finished. Paused for Chris's iteration-4 smoke"; refresh the `Next
session` block with the iteration-4 manual smoke checklist.

The smoke items are: the new "My Account" tile is visible in the Hall (sixth
tile); the global topbar no longer has a gear icon; tapping My Account opens
the accordion page; the four accordions are present and titled correctly;
opening any accordion smooth-scrolls into view; Server Linking shows status
+ "Link to server" button; clicking the button opens the invitation wizard;
the wizard's Back button now returns to /app/account (was: /onboarding); the
Persona Editor has no bottom SaveBar — Save & Back at the top is the only
persist path.

- [ ] **Step 7: Run the full suite + lint once more**

```bash
pnpm --filter @chatsundere/user-client typecheck && pnpm --filter @chatsundere/user-client test
pnpm lint
```

All green.

- [ ] **Step 8: Commit**

```bash
git add apps/user-client/src/App.tsx apps/user-client/src/routes/change-passphrase.tsx superpowers/specs/2026-05-23-client-block-1-design.md obsidian/STATUS-CLIENT-ONLY.md
git rm -r apps/user-client/src/routes/settings/
# plus any deleted test files via git rm:
# git rm apps/user-client/tests/unit/settings-*.test.tsx
git status
git commit -m "$(cat <<'EOF'
Remove old /settings route; document Phase 2.7 [skip ci]

The /settings/* routes and the SettingsLayout component are gone —
their content lives in the new /app/account page (composed of four
account-section components). The change-passphrase route's links to
/settings move to /app/account.

Decisions 42-47 added to the Block-1 design spec covering the
Phase-2.7 architectural moves. STATUS-CLIENT-ONLY gains the
Phase-2.7 Done block and the iteration-4 smoke checklist.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## End-of-Phase Squash

After Task 6 commits, squash the per-task commits into a single Phase-2.7
commit on master.

```bash
BASE=8e4abd4  # Phase 2.6 squash
git reset --soft $BASE
git status  # sanity-check
git commit -m "$(cat <<'EOF'
Land Client Block 1 Phase 2.7 — My Account room + Polish iteration 3

Following Chris's iteration-3 device-smoke, this phase consolidates
the long-standing /settings tab-page into a single accordion-style
/app/account room reachable from the Entrance Hall, fixes the
server-linking → Back → onboarding bug, and removes the now-redundant
bottom SaveBar from the Persona Editor.

Highlights:
- Persona Editor's bottom SaveBar removed — Save & Back (topbar) is
  the only persist path. Discard via Back with confirm-on-dirty.
- AccordionCard smooth-scrolls itself into view (block: 'nearest')
  when it opens.
- Entrance Hall gets a sixth RoomTile "My Account" (icon ⌬, route
  /app/account). The global topbar's gear-icon shortcut to /settings
  is removed.
- New /app/account accordion-style page with EditorTopbar (Save & Back
  hidden via EditorTopbar.hideSaveAndBack). Four sections: Account
  (username/sign-out/delete), Auth Methods (passphrase/biometrics/
  recovery key), Server Linking, About.
- Server Linking is now an accordion section that hands off to
  /onboarding/invitation?return=/app/account. The invitation wizard
  reads ?return= and uses it as its back-target; forward-step
  navigations preserve the search params.
- Old /settings route + SettingsLayout + four sub-page files deleted.
  change-passphrase links migrated to /app/account.
- Decisions 42-47 documented; STATUS-CLIENT-ONLY refreshed with the
  iteration-4 smoke checklist.

Tests: 4 new Vitest cases across AccordionCard scrollIntoView (2
cases), EditorTopbar hideSaveAndBack, account.tsx composition (2
cases), server-linking section navigation. Existing persona-editor
tests adjusted for the SaveBar removal. All user-client tests pass;
typecheck and Biome lint clean.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage** — every iteration-3 feedback item:

| Feedback | Task |
|---|---|
| Save Persona unten weg | T0 |
| Akkordeon-open into-view scroll | T1 |
| `/settings` Back lands on Onboarding (bug) | T5 (return-URL handling) |
| Server Linking als Tab statt eigene Seite | T3 (accordion section) + T5 (no more redirect) |
| Settings (rechts oben) auf Akkordeon-System | T4 (/app/account composition) |
| "My Account" als Hall-Tile | T2 |
| Gear-icon shortcut | T2 (Recommended option: removed) |

All 7 items map to a task. Plus three sweeping consequences: the wizard
return-URL handling, the route-table cleanup, and the spec updates.

**2. Placeholder scan** — no TODO / TBD / "implement later" strings. Every code
block is concrete.

**3. Type consistency** — `AccountPage` exported from `account.tsx`; consumed
in `App.tsx`. Four section component names spelled identically across the
section file, the route file, and the test file (`AccountSection`,
`AuthMethodsSection`, `ServerLinkingSection`, `AboutSection`). The
`EditorTopbar.hideSaveAndBack` prop spelled consistently. `useReturnUrl()`
helper used identically (or inlined identically) in each of the four
invitation wizard step files.

Plan complete and saved to
`superpowers/plans/2026-05-24-client-block-1-phase-2-7-account-room.md`.
