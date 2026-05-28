# About — Disclaimer, Third-Party Licences, AGPL link — design spec

**Date:** 2026-05-28.
**Status:** brainstormed; ready for implementation plan.
**Implements:** alpha-prep follow-up — the About surface in My Account needs
three additional information sections before the first public-facing alpha
build can ship:

1. A privacy / data-handling disclaimer (the app is client-only at Alpha; the
   user should still understand what stays on-device, what we cannot see, and
   that external model providers have their own terms).
2. A third-party-licences listing (open-source attribution for the libraries
   the user-client bundles).
3. A canonical licence reference (Chatsundere is AGPL-3.0-only; the
   user-facing About surface should expose the licence, link to the full text
   on gnu.org, and link to the source repository per AGPL §13).

**Lead:** Liz. **Larissa:** skipped — no security-touching code. All changes
live in `apps/user-client/**` plus one ADR. No crypto, no auth, no sync, no
new dependencies.

---

## 0. TL;DR

Replace the existing `About` accordion body (a compact `dl` of Version /
Licence / Documentation) with a three-part composition:

1. **Mono-box** at the top — Version + sha + built-at. Unchanged from today.
2. **Two native `<details>` disclosure rows** below the mono-box:
   - *Privacy & data handling* — three short paragraphs (where data lives,
     what the app cannot see, external-provider caveat).
   - *Third-party libraries* — curated list from a new TS module
     `lib/third-party-licences.ts`.
3. **A flat licence-and-links footer** — copyright line, no-warranty
   sentence, and four external links: AGPL-3.0 full text on gnu.org,
   source on GitHub, our Provider Integration Policy at
   teaser.chatsundere.me/policy, and project documentation at
   chatsune.me.

No new route. No new accordion-card nesting. No bundled licence text — the
AGPL full text is referenced via the canonical FSF URL, which is a standard
and AGPL-compliant pattern (see ADR 0030 in §6). The bundled `LICENSE-AGPLv3`
at the repo root continues to satisfy source-distribution requirements.

---

## 1. Scope

### In scope

- Rewrite `apps/user-client/src/routes/app/account-sections/about-section.tsx`:
  - Keep the version mono-box exactly as it is today.
  - Drop the current Version / Licence / Documentation `dl`.
  - Add two native `<details>` disclosures (Privacy, Third-party libraries).
  - Add a flat licence-and-links footer block.
- New module `apps/user-client/src/lib/third-party-licences.ts` exporting
  a `ThirdPartyEntry` type and a `THIRD_PARTY_LICENCES` readonly array
  (~12 entries; see §3).
- New strings in `apps/user-client/src/lib/copy.ts` under
  `settings.about.privacy.*`, `settings.about.thirdParty.*`,
  `settings.about.licence.*`.
- New ADR `obsidian/decisions/0030-link-to-fsf-licence-text.md` documenting
  why we link to the FSF-hosted licence text instead of bundling the
  ~32 kB AGPL string into the app.
- Vitest cases covering the new render output (see §7).

### Deliberately out of scope

- Auto-generated dependency licence reports from `pnpm` / `license-checker`
  (manual curation is the chosen approach per brainstorm).
- A separate route or page for any of the three sub-sections.
- Translation of the privacy / disclaimer copy. British English only at
  Alpha; copy lives in `copy.ts` so a later i18n pass remains tractable.
- Pillar-level changes to `account.tsx` — the About accordion-card header
  and its placement among the other Account accordions stays untouched.
- Cookie / tracker disclosure — Chatsundere uses neither at Alpha. If we
  add anything tracker-shaped later, the privacy section gets a fourth
  paragraph at that point, not now.

---

## 2. Architecture & component shape

### 2.1. About-section composition

```tsx
export function AboutSection() {
  return (
    <div className="space-y-4">
      <VersionMonoBox />            {/* unchanged */}
      <PrivacyDisclosure />         {/* native <details> */}
      <ThirdPartyDisclosure />      {/* native <details> */}
      <LicenceFooter />             {/* flat copyright + links */}
    </div>
  );
}
```

All four blocks live as local helper components in `about-section.tsx` —
they share copy and styling, do not need to be reused elsewhere, and
extracting them to their own files would create premature surface area.

### 2.2. Disclosure pattern

Native `<details>` with Tailwind-styled `<summary>`. Chosen over the
existing `AccordionCard` for three reasons:

1. **No nesting heaviness.** `AccordionCard` ships its own
   `rounded-lg border border-white/5 bg-white/[0.02]` shell. Nesting two
   of those inside the About-accordion produces a visually busy
   border-in-border-in-border result.
2. **No JS state.** `<details>` is keyboard-accessible and screen-reader
   friendly out of the box; no `useState`, no scrollIntoView.
3. **Static content.** These sections never need programmatic
   open/close from outside (unlike the persona-editor accordions, which
   the engine sometimes scrolls into view on validation errors).

Shape:

```tsx
<details className="group border-t border-white/5 pt-3">
  <summary className="flex cursor-pointer list-none items-center justify-between font-display text-sm text-paper">
    {label}
    <span className="text-paper-soft transition-transform group-open:rotate-90">▸</span>
  </summary>
  <div className="space-y-3 pt-3 text-sm text-paper-soft">{body}</div>
</details>
```

`list-none` suppresses the default disclosure-triangle on `<summary>` so
the custom `▸` glyph is the only chevron rendered.

### 2.3. Licence-and-links footer

Flat — no disclosure. Layout:

```
Copyright © 2026 Chatsundere contributors. No warranty — see the licence for details.

Licence                       →  gnu.org/licenses/agpl-3.0.html
Source code                   →  github.com/symphonic-navigator/chatsundere
Our Provider Integration Policy  →  teaser.chatsundere.me/policy
Documentation                 →  chatsune.me
```

Each link opens in a new tab (`target="_blank"`, `rel="noopener noreferrer"`).
The arrow glyph is rendered via CSS (`::before` content) so it stays separate
from the link text for screen-readers.

The Provider Integration Policy link is verbatim "Our Provider Integration
Policy" — phrased in the first person plural on purpose. It is the
public statement of how Chatsundere (and its forthcoming NGO host) decides
which model providers to integrate; it is the mission-statement surface,
not a technical document. Treat the label text as fixed copy.

---

## 3. Data — third-party-licences module

New file `apps/user-client/src/lib/third-party-licences.ts`:

```ts
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
 * curated rather than auto-generated — see the Phase-4-alpha-prep
 * brainstorm for rationale.
 */
export const THIRD_PARTY_LICENCES: readonly ThirdPartyEntry[] = [
  { name: 'React',              version: '18.3',     licence: 'MIT',        homepage: 'https://react.dev' },
  { name: 'react-router-dom',   version: '6.28',     licence: 'MIT',        homepage: 'https://reactrouter.com' },
  { name: 'TanStack Query',     version: '5.59',     licence: 'MIT',        homepage: 'https://tanstack.com/query' },
  { name: 'Zustand',            version: '5.0',      licence: 'MIT',        homepage: 'https://zustand.docs.pmnd.rs' },
  { name: 'Dexie',              version: '4.x',      licence: 'Apache-2.0', homepage: 'https://dexie.org' },
  { name: 'Valibot',            version: '0.42',     licence: 'MIT',        homepage: 'https://valibot.dev' },
  { name: 'Tailwind CSS',       version: '4.x',      licence: 'MIT',        homepage: 'https://tailwindcss.com' },
  { name: 'qr-scanner',         version: '1.4',      licence: 'MIT',        homepage: 'https://github.com/nimiq/qr-scanner' },
  { name: 'workbox-window',     version: '7.3',      licence: 'MIT',        homepage: 'https://developer.chrome.com/docs/workbox' },
  { name: 'uuidv7',             version: '1.0',      licence: 'Apache-2.0', homepage: 'https://github.com/LiosK/uuidv7-js' },
  { name: 'Inter',              version: 'variable', licence: 'OFL-1.1',    homepage: 'https://rsms.me/inter' },
  { name: 'Lora',               version: 'static',   licence: 'OFL-1.1',    homepage: 'https://fonts.google.com/specimen/Lora' },
];
```

### 3.1. Rendering

Inside the `ThirdPartyDisclosure` body:

- Intro sentence: "Chatsundere bundles the following open-source projects.
  Their licences govern their respective code; full licence texts are
  available at the homepage of each project."
- One row per entry, semantic-`<dl>` layout. Suggested grid:

```
<entry-name>   <version>   <licence-pill>   <homepage-link>
```

- Licence is rendered with the existing `InlineMarker` component (tone
  `default`) for visual rhythm.
- Homepage link: small chevron `↗` glyph after the URL host (stripped of
  `https://`), opens in new tab.

### 3.2. Update discipline

Versions are tracked at major.minor granularity. The list is updated
manually when a listed dependency is upgraded past its current major.minor
in `apps/user-client/package.json`. A short maintenance note lives in the
JSDoc above the array. No CI enforcement — discipline mirrors the
manual-Larissa-audit pattern.

---

## 4. Copy

### 4.1. Privacy disclaimer

Three short paragraphs, British English, neurodivergent-friendly tone
(calm, no jargon, no marketing). Saved under
`settings.about.privacy.{title, whereTitle, whereBody, cannotSeeTitle,
cannotSeeBody, externalTitle, externalBody}` in `copy.ts`.

> **Where your data lives.** Chatsundere stores everything on this device.
> Your chats, personas, drafts, and provider credentials live in the
> browser's local storage (IndexedDB). Nothing is uploaded.
>
> **What we cannot see.** This alpha runs entirely in your browser. There
> is no Chatsundere server in the picture — we receive no telemetry, no
> analytics, and no account data. Clearing your browser storage wipes
> everything irrecoverably.
>
> **When you talk to external providers.** Models live with their
> providers (nano-gpt, Novita AI, Ollama Cloud, or any custom endpoint you
> configure). Your prompts, attachments, and replies travel directly from
> your browser to that provider — their privacy policy and terms of
> service apply to that traffic. Chatsundere never sees it; we also
> cannot enforce anything against it.

The `cannotSeeBody` paragraph deliberately doubles as a "no-recovery"
warning re-emphasis (clearing storage wipes everything, irrecoverably) —
this aligns with ADR 0007 and CLAUDE.md §13 ("No-recovery is a feature").

### 4.2. Third-party disclosure

```
{
  title: 'Third-party libraries',
  intro: 'Chatsundere bundles the following open-source projects. Their licences govern their respective code; full licence texts are available at the homepage of each project.',
  versionLabel: 'v',
  homepageLabel: 'homepage',
}
```

### 4.3. Licence footer

```
{
  copyright: 'Copyright © 2026 Chatsundere contributors.',
  noWarranty: 'No warranty — see the licence for details.',
  licenceLink: { label: 'Licence', value: 'GNU AGPL v3.0', href: 'https://www.gnu.org/licenses/agpl-3.0.html' },
  sourceLink: { label: 'Source code', value: 'github.com/symphonic-navigator/chatsundere', href: 'https://github.com/symphonic-navigator/chatsundere' },
  policyLink: { label: 'Our Provider Integration Policy', value: 'teaser.chatsundere.me/policy', href: 'https://teaser.chatsundere.me/policy' },
  docsLink: { label: 'Documentation', value: 'chatsune.me', href: 'https://chatsune.me' },
}
```

The existing `copy.settings.about.{versionLabel, licenceLabel, licenceValue,
docsLabel, docsValue}` keys are removed (callers cease to exist with this
rewrite). The `tabs.about` label ("About", used by the account-page
accordion header) stays.

---

## 5. AGPL compliance check

The AGPL-3.0 has three relevant compliance hooks at the UI layer:

1. **Section 0 + 5d — "Appropriate Legal Notices."** An interactive UI must
   prominently display a copyright notice, a no-warranty disclaimer, and
   a hint that users may convey the work under the licence. The licence
   footer covers all three: copyright line, no-warranty sentence, link to
   the licence text.
2. **Section 4 — "Conveying Verbatim Copies."** Source distribution must
   include the licence text. The bundled `LICENSE-AGPLv3` at the repo
   root already satisfies this; nothing in the UI changes that.
3. **Section 13 — Remote network interaction.** Any user interacting with
   a deployed Chatsundere instance must be offered access to the
   corresponding source. The licence footer's "Source code → github.com/…"
   link satisfies this for the canonical instance.

Linking out to the FSF-hosted licence text is standard practice (the FSF
itself recommends it for projects that prefer not to bundle the full text
into the binary surface); the bundled `LICENSE-AGPLv3` in the source tree
remains the canonical legal artefact for forks.

See ADR 0030.

---

## 6. ADR 0030 — Link to FSF licence text

New file `obsidian/decisions/0030-link-to-fsf-licence-text.md`.

**Title:** Link to the FSF-hosted AGPL-3.0 text instead of bundling it.

**Context:** The user-client's About surface needs to expose the project
licence in a discoverable way. Bundling the ~32 kB AGPLv3 text into the
SPA bundle adds bytes that every user pays in download cost on every
release, even though almost no user opens the licence body.

**Decision:** Link to `https://www.gnu.org/licenses/agpl-3.0.html` from
the About licence footer. The bundled `LICENSE-AGPLv3` at the repo root
remains the canonical artefact for source-distribution compliance (Section
4) and for forks.

**Consequences:**
- One fewer 32 kB asset in the bundle.
- A user who reads the licence depends on FSF availability at read time.
  Acceptable: the FSF URL has been stable for ~15 years; offline users can
  still find `LICENSE-AGPLv3` in the source tree.
- If the FSF ever moves the URL, the link is one constant in `copy.ts` to
  change. No code change required.

---

## 7. Testing

New file `apps/user-client/tests/unit/about-section.test.tsx`. Four cases:

1. **Mono-box renders Version + sha + built-at unchanged** — sanity guard
   so the rewrite does not regress the existing alpha-prep version display.
2. **Privacy disclosure renders three sub-headings** — assert the three
   `<strong>`-wrapped sub-titles (Where your data lives / What we cannot
   see / When you talk to external providers) are all present in the DOM.
3. **Third-party disclosure renders one row per entry** — count
   `[data-third-party-row]` elements and compare to
   `THIRD_PARTY_LICENCES.length`. Spot-check that React and Tailwind appear.
4. **Licence footer renders the four external links** — assert each
   `<a>` (Licence, Source code, Provider Integration Policy,
   Documentation) has the right `href`, `target="_blank"`, and
   `rel="noopener noreferrer"`. Assert the copyright and no-warranty
   strings are present as plain text. Spot-check the Policy link label
   text reads "Our Provider Integration Policy" verbatim — it is the
   mission-statement surface and the wording is load-bearing.

No new tests needed for `third-party-licences.ts` itself — pure data, no
logic to test.

---

## 8. Files touched

| File                                                                         | Change   |
|------------------------------------------------------------------------------|----------|
| `apps/user-client/src/routes/app/account-sections/about-section.tsx`         | rewrite  |
| `apps/user-client/src/lib/third-party-licences.ts`                           | new      |
| `apps/user-client/src/lib/copy.ts`                                           | update   |
| `apps/user-client/tests/unit/about-section.test.tsx`                         | new      |
| `obsidian/decisions/0030-link-to-fsf-licence-text.md`                        | new      |
| `obsidian/STATUS-CLIENT-ONLY.md`                                             | update   |

No changes to: `account.tsx` (accordion-card wrapper unchanged),
`AccordionCard.tsx`, `EditorTopbar.tsx`, any data layer, any Dexie schema,
any package.json.

---

## 9. Manual verification (Chris on device)

After the squash:

1. Open `/app/account`, expand `About`. Confirm version mono-box renders
   identically to today's build (version, sha, built-at).
2. Tap "Privacy & data handling" — three paragraphs expand. Tap again
   to collapse. Chevron rotates.
3. Tap "Third-party libraries" — list of ~12 entries renders. Tap one
   homepage link, confirm it opens in a new tab.
4. Tap the FSF licence link — opens `gnu.org/licenses/agpl-3.0.html` in
   a new tab.
5. Tap the GitHub source link — opens the repo in a new tab.
6. Tap "Our Provider Integration Policy" — opens
   `teaser.chatsundere.me/policy` in a new tab. Confirm the link label
   reads "Our Provider Integration Policy" verbatim (it is the
   mission-statement surface for the forthcoming NGO).
7. Keyboard test: tab through the section, confirm both disclosures
   open/close on Space and Enter, and that all four external links
   (Licence, Source, Policy, Documentation) are focusable in document
   order.
8. Scroll the About body up and down on mobile (380 px width) — no
   horizontal overflow, third-party rows stay legible.
9. Verify the screen still reads calmly: nothing flickers, no aurora
   pollution from the dimmed-ambient class on `/app/*`.

---

## 10. Open questions

None at design time. Versions in the third-party list are accurate to
`apps/user-client/package.json` as of 2026-05-28; if the package.json
moves a major between spec-approval and implementation, the impl plan
re-reads from `package.json` rather than from this spec.
