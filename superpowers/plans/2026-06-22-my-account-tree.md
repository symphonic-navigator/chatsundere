# My Account — Page Tree Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Plan 1 (`2026-06-22-my-account-page-bar-primitives.md`) must be landed first** — every task here consumes `PageScaffold`, `ReadingOverlay`, and the `NavTile` `onActivate` extension from it.

**Goal:** Rebuild `/app/account` in the design language — a dashboard + 2×3 navigation matrix — and the six sub-pages it leads to (Biometric, Recovery Key, Server linking, About, Change passphrase reskin, Logout), all under the shared Page Bar with the always-save model and per-page `?` help via the Reading Overlay.

**Architecture:** Eight tasks. Task 1 lands the content layer (the 7 per-page help docs + the About licence/privacy/third-party Markdown + a `useHelp` hook + a `*.md?raw` type shim) so every later page can wire `?` help and the About overlays without re-inventing it. Tasks 2-8 build the page and its sub-pages. The **functional logic is ported verbatim** from the existing `routes/app/account-sections/*` modules (the lib calls, error handling, state machines are correct and audited); what changes is the *chrome* (`PageScaffold` replacing `EditorSticky`/`EditorTopbar`/`AccordionCard`) and the *model* (always-save: blur/Enter persists, no Save & Back). The current `account.tsx` and `account-sections/*` are deleted as their logic re-homes into routes. Each sub-page is a route under `ProtectedRoute`; the matrix tiles reach them via `NavTile to=` (zoom inherited) — except the About overlay/external tiles, which use `NavTile onActivate`.

**Tech Stack:** TypeScript (strict), React 18, react-router-dom 6, TanStack Query (settings), Dexie/IndexedDB (crypto flows), Vitest + Testing Library, Vite `?raw` imports, `lucide-react`.

**Reference:** Spec `superpowers/specs/2026-06-22-my-account-and-page-bar-design.md` (§3 My Account, §4 sub-pages, §6 help, §7 content, §13 carry-over). Existing source-of-truth modules to port from:
- `src/routes/app/account.tsx` (the page being replaced; deleted at the end)
- `src/routes/app/account-sections/account-section.tsx` (display name, username rename, sign out, delete)
- `src/routes/app/account-sections/auth-methods-section.tsx` (biometrics list/add/rename/remove, recovery regen)
- `src/routes/app/account-sections/server-linking-section.tsx`
- `src/routes/app/account-sections/about-section.tsx`
- `src/routes/app/account-sections/dev-tools-section.tsx`
- `src/routes/change-passphrase.tsx` (kept; reskinned)

**Exact APIs (verified):**
- Settings: `useSettings()` → `{ data: SettingsRow }`, `useUpdateSettings()` → mutation taking `Partial<Omit<SettingsRow,'id'|'createdAt'>>`; `SettingsRow.displayName: string`. Both from `src/data/settings.ts`.
- Username: `changeUsername({ db, newUsername, serverPatch? })` from `@chatsundere/crypto`; `CryptoError` with `.code` (`'invalid_input'` on a bad username) from `@chatsundere/crypto`.
- Biometrics: `registerLocalBiometric(label)`, `PrfRequiredError` from `src/lib/webauthn.ts`; `isWebAuthnAvailable()` from `src/lib/webauthn-availability.ts`; `renamePasskey({ db, credentialId, newLabel })` from `src/lib/passkey-management.ts`; `listPasskeyCredentials`, `deletePasskeyCredential` from `@chatsundere/crypto`; row type `PasskeyCredentialRow` (`credential_id`, `aaguid`, `label`).
- Recovery: `regenerateRecoveryKey({ db, mk })` → `{ recoveryKeyString }` from `@chatsundere/crypto`; `mk` via `useSessionStore((s) => s.mk)` (type `MasterKey | null`).
- Account exit: `deleteLocalAccount(db)` from `@chatsundere/crypto`; `useSessionStore.getState().closeAndForget()`.
- Display components: `RecoveryKeyReveal({ value })`; `ConfirmTyped({ open, title, body, confirmToken, confirmTokenLabel, destructiveCta, cancelCta, onCancel, onConfirm, busy })` from `@chatsundere/ui-shared`; `ConfirmDialog` from `src/components/ui/`.
- Version object: import as the current `about-section.tsx` does (from `../../../lib/version.js`; exposes `.version`, `.sha`, `.builtAt`).
- Third-party: `THIRD_PARTY_LICENCES: readonly ThirdPartyEntry[]` (`name`, `version`, `licence`, `homepage`) from `src/lib/third-party-licences.ts`.
- Copy: `copy.settings.about` (`privacy.*`, `thirdParty.*`, `licence.*`) from `src/lib/copy.ts`.

## Global Constraints

- **British English** everywhere (project hard rule §3.7), including all help/privacy prose.
- **TypeScript strict + `noUncheckedIndexedAccess`.** No `any` without an inline comment.
- **Always-save model (spec §2.3):** free-text fields persist on blur AND Enter with a transient polite-live-region `Saved ✓`; validated fields persist only when valid, else inline error keeping the value + focus; blur/Enter de-dupe to a single persist + single announcement. No Save/Save-and-Back control anywhere in this tree.
- **Disabled over hidden:** unavailable actions stay focusable with an announced reason (Add biometric when WebAuthn absent; Regenerate when `mk` null).
- **Red discipline (spec §8):** matrix tiles use the **nav palette** (`NavTile colour`); the destructive red (`Button tone="destructive"`, `ConfirmTyped destructiveCta`) appears only on Delete / Regenerate / Remove-last-biometric.
- **Biome bans `!`.** Use a `// biome-ignore` line with a reason where unavoidable.
- **Gate before every commit (run yourself):** `pnpm typecheck --force` (14/14), `pnpm biome check <changed>` clean, full `pnpm test` at the **8 Node-localStorage baseline** (a 9th is a real regression). From `apps/user-client`; tests under `apps/user-client/tests/`.
- **Routes added (App.tsx, under `ProtectedRoute`):** `/app/account/biometric`, `/app/account/recovery`, `/app/account/server-linking`, `/app/account/about`, `/app/account/about/devtools`, `/app/account/logout`. `/change-passphrase` stays.
- **Dropped for the alpha (spec §13):** the "Account created" date and the About "Documentation" link. Do not carry them over.

---

### Task 1: Content layer — help docs, About text, `useHelp` hook

All per-page help (7 docs), the About licence/privacy/third-party Markdown, and a `useHelp` hook that returns a ready `onHelp` + overlay so each page wires `?` in one line.

**Files:**
- Create: `apps/user-client/src/content/help/my-account.md`, `biometric.md`, `recovery.md`, `server-linking.md`, `about.md`, `change-passphrase.md`, `logout.md`
- Create: `apps/user-client/src/content/help/index.ts` (registry)
- Create: `apps/user-client/src/content/help/use-help.tsx` (the hook)
- Create: `apps/user-client/src/content/about/privacy.md`
- Create: `apps/user-client/src/content/about/agpl-3.0.md`
- Create: `apps/user-client/src/content/about/third-party.ts` (`renderThirdPartyMarkdown()`)
- Modify: `apps/user-client/src/vite-env.d.ts` (add `*.md?raw` module declaration if absent — check first)
- Test: `apps/user-client/tests/content/help.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type HelpKey = 'my-account' | 'biometric' | 'recovery' | 'server-linking' | 'about' | 'change-passphrase' | 'logout';
  export const HELP_DOCS: Record<HelpKey, { title: string; markdown: string }>;
  export function useHelp(key: HelpKey): { onHelp: () => void; helpOverlay: ReactNode };
  export function renderThirdPartyMarkdown(): string;
  export const PRIVACY_MD: string;
  export const AGPL_MD: string;
  ```

- [ ] **Step 1: Add the `?raw` type shim (if missing)**

Check `src/vite-env.d.ts`. If there is no declaration for `*.md?raw`, add:

```ts
declare module '*.md?raw' {
  const content: string;
  export default content;
}
```

- [ ] **Step 2: Write the seven help docs**

Concise, warm, British English. The My Account doc explains the sub-pages (spec §6). Example content (write all seven in this voice):

`my-account.md`:
```markdown
# My Account

Everything about *you* on this device lives here.

- **Username & display name** — change them at the top. Changes save as you go; there is no Save button.
- **Biometric** — set up Face ID / fingerprint / a security key to unlock faster on this device.
- **Recovery Key** — generate a fresh backup code. Your recovery key is the only way back in if you forget your passphrase.
- **Server linking** — connect this device to a server for cross-device sync, or stay local-only.
- **About** — version, licence, source code, privacy, and the open-source libraries Chatsundere is built on.
- **Change passphrase** — set a new passphrase.
- **Logout** — sign out (your encrypted data stays), or delete everything on this device.
```

`biometric.md`:
```markdown
# Biometric

Unlock Chatsundere with your device's biometrics or a security key instead of typing your passphrase.

Tap **Add biometric** and follow your device's prompt. You can rename or remove a biometric at any time. Removing your last one means you'll unlock with your passphrase again.

Chatsundere requires a passkey that supports the PRF extension, so your master key stays protected — the server never sees it.
```

`recovery.md`:
```markdown
# Recovery Key

Your recovery key is the only way back into your account if you forget your passphrase. There is no "forgot password" — this is by design.

**Regenerate** creates a fresh key and invalidates the old one immediately. Save the new key somewhere safe before you leave this screen.

You can only regenerate while signed in with your passphrase or recovery key (not a biometric-only session).
```

`server-linking.md`:
```markdown
# Server linking

Chatsundere runs perfectly on its own — all your data stays on this device, encrypted.

Linking to a server lets you sync across devices. The server only ever stores ciphertext; it can never read your conversations or keys.
```

`about.md`:
```markdown
# About

Version and build details, plus quick access to the things that matter for a project you can trust:

- **License** — Chatsundere is AGPLv3.
- **Source Code** — read every line on GitHub.
- **Privacy** — what we store and what we can (and can't) see.
- **Third-party libraries** — the open-source work we stand on.
```

`change-passphrase.md`:
```markdown
# Change passphrase

Set a new passphrase for this account. You'll need your current one.

Your passphrase never leaves your device in the clear — the server authenticates you without ever seeing it.
```

`logout.md`:
```markdown
# Logout

**Sign out** ends your session. Your encrypted data stays on this device, ready for next time.

**Delete all local data** wipes everything on this device permanently. There is no recovery. You'll be asked to type your username to confirm.
```

- [ ] **Step 3: Write the privacy notice**

`privacy.md` — expand the existing `copy.settings.about.privacy` themes, staying close to that wording (spec §7, Chris's note). British English:

```markdown
# Privacy & data handling

## Where is my data stored?

All your data — conversations, companions, settings — stays on **your device**, encrypted with a key derived from your passphrase. Nothing is uploaded unless you explicitly link a server for sync, and even then the server only ever stores ciphertext.

## Can Chatsundere see my conversations?

No. Your messages are encrypted with a key only you hold. The server, and anyone running it, sees ciphertext and nothing more. It cannot decrypt your data, see your passphrase, or derive your keys.

## Can third-party services see my data?

Only with your explicit permission, on a per-provider basis. When you send a message to an AI provider you have configured, that message goes to that provider so it can reply. You choose which providers to use; Chatsundere adds no hidden recipients.

## What if I lose my recovery key?

You lose access to your data. There is no back door and no "forgot password" — that absence is the point. Keep your recovery key somewhere safe.
```

- [ ] **Step 4: Add the AGPL text**

Create `agpl-3.0.md` containing the verbatim GNU Affero General Public License v3.0. **Source it from the repository's own licence** — copy the existing AGPL-3.0 text from the repo (e.g. the root `LICENSE`/`LICENCE` file, or `apps/user-client`'s licence file if present); if none exists in-repo, copy the canonical text from `https://www.gnu.org/licenses/agpl-3.0.txt`. This is a fixed legal document — reproduce it exactly, no edits. Prefix with a single `# GNU Affero General Public License v3.0` heading.

- [ ] **Step 5: Implement the third-party renderer**

```ts
// src/content/about/third-party.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { THIRD_PARTY_LICENCES } from '../../lib/third-party-licences.js';

/** Render the bundled third-party licence list as Markdown (single source of
 *  truth — the structured array in third-party-licences.ts). */
export function renderThirdPartyMarkdown(): string {
  const intro =
    'Chatsundere is built on the following open-source libraries. Thank you to everyone who made them.';
  const rows = THIRD_PARTY_LICENCES.map(
    (e) => `- **${e.name}** \`v${e.version}\` — ${e.licence} — [${e.homepage}](${e.homepage})`,
  ).join('\n');
  return `# Third-party libraries\n\n${intro}\n\n${rows}\n`;
}
```

- [ ] **Step 6: Implement the registry + `useHelp` hook**

```ts
// src/content/help/index.ts
// SPDX-License-Identifier: AGPL-3.0-only
import myAccount from './my-account.md?raw';
import biometric from './biometric.md?raw';
import recovery from './recovery.md?raw';
import serverLinking from './server-linking.md?raw';
import about from './about.md?raw';
import changePassphrase from './change-passphrase.md?raw';
import logout from './logout.md?raw';
import privacy from '../about/privacy.md?raw';
import agpl from '../about/agpl-3.0.md?raw';

export type HelpKey =
  | 'my-account' | 'biometric' | 'recovery' | 'server-linking'
  | 'about' | 'change-passphrase' | 'logout';

export const HELP_DOCS: Record<HelpKey, { title: string; markdown: string }> = {
  'my-account': { title: 'My Account — help', markdown: myAccount },
  biometric: { title: 'Biometric — help', markdown: biometric },
  recovery: { title: 'Recovery Key — help', markdown: recovery },
  'server-linking': { title: 'Server linking — help', markdown: serverLinking },
  about: { title: 'About — help', markdown: about },
  'change-passphrase': { title: 'Change passphrase — help', markdown: changePassphrase },
  logout: { title: 'Logout — help', markdown: logout },
};

export const PRIVACY_MD: string = privacy;
export const AGPL_MD: string = agpl;
```

```tsx
// src/content/help/use-help.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { type ReactNode, useState } from 'react';
import { ReadingOverlay } from '../../components/ui/ReadingOverlay.js';
import { HELP_DOCS, type HelpKey } from './index.js';

/** One-line `?` help wiring for a page: returns the onHelp handler for the
 *  PageBar and the overlay element to render. */
export function useHelp(key: HelpKey): { onHelp: () => void; helpOverlay: ReactNode } {
  const [open, setOpen] = useState(false);
  const doc = HELP_DOCS[key];
  return {
    onHelp: () => setOpen(true),
    helpOverlay: (
      <ReadingOverlay open={open} title={doc.title} markdown={doc.markdown} onClose={() => setOpen(false)} />
    ),
  };
}
```

- [ ] **Step 7: Write the failing-then-passing content test**

```ts
// tests/content/help.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { AGPL_MD, HELP_DOCS, PRIVACY_MD } from '../../src/content/help/index.js';
import { renderThirdPartyMarkdown } from '../../src/content/about/third-party.js';

describe('content layer', () => {
  it('has a non-empty help doc with a heading for every key', () => {
    for (const [key, doc] of Object.entries(HELP_DOCS)) {
      expect(doc.markdown.length, key).toBeGreaterThan(20);
      expect(doc.markdown, key).toMatch(/^#\s/m);
      expect(doc.title, key).toMatch(/help/i);
    }
  });
  it('my-account help mentions the sub-pages', () => {
    const md = HELP_DOCS['my-account'].markdown;
    for (const word of ['Biometric', 'Recovery', 'Server linking', 'About', 'Logout']) {
      expect(md).toContain(word);
    }
  });
  it('privacy + AGPL are bundled and non-trivial', () => {
    expect(PRIVACY_MD).toMatch(/Privacy/);
    expect(AGPL_MD.length).toBeGreaterThan(1000);
  });
  it('third-party renders a bullet list from the structured data', () => {
    const md = renderThirdPartyMarkdown();
    expect(md).toMatch(/^#\sThird-party/m);
    expect(md).toMatch(/- \*\*.+\*\* `v.+`/);
  });
});
```

Run: `pnpm test tests/content/help.test.ts` → PASS (after the files exist; run it once before content to see it fail on the missing imports).

- [ ] **Step 8: Gate + commit**

Run: `pnpm typecheck --force` → 14/14; `pnpm biome check src/content` → clean; `pnpm test tests/content/help.test.ts` → PASS.

```bash
git add apps/user-client/src/content apps/user-client/src/vite-env.d.ts apps/user-client/tests/content/help.test.ts
git commit -m "Add My Account content layer: help docs, privacy, AGPL, third-party

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: My Account page (dashboard + matrix)

Replace `account.tsx` with the dashboard (username + display name inline-edit, biometrics/server/version badges) and the 2×3 nav matrix. Port the username-rename + display-name logic from `account-section.tsx` into the always-save model.

**Files:**
- Modify: `apps/user-client/src/routes/app/account.tsx` (full rewrite of `AccountPage`)
- Create: `apps/user-client/src/routes/app/account/InlineEditRow.tsx` (the save-on-blur field with `Saved ✓`)
- Test: `apps/user-client/tests/routes/account-page.test.tsx`

**Interfaces:**
- Consumes: `PageScaffold` (Plan 1), `NavTile`, `Badge`, `useSettings`/`useUpdateSettings`, `changeUsername`, `CryptoError`, `useSession`/session username source (read how `account-section.tsx` gets the current username), `listPasskeyCredentials`, version object, `useHelp('my-account')`.
- Produces: `InlineEditRow` with:
  ```ts
  interface InlineEditRowProps {
    label: string;
    value: string;                 // current stored value ('' allowed)
    placeholder?: string;          // shown when value is empty (e.g. the username)
    validate?: (next: string) => string | null; // return an error message, or null if OK
    onSave: (next: string) => Promise<void>;     // persist; throws to signal failure
  }
  ```

- [ ] **Step 1: Write the failing `InlineEditRow` + page test**

```tsx
// tests/routes/account-page.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { InlineEditRow } from '../../src/routes/app/account/InlineEditRow.js';

describe('InlineEditRow', () => {
  it('saves on blur and shows Saved ✓', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEditRow label="Display name" value="" placeholder="navigator" onSave={onSave} />);
    const input = screen.getByLabelText('Display name');
    fireEvent.change(input, { target: { value: 'Nav' } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Nav'));
    expect(await screen.findByText(/Saved/)).toBeInTheDocument();
  });

  it('does not save when unchanged', () => {
    const onSave = vi.fn();
    render(<InlineEditRow label="Display name" value="Nav" onSave={onSave} />);
    fireEvent.blur(screen.getByLabelText('Display name'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('blocks save on validation failure, keeps value + shows error', async () => {
    const onSave = vi.fn();
    const validate = (v: string) => (v.includes(' ') ? 'No spaces allowed' : null);
    render(<InlineEditRow label="Username" value="nav" validate={validate} onSave={onSave} />);
    const input = screen.getByLabelText('Username');
    fireEvent.change(input, { target: { value: 'bad name' } });
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByText('No spaces allowed')).toBeInTheDocument();
    expect(input).toHaveValue('bad name');
  });
});
```

- [ ] **Step 2: Run it, expect failure** — `pnpm test tests/routes/account-page.test.tsx` → FAIL (no `InlineEditRow.js`).

- [ ] **Step 3: Implement `InlineEditRow`**

```tsx
// src/routes/app/account/InlineEditRow.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useId, useRef, useState } from 'react';

export interface InlineEditRowProps {
  label: string;
  value: string;
  /** Shown when the field is empty (e.g. the username for an empty display name). */
  placeholder?: string;
  /** Return an error message to block the save, or null when the value is valid. */
  validate?: (next: string) => string | null;
  /** Persist the new value; throw to signal a failed save (value + focus kept). */
  onSave: (next: string) => Promise<void>;
}

/**
 * A save-as-you-go field (spec §2.3): persists on blur AND Enter, shows a
 * transient polite-live-region "Saved ✓", and — for validated fields — blocks
 * the save on invalid input, keeping the value and focus with an inline error.
 * Blur and Enter de-dupe to a single persist + single announcement.
 */
export function InlineEditRow({ label, value, placeholder, validate, onSave }: InlineEditRowProps): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);

  const commit = async (): Promise<void> => {
    if (savingRef.current) return; // de-dupe blur+Enter
    if (draft === value) return;
    const err = validate?.(draft) ?? null;
    if (err) {
      setError(err);
      return;
    }
    savingRef.current = true;
    setError(null);
    try {
      await onSave(draft);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('Could not save. Please try again.');
    } finally {
      savingRef.current = false;
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs uppercase tracking-wider text-paper-soft">
        {label}
      </label>
      <input
        id={id}
        className="rounded-lg border border-paper-soft/15 bg-white/5 px-3 py-2 text-paper"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
      />
      <div aria-live="polite" className="min-h-[1rem] text-xs">
        {error ? <span className="text-destructive-text">{error}</span> : null}
        {saved ? <span className="text-nav-green-icon">Saved ✓</span> : null}
      </div>
    </div>
  );
}
```

(If `text-destructive-text` / `text-nav-green-icon` are not valid Tailwind utilities in this project, use inline `style={{ color: 'var(--color-destructive-text)' }}` / `var(--color-nav-green-icon)` — those CSS variables are confirmed to exist.)

- [ ] **Step 4: Rewrite `AccountPage`**

Wrap in `PageScaffold` (`back="/app"`, `crumbs={[{ label: 'My Account' }]}`, `onHelp` from `useHelp('my-account')`). Render the help overlay. Dashboard then matrix:

- **Username** — `InlineEditRow` with `validate` rejecting empty / invalid (mirror the validation the current `account-section.tsx` relies on — it catches `CryptoError` code `'invalid_input'`; here, pre-validate non-empty and let `onSave` call `changeUsername({ db, newUsername })`, translating a thrown `CryptoError`/`invalid_input` into the inline error by rethrowing so `InlineEditRow` shows "Could not save" — or pass a `validate` that mirrors the client-side rule). Acquire `db` exactly as `account-section.tsx` does.
- **Display name** — `InlineEditRow` with `value={settings.displayName}`, `placeholder={username}`, `onSave={(v) => updateSettings.mutateAsync({ displayName: v.trim() })}`. The **read view above the matrix** shows the effective name `displayName || username` (so the user always sees what others see); the edit field itself holds the raw `displayName` with the username as placeholder.
- **Badges (read-only):** Biometrics — `Badge tone="success"` "Configured (N)" when `listPasskeyCredentials` returns ≥1, else `Badge tone="neutral"` "Not set up"; Server link — `Badge tone="neutral"` "Local-only mode" (Block 1; wire real status when linking lands); Version — plain `v{version} · sha {sha}`.
- **Matrix** (`<div className="grid grid-cols-2 gap-3">`), nav palette:
  ```tsx
  <NavTile colour="pink" icon={Fingerprint} label="Biometric" to="/app/account/biometric" meta="unlock on this device" />
  <NavTile colour="pink" icon={KeyRound} label="Recovery Key" to="/app/account/recovery" meta="your backup code" />
  <NavTile colour="blue" icon={Link2} label="Server linking" to="/app/account/server-linking" meta="sync across devices" />
  <NavTile colour="blue" icon={Info} label="About" to="/app/account/about" meta="version, licence, privacy" />
  <NavTile colour="purple" icon={Lock} label="Change passphrase" to="/change-passphrase" meta="set a new passphrase" />
  <NavTile colour="purple" icon={LogOut} label="Logout" to="/app/account/logout" meta="sign out · delete data" />
  ```
  (Icons from `lucide-react`. The Logout meta names what the page holds — Laura HARD-2 discoverability.)

- [ ] **Step 5: Run the page test + add a page-level render case**

Add a test that renders `AccountPage` (mock `useSettings`/session/`listPasskeyCredentials` per the `tests/unit/use-send-message.test.tsx` seeding pattern) asserting: the six matrix tiles are present with the right `to`, the Logout meta contains "sign out", and no "Save & Back" control exists. Run: `pnpm test tests/routes/account-page.test.tsx` → PASS.

- [ ] **Step 6: Gate + commit**

```bash
git add apps/user-client/src/routes/app/account.tsx apps/user-client/src/routes/app/account/InlineEditRow.tsx apps/user-client/tests/routes/account-page.test.tsx
git commit -m "Rebuild My Account as dashboard + nav matrix with always-save fields

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: Biometric sub-page

Port the biometric add/list/rename/remove logic from `auth-methods-section.tsx` into a route under `PageScaffold`.

**Files:**
- Create: `apps/user-client/src/routes/app/account/biometric.tsx`
- Modify: `apps/user-client/src/App.tsx` (add the route)
- Test: `apps/user-client/tests/routes/account-biometric.test.tsx`

**Interfaces:**
- Consumes: `PageScaffold`, `Button`, `ListRow`, `ConfirmDialog`, `registerLocalBiometric`, `isWebAuthnAvailable`, `PrfRequiredError`, `listPasskeyCredentials`, `renamePasskey`, `deletePasskeyCredential`, `useHelp('biometric')`.

- [ ] **Step 1: Read `auth-methods-section.tsx`** and lift ONLY the biometric half (add, list, rename inline, remove-with-lockout-guard, the `addState`/`renameStates`/`removeState` machines + the PRF/availability handling). Leave the recovery half for Task 4.

- [ ] **Step 2: Write the failing test** — render the page (mock `listPasskeyCredentials` to return one row + `isWebAuthnAvailable` true), assert: PageBar crumbs `My Account / Biometric`, an "Add biometric" button, the existing biometric's label in a `ListRow`, and (mock `isWebAuthnAvailable` false in a second case) the Add button disabled with a reason. Use the seeding/mocks pattern from `tests/unit/use-send-message.test.tsx`.

- [ ] **Step 3: Implement `biometric.tsx`**

Structure:
```tsx
export function BiometricPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('biometric');
  // … ported state machines + handlers from auth-methods-section (biometric half) …
  return (
    <PageScaffold back="/app/account" crumbs={[{ label: 'My Account', to: '/app/account' }, { label: 'Biometric' }]} onHelp={onHelp}>
      {helpOverlay}
      {/* status + ListRow per credential (Rename inline, Remove via ConfirmDialog with last-one lockout copy) */}
      {/* <Button tone="primary"> Add biometric — disabled-with-title when !isWebAuthnAvailable() */}
    </PageScaffold>
  );
}
```
Keep every lib call and error branch identical to the source (PRF refusal message, silent user-cancel, list reload after add). Remove uses `ConfirmDialog` (destructive); the last-biometric case shows the lockout warning in the dialog body.

- [ ] **Step 4: Add the route** — in `App.tsx`, import `BiometricPage` and add under `ProtectedRoute`: `<Route path="/app/account/biometric" element={<BiometricPage />} />`.

- [ ] **Step 5: Run test + gate + commit**

```bash
git add apps/user-client/src/routes/app/account/biometric.tsx apps/user-client/src/App.tsx apps/user-client/tests/routes/account-biometric.test.tsx
git commit -m "Add Biometric sub-page (add/list/rename/remove) under the Page Bar

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: Recovery Key sub-page

Port the recovery-regenerate logic (the other half of `auth-methods-section.tsx`).

**Files:**
- Create: `apps/user-client/src/routes/app/account/recovery.tsx`
- Modify: `apps/user-client/src/App.tsx` (add the route)
- Test: `apps/user-client/tests/routes/account-recovery.test.tsx`

**Interfaces:**
- Consumes: `PageScaffold`, `Button`, `ConfirmTyped`, `RecoveryKeyReveal`, `regenerateRecoveryKey`, `useSessionStore((s) => s.mk)`, `useHelp('recovery')`.

- [ ] **Step 1: Write the failing test** — two cases: (a) `mk` present → "Regenerate recovery key" button enabled; tapping opens `ConfirmTyped` (token "regenerate"); confirming (mock `regenerateRecoveryKey` → `{ recoveryKeyString: 'AAAA-BBBB' }`) shows `RecoveryKeyReveal` with the key. (b) `mk` null → button disabled with the reason text. Set `mk` via `useSessionStore.setState`.

- [ ] **Step 2: Run it, expect failure.**

- [ ] **Step 3: Implement `recovery.tsx`** — `PageScaffold` (crumbs `My Account / Recovery Key`). Port the `regenState` machine verbatim: `Button tone="destructive"` "Regenerate recovery key", gated `disabled={mk === null}` with the disabled reason; `ConfirmTyped` token "regenerate" (kept per Chris, spec §4.2); on confirm call `regenerateRecoveryKey({ db, mk })`, then `RecoveryKeyReveal value={recoveryKeyString}` + "I have saved it" dismiss. Acquire `db` as the source module does.

- [ ] **Step 4: Add the route** — `<Route path="/app/account/recovery" element={<RecoveryKeyPage />} />`.

- [ ] **Step 5: Run test + gate + commit**

```bash
git add apps/user-client/src/routes/app/account/recovery.tsx apps/user-client/src/App.tsx apps/user-client/tests/routes/account-recovery.test.tsx
git commit -m "Add Recovery Key sub-page (mk-gated regenerate) under the Page Bar

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 5: Server linking sub-page

Port `server-linking-section.tsx`.

**Files:**
- Create: `apps/user-client/src/routes/app/account/server-linking.tsx`
- Modify: `apps/user-client/src/App.tsx`
- Test: `apps/user-client/tests/routes/account-server-linking.test.tsx`

**Interfaces:**
- Consumes: `PageScaffold`, `Badge`, `Button`, the existing link-status source + "Link to server" navigation (read the source module), `useHelp('server-linking')`.

- [ ] **Step 1: Write the failing test** — render, assert crumbs `My Account / Server linking`, the status badge ("Local-only mode" in Block 1), and a "Link to server" control navigating to `/onboarding/invitation?return=/app/account/server-linking`.

- [ ] **Step 2: Run it, expect failure.**

- [ ] **Step 3: Implement `server-linking.tsx`** — `PageScaffold` (crumbs `My Account / Server linking`); port the status display + link (and disconnect, if the source has it) verbatim, with the `return=` query pointed at this route. Status as a read-only `Badge`.

- [ ] **Step 4: Add the route** — `<Route path="/app/account/server-linking" element={<ServerLinkingPage />} />`.

- [ ] **Step 5: Run test + gate + commit**

```bash
git add apps/user-client/src/routes/app/account/server-linking.tsx apps/user-client/src/App.tsx apps/user-client/tests/routes/account-server-linking.test.tsx
git commit -m "Add Server linking sub-page under the Page Bar

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 6: About sub-page (dashboard + matrix + overlays + Dev Tools)

Dashboard (version + copyright) and a 2×3 matrix whose tiles open the Reading Overlay (License/Privacy/Third-party), open an external link (Source Code), or navigate to the dev-only Dev Tools sub-route.

**Files:**
- Create: `apps/user-client/src/routes/app/account/about.tsx`
- Create: `apps/user-client/src/routes/app/account/devtools.tsx` (ported from `dev-tools-section.tsx`)
- Modify: `apps/user-client/src/App.tsx` (two routes)
- Test: `apps/user-client/tests/routes/account-about.test.tsx`

**Interfaces:**
- Consumes: `PageScaffold`, `NavTile` (incl. `onActivate`), `ReadingOverlay`, version object, `copy.settings.about.licence` (copyright, `sourceHref`, `licenceHref`), `AGPL_MD`, `PRIVACY_MD`, `renderThirdPartyMarkdown`, `useHelp('about')`.

- [ ] **Step 1: Write the failing test**

```tsx
// assert: crumbs "My Account / About"; version + copyright shown;
// tapping "License" opens a dialog whose title is the licence and body contains AGPL text;
// tapping "Privacy" opens the privacy reader; tapping "Third-party libraries" opens a reader
//   listing a known library name; "Source Code" tile is present (onActivate, external);
// Dev Tools tile only when import.meta.env.DEV.
```
Mock nothing heavy beyond the version import; `ReadingOverlay`'s `MarkdownContent` may be stubbed as in Plan 1 Task 2's test.

- [ ] **Step 2: Run it, expect failure.**

- [ ] **Step 3: Implement `about.tsx`**

```tsx
export function AboutPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('about');
  const [reader, setReader] = useState<{ title: string; markdown: string } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const open = (el: HTMLElement, title: string, markdown: string) => {
    triggerRef.current = el;
    setReader({ title, markdown });
  };
  return (
    <PageScaffold back="/app/account" crumbs={[{ label: 'My Account', to: '/app/account' }, { label: 'About' }]} onHelp={onHelp}>
      {helpOverlay}
      {/* dashboard: v{version} · sha {sha} · built {builtAt}; copyright line from copy.settings.about.licence */}
      <div className="grid grid-cols-2 gap-3">
        <NavTile colour="pink" label="License" icon={Scale}
          onActivate={(el) => open(el, 'GNU Affero General Public License v3.0', AGPL_MD)} meta="AGPLv3" />
        <NavTile colour="pink" label="Source Code" icon={Github}
          onActivate={() => window.open(copy.settings.about.licence.sourceHref, '_blank', 'noopener,noreferrer')} meta="on GitHub" />
        <NavTile colour="green" label="Privacy" icon={ShieldCheck}
          onActivate={(el) => open(el, 'Privacy & data handling', PRIVACY_MD)} meta="what we store" />
        <NavTile colour="green" label="Third-party libraries" icon={Library}
          onActivate={(el) => open(el, 'Third-party libraries', renderThirdPartyMarkdown())} meta="open source" />
        {import.meta.env.DEV ? (
          <NavTile colour="purple" label="Developer tools" icon={Wrench} to="/app/account/about/devtools" meta="debug" wide />
        ) : null}
      </div>
      <ReadingOverlay
        open={reader !== null}
        title={reader?.title ?? ''}
        markdown={reader?.markdown ?? ''}
        onClose={() => setReader(null)}
        triggerRef={triggerRef}
      />
    </PageScaffold>
  );
}
```
(The Dev Tools tile is `wide` so it sits alone on the third row in dev; in production the row is absent → a clean 2×2, spec §4.4.)

- [ ] **Step 4: Implement `devtools.tsx`** — port `dev-tools-section.tsx` verbatim (the IndexedDB → `/dumps` POST + toast) into a `PageScaffold` (crumbs `My Account / About / Developer tools`, `back="/app/account/about"`). No help needed (or reuse `about`).

- [ ] **Step 5: Add the routes** — `<Route path="/app/account/about" element={<AboutPage />} />` and `<Route path="/app/account/about/devtools" element={<DevToolsPage />} />`.

- [ ] **Step 6: Run test + gate + commit**

```bash
git add apps/user-client/src/routes/app/account/about.tsx apps/user-client/src/routes/app/account/devtools.tsx apps/user-client/src/App.tsx apps/user-client/tests/routes/account-about.test.tsx
git commit -m "Add About sub-page (matrix + reading overlays + dev tools) under the Page Bar

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 7: Change passphrase reskin

Wrap the existing `change-passphrase.tsx` flow in the Page Bar; no change to the passphrase logic.

**Files:**
- Modify: `apps/user-client/src/routes/change-passphrase.tsx` (swap chrome only)
- Test: `apps/user-client/tests/routes/change-passphrase-chrome.test.tsx`

**Interfaces:**
- Consumes: `PageScaffold`, `useHelp('change-passphrase')`.

- [ ] **Step 1: Read `change-passphrase.tsx`.** Identify its current top-bar/back chrome (likely `EditorTopbar`/`EditorSticky` or a bespoke header).

- [ ] **Step 2: Write the failing test** — render it (mock session/`mk` as its existing tests do, if any), assert the PageBar crumbs `My Account / Change passphrase`, a back control to `/app/account`, and a `?` help affordance — and that the existing form fields still render.

- [ ] **Step 3: Swap the chrome** — replace the current header/back with `PageScaffold back="/app/account" crumbs={[{ label: 'My Account', to: '/app/account' }, { label: 'Change passphrase' }]} onHelp={onHelp}`; render `helpOverlay`. Leave the three-branch passphrase-change logic untouched. Remove any Save & Back control if present (the change-passphrase form has its own submit — keep that submit; only remove generic editor Save chrome if it exists).

- [ ] **Step 4: Run test + gate + commit**

```bash
git add apps/user-client/src/routes/change-passphrase.tsx apps/user-client/tests/routes/change-passphrase-chrome.test.tsx
git commit -m "Reskin Change passphrase under the Page Bar

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 8: Logout sub-page (Sign out + Delete) + `ConfirmTyped` gold-protect

The "leaving" surface: Sign out (neutral) and Delete-all-local-data (destructive, type-username confirm with a gold-protected "No"). Adds an optional `protectCancel` to `ConfirmTyped` so the safe choice wears gold ("gold protects, never invites").

**Files:**
- Create: `apps/user-client/src/routes/app/account/logout.tsx`
- Modify: `apps/user-client/src/App.tsx` (add the route)
- Modify: `packages/ui-shared/src/components/ConfirmTyped.tsx` (add `protectCancel?: boolean`, backward-compatible)
- Test: `apps/user-client/tests/routes/account-logout.test.tsx`
- Test: `packages/ui-shared/tests/confirm-typed.test.tsx` (extend if present; else add a focused case)

**Interfaces:**
- Consumes: `PageScaffold`, `Button`, `ConfirmTyped` (+ new `protectCancel`), `deleteLocalAccount`, `useSessionStore` (`closeAndForget`), the current username (for the confirm token), `useHelp('logout')`.
- Produces: `ConfirmTyped` gains `protectCancel?: boolean` — when true, the cancel CTA carries the gold priority styling and the destructive CTA stays red (spec §4.6). Default false → existing callers unchanged.

- [ ] **Step 1: Add `protectCancel` to `ConfirmTyped`** — read `packages/ui-shared/src/components/ConfirmTyped.tsx`; add the optional prop (default false). When true, apply the gold treatment to the cancel button (match the gold class/treatment the app's `ConfirmDialog`/Button `priority` uses — likely a `data-priority` / `.cs-btn[data-priority]` hook; if ui-shared has no access to that class, add a minimal gold style local to ConfirmTyped). Keep all existing behaviour identical when the prop is absent.

- [ ] **Step 2: Test the enhancement** — assert that with `protectCancel` the cancel button carries the gold marker (class/attribute) and the destructive button does not; without it, neither changes. Run the ui-shared test: `pnpm --filter @chatsundere/ui-shared test` (or the repo's ui-shared test command).

- [ ] **Step 3: Write the failing Logout page test** — render `LogoutPage`; assert crumbs `My Account / Logout`; a "Sign out" button calling `closeAndForget` then navigating to `/login` (mock `useSessionStore` + `useNavigate`); a "Delete all my local data" destructive button opening `ConfirmTyped` whose `confirmToken` is the username and whose cancel is gold-protected; confirming (mock `deleteLocalAccount`) navigates to `/onboarding`.

- [ ] **Step 4: Run it, expect failure.**

- [ ] **Step 5: Implement `logout.tsx`**

```tsx
export function LogoutPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('logout');
  const navigate = useNavigate();
  const username = /* current username, read as account-section.tsx does */;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const signOut = () => {
    useSessionStore.getState().closeAndForget();
    navigate('/login');
  };
  const reallyDelete = async () => {
    setBusy(true);
    try {
      await deleteLocalAccount(/* db, as the source module acquires it */);
      useSessionStore.getState().closeAndForget();
      navigate('/onboarding');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageScaffold back="/app/account" crumbs={[{ label: 'My Account', to: '/app/account' }, { label: 'Logout' }]} onHelp={onHelp}>
      {helpOverlay}
      <Button tone="neutral" onClick={signOut}>Sign out</Button>
      <p className="text-xs text-paper-soft">Your encrypted data stays on this device.</p>

      <div className="mt-6 rounded-xl border border-destructive/40 p-4">
        {/* danger zone */}
        <Button tone="destructive" onClick={() => setConfirmOpen(true)}>Delete all my local data</Button>
      </div>

      <ConfirmTyped
        open={confirmOpen}
        title="Delete everything on this device?"
        body="This permanently deletes all your local data. There is no recovery. Type your username to confirm."
        confirmToken={username}
        confirmTokenLabel="Type your username"
        destructiveCta="Yes, delete"
        cancelCta="No"
        protectCancel
        busy={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void reallyDelete()}
      />
    </PageScaffold>
  );
}
```
Port the exact `db` acquisition + the delete success/error handling from `account-section.tsx`.

- [ ] **Step 6: Add the route** — `<Route path="/app/account/logout" element={<LogoutPage />} />`.

- [ ] **Step 7: Delete the obsolete modules** — remove `src/routes/app/account-sections/account-section.tsx`, `auth-methods-section.tsx`, `server-linking-section.tsx`, `about-section.tsx`, `dev-tools-section.tsx` (their logic now lives in the routes). Confirm nothing else imports them (`rg "account-sections"`); remove the directory if empty. Do NOT remove `EditorSticky`/`EditorTopbar`/`AccordionCard`/`SaveBar` — other surfaces still use them.

- [ ] **Step 8: Full-suite gate + commit**

Run the whole suite to confirm the 8-baseline: `pnpm test` → all green except the 8 known Node-localStorage failures. `pnpm typecheck --force` → 14/14. `pnpm biome check` clean on all changed files.

```bash
git add apps/user-client/src/routes/app/account/logout.tsx apps/user-client/src/App.tsx packages/ui-shared/src/components/ConfirmTyped.tsx apps/user-client/tests/routes/account-logout.test.tsx packages/ui-shared/tests/confirm-typed.test.tsx
git rm apps/user-client/src/routes/app/account-sections/*.tsx
git commit -m "Add Logout sub-page (sign out + delete) with gold-protected confirm; remove old account-sections

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §2.3 always-save (blur/Enter, Saved ✓, validation guard, de-dupe) → Task 2 `InlineEditRow` (tests cover all three).
- §3.1 dashboard (username/displayName effective-value, biometrics/server/version badges) → Task 2.
- §3.2 matrix (six nav-palette tiles, correct routes, Logout meta) → Task 2.
- §4.1 Biometric (add/list/rename/remove/lockout/PRF/availability) → Task 3.
- §4.2 Recovery (mk-gated regen, typed token kept, reveal) → Task 4.
- §4.3 Server linking (status + link/disconnect) → Task 5.
- §4.4 About (dashboard + matrix + overlays + external Source + dev-only Dev Tools, 2×2 in prod) → Task 6.
- §4.5 Change passphrase reskin → Task 7.
- §4.6 Logout (Sign out + Delete, type-username, gold-protected No) → Task 8.
- §5 Reading Overlay consumed → Tasks 1/6 (+ every page's `?`).
- §6 per-page help, My Account explains sub-pages → Task 1 (+ `useHelp` on every page).
- §7 content (help, AGPL, privacy close to existing, third-party generated) → Task 1.
- §8 colour discipline (nav palette tiles; red only destructive) → Tasks 2/4/6/8.
- §10 routes → each task's App.tsx edit.
- §13 carry-over (everything homed; created-date + Documentation dropped) → Tasks 2-8; drops noted in Global Constraints.
- §12 a11y (≥44px controls from Plan 1; aria-current; disabled-with-reason; polite live regions) → Tasks 2-8.

**Placeholder scan:** The "read the source module and port verbatim" instructions are deliberate (the existing audited logic is the source of truth; rewriting it risks regressions) and are paired with exact API signatures + the named file to port from — not placeholders. The AGPL text is sourced from the repo's own licence file (a fixed artefact). The two Tailwind-utility caveats name the exact CSS-variable fallback.

**Type consistency:** `InlineEditRowProps`, `HelpKey`/`HELP_DOCS`/`useHelp`, `renderThirdPartyMarkdown`, `PRIVACY_MD`/`AGPL_MD` consistent across Tasks 1-2/6. `PageScaffold`/`ReadingOverlay`/`NavTile.onActivate` consumed exactly as Plan 1 produces them. `ConfirmTyped` `protectCancel` added in Task 8 and used in the same task.

**Cross-plan dependency:** every task here requires Plan 1 landed (PageScaffold, ReadingOverlay, NavTile.onActivate). Execute Plan 1 fully first.
