# About — Disclaimer, Third-Party Licences, AGPL Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing About-accordion body (compact Version/Licence/Docs `dl`) with: an unchanged version mono-box, two native `<details>` disclosures (Privacy & data handling, Third-party libraries), and a flat licence-and-links footer with four external links (FSF AGPL text, GitHub source, Provider Integration Policy, Documentation).

**Architecture:** All new code lives in one rewritten file (`about-section.tsx`) plus one new pure-data module (`third-party-licences.ts`) and a copy-catalogue update. The disclosures use native `<details>`/`<summary>` (no JS state, no scrollIntoView, keyboard- and screen-reader-accessible by default) — `AccordionCard` is intentionally not reused because nesting two rounded-border cards inside the About-accordion produces a visually busy border-in-border result. The AGPL full text is **not** bundled into the SPA; instead the footer links to the canonical FSF-hosted text (ADR 0030).

**Tech Stack:** TypeScript 5 strict, React 18, Vite, Vitest + Testing Library, Tailwind v4.

**Spec:** [`superpowers/specs/2026-05-28-about-disclaimer-licences-design.md`](../specs/2026-05-28-about-disclaimer-licences-design.md).

---

## Task layout

9 tasks, each a TDD-paired step + intermediate task-commit (per the project's task-commit-then-squash cadence). Final squash at Task 9 lands one feature commit on master.

- Task 1 — `lib/third-party-licences.ts` (pure data; no test, no logic)
- Task 2 — `copy.ts` update (new privacy/third-party/licence strings; old `about.*` subkeys removed)
- Task 3 — TDD: privacy-disclosure rendering
- Task 4 — TDD: third-party-disclosure rendering
- Task 5 — TDD: licence-and-links footer rendering
- Task 6 — Full verification (typecheck + lint + build + all tests)
- Task 7 — ADR 0030 (link to FSF licence text)
- Task 8 — STATUS-CLIENT-ONLY update
- Task 9 — Final squash to one feature commit (Liz only, never a subagent)

**Important reading-out-of-order note:** the rewrite of `about-section.tsx` happens incrementally across Tasks 3 → 4 → 5. Each step adds one new block (Privacy, Third-party, Licence-footer) and reuses the unchanged mono-box from Phase-4 alpha-prep. The old `dl` of `Version / Licence / Documentation` is removed in Task 3 (when we no longer need its `copy.settings.about.versionLabel/licenceLabel/docsLabel` exports — Task 2 removed them).

**Larissa:** skipped — frontend-only, no auth, no crypto, no sync, no proxy. Confirmed per CLAUDE.md §9.

---

### Task 1: `lib/third-party-licences.ts` — curated dependency list

**Files:**
- Create: `apps/user-client/src/lib/third-party-licences.ts`

No test file. Pure data; no logic to test. Indirect coverage comes from the third-party-disclosure render test in Task 4.

- [ ] **Step 1: Create the module**

```ts
// apps/user-client/src/lib/third-party-licences.ts
// SPDX-License-Identifier: AGPL-3.0-only

export interface ThirdPartyEntry {
  /** Human-readable name. */
  name: string;
  /** Major.minor version we depend on (no SHA / no transitive depth). */
  version: string;
  /** SPDX short licence identifier. */
  licence: string;
  /** Canonical homepage or repository URL. */
  homepage: string;
}

/**
 * Curated list of the user-client's direct runtime dependencies plus
 * bundled assets (fonts). Workspace-internal packages
 * (@chatsundere/crypto, @chatsundere/llm-unified, @chatsundere/shared-types,
 * @chatsundere/ui-shared) are not third-party and are deliberately omitted.
 *
 * Maintenance: update versions on every `pnpm update` that bumps a
 * major / minor of a listed dependency. The list is intentionally
 * curated rather than auto-generated.
 */
export const THIRD_PARTY_LICENCES: readonly ThirdPartyEntry[] = [
  { name: 'React',            version: '18.3',     licence: 'MIT',        homepage: 'https://react.dev' },
  { name: 'react-router-dom', version: '6.28',     licence: 'MIT',        homepage: 'https://reactrouter.com' },
  { name: 'TanStack Query',   version: '5.59',     licence: 'MIT',        homepage: 'https://tanstack.com/query' },
  { name: 'Zustand',          version: '5.0',      licence: 'MIT',        homepage: 'https://zustand.docs.pmnd.rs' },
  { name: 'Dexie',            version: '4.x',      licence: 'Apache-2.0', homepage: 'https://dexie.org' },
  { name: 'Valibot',          version: '0.42',     licence: 'MIT',        homepage: 'https://valibot.dev' },
  { name: 'Tailwind CSS',     version: '4.x',      licence: 'MIT',        homepage: 'https://tailwindcss.com' },
  { name: 'qr-scanner',       version: '1.4',      licence: 'MIT',        homepage: 'https://github.com/nimiq/qr-scanner' },
  { name: 'workbox-window',   version: '7.3',      licence: 'MIT',        homepage: 'https://developer.chrome.com/docs/workbox' },
  { name: 'uuidv7',           version: '1.0',      licence: 'Apache-2.0', homepage: 'https://github.com/LiosK/uuidv7-js' },
  { name: 'Inter',            version: 'variable', licence: 'OFL-1.1',    homepage: 'https://rsms.me/inter' },
  { name: 'Lora',             version: 'static',   licence: 'OFL-1.1',    homepage: 'https://fonts.google.com/specimen/Lora' },
];
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter user-client run typecheck`
Expected: PASS (no new errors; the unused-but-exported module is fine — Task 4 imports it).

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/lib/third-party-licences.ts
git commit -m "Add THIRD_PARTY_LICENCES data module"
```

---

### Task 2: `copy.ts` — new About strings, remove old `about.*` subkeys

**Files:**
- Modify: `apps/user-client/src/lib/copy.ts:141-148` (the `settings.about` block)

The current shape is:

```ts
about: {
  title: 'About',
  versionLabel: 'Version',
  licenceLabel: 'Licence',
  licenceValue: 'GNU AGPL v3.0',
  docsLabel: 'Documentation',
  docsValue: 'chatsune.me',
},
```

Replace this entire object literal with the new shape. The `tabs.about: 'About'` key at line 64 stays untouched (it labels the accordion header in `account.tsx`).

- [ ] **Step 1: Replace the `about` block**

Edit `apps/user-client/src/lib/copy.ts` — replace the entire `about: { … }` object literal at lines 141-148 with:

```ts
    about: {
      title: 'About',
      privacy: {
        label: 'Privacy & data handling',
        whereTitle: 'Where your data lives.',
        whereBody:
          "Chatsundere stores everything on this device. Your chats, personas, drafts, and provider credentials live in the browser's local storage (IndexedDB). Nothing is uploaded.",
        cannotSeeTitle: 'What we cannot see.',
        cannotSeeBody:
          'This alpha runs entirely in your browser. There is no Chatsundere server in the picture — we receive no telemetry, no analytics, and no account data. Clearing your browser storage wipes everything irrecoverably.',
        externalTitle: 'When you talk to external providers.',
        externalBody:
          'Models live with their providers (nano-gpt, Novita AI, Ollama Cloud, or any custom endpoint you configure). Your prompts, attachments, and replies travel directly from your browser to that provider — their privacy policy and terms of service apply to that traffic. Chatsundere never sees it; we also cannot enforce anything against it.',
      },
      thirdParty: {
        label: 'Third-party libraries',
        intro:
          'Chatsundere bundles the following open-source projects. Their licences govern their respective code; full licence texts are available at the homepage of each project.',
        versionPrefix: 'v',
      },
      licence: {
        copyright: 'Copyright © 2026 Chatsundere contributors.',
        noWarranty: 'No warranty — see the licence for details.',
        licenceLabel: 'Licence',
        licenceValue: 'GNU AGPL v3.0',
        licenceHref: 'https://www.gnu.org/licenses/agpl-3.0.html',
        sourceLabel: 'Source code',
        sourceValue: 'github.com/symphonic-navigator/chatsundere',
        sourceHref: 'https://github.com/symphonic-navigator/chatsundere',
        policyLabel: 'Our Provider Integration Policy',
        policyValue: 'teaser.chatsundere.me/policy',
        policyHref: 'https://teaser.chatsundere.me/policy',
        docsLabel: 'Documentation',
        docsValue: 'chatsune.me',
        docsHref: 'https://chatsune.me',
      },
    },
```

- [ ] **Step 2: Verify the typecheck fails on `about-section.tsx`**

Run: `pnpm --filter user-client run typecheck`
Expected: FAIL with errors in `about-section.tsx` referencing `copy.settings.about.versionLabel`, `licenceLabel`, `licenceValue`, `docsLabel`, `docsValue` — these are gone. The exact message will be something like:

```
src/routes/app/account-sections/about-section.tsx:30:39 - error TS2339:
Property 'versionLabel' does not exist on type '{ title: string; privacy: { … }; thirdParty: { … }; licence: { … }; }'.
```

This failure is **expected** and gets resolved in Task 3 when we rewrite `about-section.tsx`. Do not "fix" typecheck by adding back the old keys.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/lib/copy.ts
git commit -m "Replace About copy block with privacy/thirdParty/licence subtrees"
```

Typecheck is intentionally red at this commit. Subagent-driven-development tolerates a broken intermediate commit as long as the next task closes the gap.

---

### Task 3: TDD — privacy disclosure in `about-section.tsx`

**Files:**
- Modify: `apps/user-client/src/routes/app/account-sections/about-section.tsx` (full rewrite, but only privacy + mono-box wired this task; third-party and licence-footer come in Tasks 4-5)
- Modify: `apps/user-client/tests/unit/account.about.test.tsx` (extend with new case)

- [ ] **Step 1: Write the failing test**

Append the following describe-block to `apps/user-client/tests/unit/account.about.test.tsx` (do not delete the existing version-block describe):

```tsx
// Add these imports at the top of the file (next to the existing ones):
import { fireEvent } from '@testing-library/react';
import { copy } from '../../src/lib/copy.js';

// Append at the bottom of the file:
describe('AboutSection privacy disclosure', () => {
  it('renders a closed <details> with all three privacy paragraphs inside', () => {
    const { container } = render(<AboutSection />);
    const details = container.querySelector('details[data-about-privacy]');
    expect(details).not.toBeNull();
    // Closed by default — `open` attribute absent.
    expect(details?.hasAttribute('open')).toBe(false);
    // Summary label
    expect(details?.querySelector('summary')?.textContent ?? '').toContain(
      copy.settings.about.privacy.label,
    );
    // Body content (rendered inside the disclosure regardless of open state in jsdom).
    expect(details?.textContent ?? '').toContain(copy.settings.about.privacy.whereTitle);
    expect(details?.textContent ?? '').toContain(copy.settings.about.privacy.cannotSeeTitle);
    expect(details?.textContent ?? '').toContain(copy.settings.about.privacy.externalTitle);
  });

  it('opens when the summary is clicked', () => {
    const { container } = render(<AboutSection />);
    const details = container.querySelector('details[data-about-privacy]') as HTMLDetailsElement;
    const summary = details.querySelector('summary') as HTMLElement;
    fireEvent.click(summary);
    expect(details.open).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test — should fail**

Run: `pnpm --filter user-client test -- account.about`
Expected: FAIL. Either jsdom throws "Cannot read properties of null" on `container.querySelector('details[data-about-privacy]')`, or the typecheck-as-test gate (`pnpm --filter user-client run typecheck` is wired into vite-build but not test directly) is already red from Task 2. The latter is fine — the failing test in Task 4 will not change typecheck state, only the implementation in Step 3 will.

- [ ] **Step 3: Rewrite `about-section.tsx` — mono-box + privacy disclosure only**

Replace the entire contents of `apps/user-client/src/routes/app/account-sections/about-section.tsx` with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { copy } from '../../../lib/copy.js';
import { APP_VERSION } from '../../../lib/version.js';

/**
 * About accordion body.
 *
 * Mono-box (Version + sha + built-at) is the existing alpha-prep display.
 * Below it, two native <details> disclosures (Privacy, Third-party) and a
 * flat licence-and-links footer. See spec
 * `superpowers/specs/2026-05-28-about-disclaimer-licences-design.md`.
 */
export function AboutSection() {
  return (
    <div className="space-y-4">
      <VersionMonoBox />
      <PrivacyDisclosure />
    </div>
  );
}

function VersionMonoBox() {
  return (
    <div className="rounded-md border border-paper-soft/20 bg-black/20 p-3 font-mono text-xs text-paper-soft">
      <div>
        Version <span className="text-paper">{APP_VERSION.version}</span>
      </div>
      <div>
        sha <span className="text-paper">{APP_VERSION.sha}</span>
      </div>
      <div>
        built <span className="text-paper">{APP_VERSION.builtAt}</span>
      </div>
    </div>
  );
}

function PrivacyDisclosure() {
  const p = copy.settings.about.privacy;
  return (
    <details
      data-about-privacy
      className="group border-t border-white/5 pt-3 [&>summary]:list-none"
    >
      <summary className="flex cursor-pointer items-center justify-between font-display text-sm text-paper">
        <span>{p.label}</span>
        <span aria-hidden className="text-paper-soft transition-transform group-open:rotate-90">
          ▸
        </span>
      </summary>
      <div className="space-y-3 pt-3 text-sm text-paper-soft">
        <p>
          <strong className="text-paper">{p.whereTitle}</strong> {p.whereBody}
        </p>
        <p>
          <strong className="text-paper">{p.cannotSeeTitle}</strong> {p.cannotSeeBody}
        </p>
        <p>
          <strong className="text-paper">{p.externalTitle}</strong> {p.externalBody}
        </p>
      </div>
    </details>
  );
}
```

Note: the `[&>summary]:list-none` Tailwind arbitrary-variant hides the default disclosure-triangle on Chrome / Safari, so the custom `▸` glyph is the only chevron. On Firefox the default triangle is rendered by a `::-webkit-details-marker`-equivalent pseudo-element that `list-none` covers. No `<style>` block needed.

- [ ] **Step 4: Run the test — should pass**

Run: `pnpm --filter user-client test -- account.about`
Expected: PASS — three describe-blocks (existing version + new privacy × 2).

Also run typecheck — it should now be green again (the references to `versionLabel/licenceLabel/etc.` have been removed from `about-section.tsx`):

Run: `pnpm --filter user-client run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/account-sections/about-section.tsx \
        apps/user-client/tests/unit/account.about.test.tsx
git commit -m "About — render privacy disclosure with three paragraphs"
```

---

### Task 4: TDD — third-party disclosure

**Files:**
- Modify: `apps/user-client/src/routes/app/account-sections/about-section.tsx` (add `ThirdPartyDisclosure`)
- Modify: `apps/user-client/tests/unit/account.about.test.tsx` (extend)

- [ ] **Step 1: Write the failing test**

Append to `account.about.test.tsx`:

```tsx
// Add to existing imports at top:
import { THIRD_PARTY_LICENCES } from '../../src/lib/third-party-licences.js';

// Append:
describe('AboutSection third-party disclosure', () => {
  it('renders one row per THIRD_PARTY_LICENCES entry', () => {
    const { container } = render(<AboutSection />);
    const rows = container.querySelectorAll('[data-third-party-row]');
    expect(rows.length).toBe(THIRD_PARTY_LICENCES.length);
  });

  it('spot-checks that React and Tailwind appear with their licence', () => {
    const { container } = render(<AboutSection />);
    const text = container.textContent ?? '';
    expect(text).toContain('React');
    expect(text).toContain('Tailwind CSS');
    expect(text).toMatch(/MIT/);
  });

  it('renders the intro paragraph above the row list', () => {
    const { container } = render(<AboutSection />);
    const details = container.querySelector('details[data-about-third-party]');
    expect(details).not.toBeNull();
    expect(details?.textContent ?? '').toContain(copy.settings.about.thirdParty.intro);
  });

  it('renders homepage links with target=_blank and rel=noopener', () => {
    const { container } = render(<AboutSection />);
    const links = container.querySelectorAll<HTMLAnchorElement>(
      '[data-third-party-row] a',
    );
    expect(links.length).toBe(THIRD_PARTY_LICENCES.length);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });
});
```

- [ ] **Step 2: Run the test — should fail**

Run: `pnpm --filter user-client test -- account.about`
Expected: FAIL on the new "third-party disclosure" describe (querySelector returns null / row count = 0).

- [ ] **Step 3: Add `ThirdPartyDisclosure` to `about-section.tsx`**

Open `apps/user-client/src/routes/app/account-sections/about-section.tsx`. Add the import at the top (after the existing imports):

```ts
import { THIRD_PARTY_LICENCES } from '../../../lib/third-party-licences.js';
```

Update the `AboutSection` JSX to include the new disclosure:

```tsx
export function AboutSection() {
  return (
    <div className="space-y-4">
      <VersionMonoBox />
      <PrivacyDisclosure />
      <ThirdPartyDisclosure />
    </div>
  );
}
```

Add the new component below `PrivacyDisclosure`:

```tsx
function ThirdPartyDisclosure() {
  const tp = copy.settings.about.thirdParty;
  return (
    <details
      data-about-third-party
      className="group border-t border-white/5 pt-3 [&>summary]:list-none"
    >
      <summary className="flex cursor-pointer items-center justify-between font-display text-sm text-paper">
        <span>{tp.label}</span>
        <span aria-hidden className="text-paper-soft transition-transform group-open:rotate-90">
          ▸
        </span>
      </summary>
      <div className="space-y-3 pt-3 text-sm text-paper-soft">
        <p>{tp.intro}</p>
        <ul className="space-y-2">
          {THIRD_PARTY_LICENCES.map((entry) => (
            <li
              key={entry.name}
              data-third-party-row
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
            >
              <span className="font-display text-sm text-paper">{entry.name}</span>
              <span className="font-mono text-xs text-paper-soft">
                {tp.versionPrefix}
                {entry.version}
              </span>
              <span className="font-mono text-xs text-paper-soft">· {entry.licence} ·</span>
              <a
                href={entry.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-aurora-300 underline-offset-2 hover:underline"
              >
                {entry.homepage.replace(/^https?:\/\//, '')}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
```

- [ ] **Step 4: Run the test — should pass**

Run: `pnpm --filter user-client test -- account.about`
Expected: PASS — all describes green.

Run: `pnpm --filter user-client run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/account-sections/about-section.tsx \
        apps/user-client/tests/unit/account.about.test.tsx
git commit -m "About — render third-party libraries disclosure"
```

---

### Task 5: TDD — licence-and-links footer

**Files:**
- Modify: `apps/user-client/src/routes/app/account-sections/about-section.tsx` (add `LicenceFooter`)
- Modify: `apps/user-client/tests/unit/account.about.test.tsx` (extend)

- [ ] **Step 1: Write the failing test**

Append:

```tsx
describe('AboutSection licence footer', () => {
  it('renders the copyright line and no-warranty sentence as plain text', () => {
    const { container } = render(<AboutSection />);
    const footer = container.querySelector('[data-about-licence-footer]');
    expect(footer).not.toBeNull();
    expect(footer?.textContent ?? '').toContain(copy.settings.about.licence.copyright);
    expect(footer?.textContent ?? '').toContain(copy.settings.about.licence.noWarranty);
  });

  it('renders four external links in document order: Licence, Source, Policy, Documentation', () => {
    const { container } = render(<AboutSection />);
    const links = container.querySelectorAll<HTMLAnchorElement>(
      '[data-about-licence-footer] a',
    );
    expect(links.length).toBe(4);

    const c = copy.settings.about.licence;
    expect(links[0]?.getAttribute('href')).toBe(c.licenceHref);
    expect(links[1]?.getAttribute('href')).toBe(c.sourceHref);
    expect(links[2]?.getAttribute('href')).toBe(c.policyHref);
    expect(links[3]?.getAttribute('href')).toBe(c.docsHref);

    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('spot-checks the Policy link label reads "Our Provider Integration Policy" verbatim', () => {
    const { container } = render(<AboutSection />);
    const policyRow = container.querySelector('[data-about-policy-row]');
    expect(policyRow).not.toBeNull();
    expect(policyRow?.textContent ?? '').toContain('Our Provider Integration Policy');
  });

  it('points the licence link at the FSF-hosted AGPL text', () => {
    const { container } = render(<AboutSection />);
    const licenceLink = container.querySelector<HTMLAnchorElement>(
      '[data-about-licence-row] a',
    );
    expect(licenceLink?.getAttribute('href')).toBe('https://www.gnu.org/licenses/agpl-3.0.html');
    expect(licenceLink?.textContent ?? '').toContain('GNU AGPL v3.0');
  });
});
```

- [ ] **Step 2: Run the test — should fail**

Run: `pnpm --filter user-client test -- account.about`
Expected: FAIL on the new "licence footer" describe (footer element not found).

- [ ] **Step 3: Add `LicenceFooter` to `about-section.tsx`**

Update the `AboutSection` JSX:

```tsx
export function AboutSection() {
  return (
    <div className="space-y-4">
      <VersionMonoBox />
      <PrivacyDisclosure />
      <ThirdPartyDisclosure />
      <LicenceFooter />
    </div>
  );
}
```

Add the component below `ThirdPartyDisclosure`:

```tsx
function LicenceFooter() {
  const l = copy.settings.about.licence;
  return (
    <div
      data-about-licence-footer
      className="space-y-3 border-t border-white/5 pt-3 text-sm text-paper-soft"
    >
      <p>
        {l.copyright} {l.noWarranty}
      </p>
      <dl className="space-y-1.5">
        <FooterLink
          rowAttr="data-about-licence-row"
          label={l.licenceLabel}
          value={l.licenceValue}
          href={l.licenceHref}
        />
        <FooterLink
          rowAttr="data-about-source-row"
          label={l.sourceLabel}
          value={l.sourceValue}
          href={l.sourceHref}
        />
        <FooterLink
          rowAttr="data-about-policy-row"
          label={l.policyLabel}
          value={l.policyValue}
          href={l.policyHref}
        />
        <FooterLink
          rowAttr="data-about-docs-row"
          label={l.docsLabel}
          value={l.docsValue}
          href={l.docsHref}
        />
      </dl>
    </div>
  );
}

function FooterLink({
  rowAttr,
  label,
  value,
  href,
}: {
  rowAttr: string;
  label: string;
  value: string;
  href: string;
}) {
  return (
    <div {...{ [rowAttr]: '' }} className="flex flex-wrap items-baseline gap-x-2">
      <dt className="text-xs font-medium uppercase tracking-wider text-paper-soft">{label}</dt>
      <dd>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-sm text-aurora-300 underline-offset-2 hover:underline"
        >
          {value}
        </a>
      </dd>
    </div>
  );
}
```

The `{...{ [rowAttr]: '' }}` spread is the cleanest way to set a dynamic `data-*` attribute via React props without a `data-row={rowAttr}` indirection — keeps the test-selector readable (`[data-about-policy-row]` rather than `[data-row="policy"]`).

- [ ] **Step 4: Run the tests — should pass**

Run: `pnpm --filter user-client test -- account.about`
Expected: PASS — all four describes green (mono-box, privacy ×2, third-party ×4, licence footer ×4).

Run: `pnpm --filter user-client run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/account-sections/about-section.tsx \
        apps/user-client/tests/unit/account.about.test.tsx
git commit -m "About — render licence-and-links footer with four external links"
```

---

### Task 6: Full verification — typecheck + lint + build + all user-client tests

No files changed; this is the green-bar gate before the doc and squash tasks.

- [ ] **Step 1: Typecheck**

Run: `pnpm --filter user-client run typecheck`
Expected: PASS.

- [ ] **Step 2: Lint (Biome, project-wide)**

Run: `pnpm lint`
Expected: PASS (no errors). If Biome formatting fires on freshly-written code, run `pnpm format` and re-run `pnpm lint`. Do not fix unrelated pre-existing warnings — only the four files this plan touches.

- [ ] **Step 3: Full user-client test run**

Run: `pnpm --filter user-client test`
Expected: PASS for the about-section additions. The pre-existing 8 cockpit-draft localStorage-cascade failures (tracked in STATUS) remain — they are unrelated to this work and should be unchanged in count. Confirm the count is still 8 (not 9+, which would mean we broke something).

- [ ] **Step 4: Production build**

Run: `pnpm --filter user-client run build`
Expected: PASS. The build runs `tsc -p tsconfig.json --noEmit && vite build` per `package.json`; both must succeed. Confirm the new module is bundled by spot-checking the build output:

```bash
grep -o "Provider Integration Policy" apps/user-client/dist/assets/*.js | head -1
```
Expected: at least one match.

No commit — this task is verification only. The next task (ADR) commits.

---

### Task 7: ADR 0030 — Link to FSF licence text

**Files:**
- Create: `obsidian/decisions/0030-link-to-fsf-licence-text.md`

- [ ] **Step 1: Write the ADR**

Create the file with this exact content:

```markdown
# ADR 0030: Link to the FSF-hosted AGPL-3.0 text

## Status

Accepted (2026-05-28, alpha-prep follow-up).

## Context

The user-client's About surface in My Account needs to expose the
project licence in a discoverable way to users running the alpha. The
straightforward option is to bundle the full AGPL-3.0 text into the
SPA — Vite can import it as a raw string from `LICENSE-AGPLv3` at the
repo root.

The AGPL-3.0 text is ~32 kB. Bundling it means every user pays the
download cost on every release, even though almost no user actually
opens the licence body. The text is also fully public and stably
hosted by the Free Software Foundation at a URL that has been
unchanged for over a decade.

The AGPL-3.0 itself does not require the licence text to be rendered
inline in an interactive UI. The relevant compliance hooks are:

- **Section 0 + 5d — "Appropriate Legal Notices."** The UI must
  prominently display a copyright notice, a no-warranty disclaimer,
  and a hint that users may convey the work under the licence.
- **Section 4 — "Conveying Verbatim Copies."** Source distribution
  must include the licence text. Chatsundere ships
  `LICENSE-AGPLv3` at the repo root, which satisfies this for forks
  and source consumers.
- **Section 13 — Remote network interaction.** A user interacting
  with a deployed instance must be offered access to the
  corresponding source.

A link to the FSF-hosted text plus a "Source code" link in the About
footer covers all three hooks without bundling the licence into the
binary surface.

## Decision

Link to `https://www.gnu.org/licenses/agpl-3.0.html` from the About
licence footer in the user-client. Do not bundle the AGPL-3.0 text
into the SPA bundle.

The bundled `LICENSE-AGPLv3` at the repo root remains the canonical
artefact for Section-4 source-distribution compliance and for forks.

## Consequences

- ~32 kB less in the SPA bundle on every release.
- A user reading the licence depends on FSF availability at read
  time. Acceptable: the FSF URL has been stable since at least
  2007; offline users can still find `LICENSE-AGPLv3` in the source
  tree (and the source link in the About footer takes them to the
  repo where the file lives).
- If the FSF ever moves the URL, only the `licenceHref` constant in
  `apps/user-client/src/lib/copy.ts` changes. No code change.
- Same pattern works unchanged for any future LGPL / MIT links if
  we later expose the licences of `packages/crypto`,
  `packages/llm-unified`, or `packages/shared-types` in the About
  surface.
```

- [ ] **Step 2: Commit**

```bash
git add obsidian/decisions/0030-link-to-fsf-licence-text.md
git commit -m "ADR 0030 — link to FSF licence text instead of bundling [skip ci]"
```

`[skip ci]` is correct here: the ADR is a pure-text commit, no code change.

---

### Task 8: STATUS-CLIENT-ONLY.md update

**Files:**
- Modify: `obsidian/STATUS-CLIENT-ONLY.md` (top "Last updated" stanza + Done block)

The protocol per CLAUDE.md §16: update STATUS before the squash, not after. The squash commit (Task 9) will include this update.

- [ ] **Step 1: Read the current STATUS top section**

Run: `head -30 obsidian/STATUS-CLIENT-ONLY.md`

This gives you the current "Last updated" stanza. Don't read the whole file — it's ~29 kB.

- [ ] **Step 2: Replace the top stanza**

Edit `obsidian/STATUS-CLIENT-ONLY.md` — replace the existing `**Last updated:** …` paragraph (lines 3-26 in the current file; expect drift since the file changes often) with one that summarises the new state. The shape:

```markdown
**Last updated:** 2026-05-28 (About-disclaimer-and-licences squashed
following Chris's review of the Phase-4 alpha-prep build). Replaces the
old Version/Licence/Documentation `dl` in My Account → About with: a
Privacy & data handling disclosure (three paragraphs — where data lives,
what the app cannot see, external providers), a Third-party libraries
disclosure (12 curated entries — React, Tailwind, Dexie, Valibot, … —
each with version, SPDX licence, and homepage link), and a flat
licence-and-links footer with four external links (FSF AGPL-3.0 text,
GitHub source, Our Provider Integration Policy at
teaser.chatsundere.me/policy, chatsune.me docs). Native `<details>`
disclosures, no new component; the AGPL text is **not** bundled —
[ADR 0030](decisions/0030-link-to-fsf-licence-text.md) explains why.
~12 new Vitest cases on `account.about.test.tsx` (privacy ×2 +
third-party ×4 + licence footer ×4 + existing mono-box). Pre-Phase-4
alpha-prep baseline at `b6ba252` plus ALPHA-DEPLOY walkthrough at
`381184c` remain the foundation under this work.
```

Adjust line wrapping to ~72 columns to match the rest of the file.

- [ ] **Step 3: Add an entry to the "Done" block**

Find the most recent "Done" entry (the Phase-4 alpha-prep block — `b6ba252`). Insert a new entry **above** it (most-recent first):

```markdown
- **About — disclaimer + licences (2026-05-28, squashed at <hash>)**.
  Single squashed commit on master replacing My Account → About's
  compact `dl` with three richer blocks: a Privacy & data handling
  disclosure (three paragraphs), a Third-party libraries disclosure
  (12 curated entries from a new `lib/third-party-licences.ts`
  module), and a flat licence-and-links footer linking to the
  FSF-hosted AGPL-3.0 text, the GitHub source, the Provider
  Integration Policy on `teaser.chatsundere.me/policy`, and the
  chatsune.me docs. Native `<details>` disclosures (no JS state, no
  `AccordionCard` nesting). ADR 0030 documents the FSF-link
  decision. `copy.settings.about.{versionLabel,licenceLabel,
  licenceValue,docsLabel,docsValue}` retired in favour of three
  subtrees (`privacy.*`, `thirdParty.*`, `licence.*`). 12 new Vitest
  cases on `account.about.test.tsx`. No dep changes, no Dexie bump,
  no Larissa (frontend-only). Spec:
  [`superpowers/specs/2026-05-28-about-disclaimer-licences-design.md`](../superpowers/specs/2026-05-28-about-disclaimer-licences-design.md).
  Plan:
  [`superpowers/plans/2026-05-28-about-disclaimer-licences.md`](../superpowers/plans/2026-05-28-about-disclaimer-licences.md).
```

`<hash>` is filled in after Task 9's squash — leave the literal `<hash>` placeholder for now. Liz patches it in during the squash step.

- [ ] **Step 4: Commit**

```bash
git add obsidian/STATUS-CLIENT-ONLY.md
git commit -m "STATUS — log About-disclaimer + licences pre-squash [skip ci]"
```

---

### Task 9: Final squash — Liz only (no subagent)

**Files:** none changed. Pure git operation.

Per CLAUDE.md §8 and §13: "Subagents never merge, push, or switch branches." This task is mine alone. A subagent dispatched to this task should refuse and return control.

- [ ] **Step 1: Confirm the task-commit chain**

```bash
git log --oneline master ^master~12 | head -20
```

Expected output: the task-commits from Tasks 1, 2, 3, 4, 5, 7, 8 in reverse chronological order, plus the two spec commits (`6e9c14e` + `38fddac`) at the bottom of the new range. Count the post-spec commits — should be exactly 7 (no Task 6 — that one was verification-only).

- [ ] **Step 2: Soft-reset to before the first task-commit**

Identify the commit immediately before "Add THIRD_PARTY_LICENCES data module" (the Task-1 commit):

```bash
git log --oneline -20
```

The commit before it is the spec-update commit `38fddac` (or whatever HEAD was when the implementation started). Soft-reset to it:

```bash
git reset --soft 38fddac
```

All seven task-commits' changes are now staged together as one big diff.

- [ ] **Step 3: Sanity-check the staged diff**

```bash
git status
git diff --cached --stat
```

Expected files changed (exactly six — no surprises):

- `apps/user-client/src/lib/copy.ts`
- `apps/user-client/src/lib/third-party-licences.ts`
- `apps/user-client/src/routes/app/account-sections/about-section.tsx`
- `apps/user-client/tests/unit/account.about.test.tsx`
- `obsidian/decisions/0030-link-to-fsf-licence-text.md`
- `obsidian/STATUS-CLIENT-ONLY.md`

If anything else is staged, investigate before proceeding.

- [ ] **Step 4: Create the squash commit**

```bash
git commit -m "$(cat <<'EOF'
About — privacy disclaimer, third-party licences, AGPL link

Replace the existing My Account → About dl (Version / Licence / Docs)
with: an unchanged version mono-box; a Privacy & data handling
disclosure (three paragraphs — where data lives, what the app cannot
see, external providers); a Third-party libraries disclosure (12
curated entries from a new lib/third-party-licences.ts module); and
a flat licence-and-links footer with four external links — the
FSF-hosted AGPL-3.0 text, the GitHub source, our Provider Integration
Policy on teaser.chatsundere.me/policy, and chatsune.me docs.

Native <details>/<summary> disclosures — no JS state, no AccordionCard
nesting. The AGPL full text is not bundled into the SPA; ADR 0030
explains why and how Section-4/Section-13 compliance is still met.

copy.settings.about.{versionLabel,licenceLabel,licenceValue,
docsLabel,docsValue} retired in favour of three subtrees
(privacy.*, thirdParty.*, licence.*). 12 new Vitest cases on
account.about.test.tsx; pre-existing 8 cockpit-draft localStorage
failures unchanged. No dep changes, no Dexie bump, no Larissa.

Spec:  superpowers/specs/2026-05-28-about-disclaimer-licences-design.md
Plan:  superpowers/plans/2026-05-28-about-disclaimer-licences.md
ADR:   obsidian/decisions/0030-link-to-fsf-licence-text.md

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Patch the `<hash>` placeholder in STATUS-CLIENT-ONLY.md**

The Task-8 STATUS entry contains the literal `<hash>` placeholder. After the squash, replace it with the actual commit hash:

```bash
SQUASH_HASH=$(git rev-parse --short HEAD)
```

Open `obsidian/STATUS-CLIENT-ONLY.md`, find `(2026-05-28, squashed at <hash>)`, replace `<hash>` with the value from `$SQUASH_HASH`. Then amend the squash commit:

```bash
git add obsidian/STATUS-CLIENT-ONLY.md
git commit --amend --no-edit
```

This is the **one** amend in the project that is explicitly allowed (per the existing Phase-4-alpha-prep cadence — STATUS-hash patching is a known follow-up step on squash commits).

- [ ] **Step 6: Final smoke — typecheck + lint + build + tests one more time on the squashed tree**

```bash
pnpm --filter user-client run typecheck
pnpm --filter user-client test
pnpm --filter user-client run build
```

Expected: PASS, PASS (with the same pre-existing 8 failures), PASS.

- [ ] **Step 7: Report to Chris**

Report the squash hash, a one-line summary, and ask for the device-smoke walkthrough from §9 of the spec.

---

## Out-of-band: device-smoke (Chris, not the agent)

Once the squash lands, Chris runs through spec §9 on the actual phone. The smoke is not an automated step in this plan; it cannot be — it is the explicit manual verification surface for a user-facing feature (per CLAUDE.md §10).
