# Polish Block (Phase 2.8) — design spec

**Date:** 2026-05-24.
**Status:** brainstormed; ready for implementation plan.
**Implements:** four polish items requested by Chris before Phase 3 (Chat) begins. None of them changes data semantics in a Phase-3-blocking way; all are user-visible quality lifts that shape the tone of every surface that follows. Driven by the upcoming very-early-alpha release (~36 hours from this spec's date).
**Lead:** Liz. Larissa skipped — no security-touching code; all changes live in `apps/user-client/**` (`apps/user-client/src/routes/**`, `apps/user-client/src/components/**`, `apps/user-client/src/data/**`, `apps/user-client/src/boot/client-data-db.ts`, `apps/user-client/src/index.css`).
**Visual ground truth:** [`docs/index.html`](../../docs/index.html) for the Logo + Splash tone; [`chatsundere-prototype.html`](../../chatsundere-prototype.html) for the existing surfaces being polished.
**Out of scope:** Any data-model expansion beyond `SettingsRow.displayName`. Any change to the chat surface (Phase 3). Any change to crypto, auth, sync. Tooltip-system rework. Per-mindspace logo tinting (the gradient stays as in the teaser).

---

## 1. Purpose

Phase 2.7 left the user-client functionally complete for the client-only slice: six rooms in the Entrance Hall, Settings + Circle + Persona Editor + Account, draft+save flows, accordion smooth-scroll, Mindspace texture override hierarchy. What it doesn't yet have is **tone**.

Four polish items have surfaced from Chris's iteration-4 device-smoke on a smallest-Chromium-viewport profile. Each is small in isolation; together they set the visual and interaction grammar for everything Phase 3 and beyond will inherit.

- **Sticky-Header pattern** turns long accordion lists from "scroll-and-lose-your-tools" into "your tools are always one tap away". Becomes a permanent design guideline.
- **Display-Name** unblocks the chat-surface design choice for Phase 3 (the chat-topbar wants to say "Chris Tidesson", not "chris151"), and immediately improves the Entrance Hall greeting.
- **Logo-Style** unifies the visual code between [chatsune.me](https://chatsune.me) (Teaser) and the app shell — same gradient, same `✦`, same Lora.
- **Splash-Screen** is the first thing a very-early-alpha tester sees when they open the PWA from their home screen. It is the single highest-leverage piece of polish in this block.

---

## 2. Decisions captured during brainstorm

Each decision is sourced from Chris's answers in the brainstorming dialogue on 2026-05-24.

1. **Sticky-header pattern becomes a project-wide design guideline.** Every editor-class route (Persona Editor, My Settings, My Account, and later analogues) splits its top-of-page area into a *sticky* section (global actions: back, save-and-back, persona quick-actions where applicable) and a *scrolling* section (everything else, including identity fields and destructive actions). Destructive actions stay at the very end of the scroll region by design — they should be slightly harder to reach. Concretely the sticky region uses backdrop-blur with a hairline border (`border-b border-paper-soft/15`, `bg-bg/80 backdrop-blur-sm`) so the content underneath shimmers through. A new ADR records this as a design guideline.

2. **Identity in the Persona Editor scrolls with the content, not in the sticky region.** Identity (Name + Tagline today, Avatar later — Chris flagged that Avatar will land in a future iteration and make this section taller) belongs to the editable content, not to the global toolbar. Pinning Identity would steal too much vertical real estate from the accordion list at 380 px.

3. **Display-Name lives in My Account → Account-Section.** Chris weighed Settings ("about-me-ish") against Account ("identity-ish") and chose Account. Reason: display-name is set rarely, sits semantically next to the username, and About-Me in Settings is a much more frequent edit. Renaming the location later would cost more than placing it correctly now.

4. **Display-Name constraints: optional, trim on blur, max 60 characters, empty falls back to username.** 60 chars accommodates "Chris Tidesson" or "Chris von Wien-Innenstadt" without risking layout breaks at 380 px in `text-3xl`. Trim handles paste-from-clipboard whitespace silently. Empty-string is normalised to "use the username" via a `useDisplayName()` hook so callers never have to branch.

5. **Logo style: gradient Lora, not italic, with `✦` twinkle.** Italic Lora is replaced by Lora (regular weight) wrapped in a `linear-gradient(135deg, #4dd0ff 0%, #ff9ad9 50%, #ffd56b 100%)` clipped to the text (cyan → soft-pink → gold, identical to the teaser). The `✦` from the teaser is rendered as a small absolutely-positioned gold glyph at the top-right of the text. Twinkle animation runs at the same 3s ease-in-out infinite cadence as the teaser. `prefers-reduced-motion` disables the twinkle animation but keeps the static `✦` visible.

6. **Splash-Screen triggers once per browser session (cold-start only).** Detected via `sessionStorage.splashShown`. Reload via F5 → fresh splash. Tab-switch and return → no splash. PWA opened from homescreen → splash (each PWA launch is its own session). LocalStorage would make the splash a once-in-a-lifetime event, sacrificing the magical-moment value Chris wants for very-early-alpha testers.

7. **Splash content is minimal — Title + Tagline only.** No hero image, no hint pills, no CTAs. The teaser-page hero is a marketing surface; the splash is a 2-second app-start hand-off. The tagline reads *"Tsuntsun towards regulation. Deredere towards you."* in the same gradient-tone phrasing as the teaser. Hero images would inflate the PWA bundle and stretch the splash beyond what feels right for a cold-start.

8. **Splash overlay floats above the normal routing tree.** The React Router resolves to `/`, `/app`, `/onboarding`, `/unlock` etc. as normal underneath the overlay. When the splash unmounts, the route is already mounted and visible. This means no splash-specific routing branches for "logged-in vs onboarding vs unlocked" — the splash is identity-agnostic.

9. **Splash unmount paths: tap, Escape, reduced-motion, hard-timeout.** A click or tap anywhere in the overlay unmounts immediately. `Escape` key does the same for desktop/keyboard users. `prefers-reduced-motion: reduce` reduces the animation to a 200ms crossfade — no FLIP-migration, no tagline drift. A 3000ms hard-timeout unmounts the splash regardless of animation state — a safety net against "frozen splash" reports.

10. **Logo migration uses a FLIP-style transform on a clone.** The splash's centred `text-5xl` logo and the topbar's hidden `text-xl` logo are measured at start; the splash logo's CSS transform interpolates translate + scale in one 500ms ease-in-out transition (single property change, no double-animation seams). The real topbar logo is kept `opacity: 0` until the migration completes, then revealed — visually the splash logo "becomes" the topbar logo. Avoids reflow during animation.

11. **EditorSticky becomes a shared component, not a per-route copy.** A new `<EditorSticky>` wrapper component owns the sticky-positioning, backdrop-blur, hairline border, negative-margin trick to span the route's `px-4` gutter, and z-index management. Every editor route consumes it identically. Keeps the design guideline enforceable through a single point of change.

12. **Display-name schema lands as Dexie v4, no break-glass.** `SettingsRow.displayName: string` with default `''`. Existing rows backfilled by `.upgrade()` callback. No version-skew handling needed — Dexie's schemaless write for non-indexed fields means readers ignore unknown columns; the migration is forward-only.

---

## 3. Architecture

Four items, ordered from least-coupled to most-coupled, implemented in this sequence:

```
1. Logo style          (CSS + root.tsx)
2. Sticky-Header       (new component + 3 route adoptions)
3. Display-Name        (DB migration + Account section + hook + Hall usage)
4. Splash-Screen       (new overlay component + sessionStorage gate)
```

No cross-item shared state; each item is independently testable and ship-able. The order minimises rework: Logo style is consumed by both Sticky-Header (the Account/Persona EditorTopbar inherits global font-display sizing) and Splash (the splash logo IS the topbar logo, just bigger).

### Files touched

| File | Item | Change |
|---|---|---|
| `apps/user-client/src/index.css` | 1, 4 | New `.brand-logo` rules + splash animations + reduced-motion overrides |
| `apps/user-client/src/routes/root.tsx` | 1, 4 | Logo markup change; splash overlay mount; topbar logo ref for FLIP |
| `apps/user-client/src/components/EditorSticky.tsx` | 2 | New component |
| `apps/user-client/src/components/SplashOverlay.tsx` | 4 | New component |
| `apps/user-client/src/routes/app/persona-editor.tsx` | 2 | Adopt EditorSticky; quick-actions go into sticky region |
| `apps/user-client/src/routes/app/settings.tsx` | 2 | Adopt EditorSticky |
| `apps/user-client/src/routes/app/account.tsx` | 2 | Adopt EditorSticky |
| `apps/user-client/src/routes/app/account-sections/account-section.tsx` | 3 | Display-Name input + helper text |
| `apps/user-client/src/routes/app/entrance-hall.tsx` | 3 | Replace `session.username` with `useDisplayName()` |
| `apps/user-client/src/data/settings.ts` | 3 | New `useDisplayName()` hook |
| `apps/user-client/src/boot/client-data-db.ts` | 3 | Dexie v4 migration; `SettingsRow.displayName` |

### Tests touched

| File | Coverage |
|---|---|
| `apps/user-client/src/components/EditorSticky.test.tsx` (new) | Renders children; applies sticky positioning class; spans negative margin |
| `apps/user-client/src/components/SplashOverlay.test.tsx` (new) | Cold-start renders; second-mount no-op via sessionStorage; tap/Escape unmount; 3s timeout unmount; reduced-motion crossfade path |
| `apps/user-client/src/data/settings.test.ts` (update) | `useDisplayName` returns trimmed displayName when set, falls back to username when empty, returns '—' when both absent |
| `apps/user-client/src/boot/client-data-db.test.ts` (update) | v4 migration backfills `displayName: ''` on existing settings rows |
| `apps/user-client/src/routes/app/persona-editor.test.tsx` (update) | Sticky region contains EditorTopbar + quick-actions in edit mode, EditorTopbar only in create mode |
| `apps/user-client/src/routes/app/settings.test.tsx` (update) | Sticky region contains EditorTopbar |
| `apps/user-client/src/routes/app/account.test.tsx` (update) | Sticky region contains EditorTopbar; Display-Name input present in Account section |
| `apps/user-client/src/routes/app/entrance-hall.test.tsx` (update) | Greeting uses displayName when set, username when empty |
| `apps/user-client/src/routes/root.test.tsx` (update) | Logo renders with brand-logo class and twinkle span |

---

## 4. Item-by-item design

### 4.1 Logo style

**Markup** (`apps/user-client/src/routes/root.tsx`, replaces the current `<Link>`):

```tsx
<Link to="/" className="brand-logo group">
  <span className="brand-logo-text">Chatsundere</span>
  <span className="brand-logo-twinkle" aria-hidden>✦</span>
</Link>
```

**CSS** (additions to `apps/user-client/src/index.css`):

```css
.brand-logo {
  position: relative;
  display: inline-flex;
  align-items: baseline;
  font-family: var(--font-display);
  font-size: 1.25rem; /* text-xl */
  line-height: 1;
  font-style: normal;
}

@media (min-width: 1024px) {
  .brand-logo { font-size: 1.5rem; } /* text-2xl */
}

.brand-logo-text {
  background: linear-gradient(135deg, #4dd0ff 0%, #ff9ad9 50%, #ffd56b 100%);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
}

.brand-logo-twinkle {
  position: absolute;
  top: -0.2em;
  right: -0.55em;
  font-size: 0.35em;
  color: #ffd56b;
  animation: brand-twinkle 3s ease-in-out infinite;
}

@keyframes brand-twinkle {
  0%, 100% { opacity: 0.4; transform: rotate(0deg) scale(1); }
  50%      { opacity: 1;   transform: rotate(180deg) scale(1.2); }
}

@media (prefers-reduced-motion: reduce) {
  .brand-logo-twinkle { animation: none; opacity: 0.8; }
}
```

The `italic` modifier is removed from the previous markup; Lora regular is now the rendered weight.

### 4.2 Sticky-Header pattern

**New component** (`apps/user-client/src/components/EditorSticky.tsx`):

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';

interface Props { children: ReactNode; }

/**
 * Sticky wrapper for the top-of-page action bar on editor-class routes.
 * Children stay visually anchored to the viewport top as the surrounding
 * content scrolls. A backdrop-blur + hairline border lets the underlying
 * content shimmer through, so the sticky region reads as a tool palette
 * rather than a solid header.
 *
 * Negative horizontal margin + padding extends the blur to the full
 * route gutter; consuming routes use px-4 today, so -mx-4 px-4 wins.
 */
export function EditorSticky({ children }: Props): JSX.Element {
  return (
    <div className="sticky top-0 z-10 -mx-4 px-4 pb-2 pt-1 bg-bg/80 backdrop-blur-sm border-b border-paper-soft/15">
      {children}
    </div>
  );
}
```

**Adoption pattern** (Persona Editor):

```tsx
<section className="flex flex-col gap-3 px-4 pb-8 pt-4">
  <EditorSticky>
    <EditorTopbar title={…} … />
    {!isCreate ? (
      <div className="grid grid-cols-3 gap-2 mt-2">
        {(['Continue', 'New Chat', 'Incognito'] as const).map(label => …)}
      </div>
    ) : null}
  </EditorSticky>

  <section className="rounded-card …">{/* Identity */}</section>
  <AccordionCard …/>
  …
  {!isCreate ? <div className="rounded-lg border border-danger/30 …">{/* Delete */}</div> : null}
</section>
```

**Adoption pattern** (My Settings, My Account):

```tsx
<section className="flex flex-col gap-3 px-4 pb-32 pt-4">
  <EditorSticky>
    <EditorTopbar title={…} … />
  </EditorSticky>
  …
</section>
```

**Stacking context note:** Provider Sheet (modal) uses `z-50`+ today; AccordionCard contents use no z-index. `z-10` on EditorSticky is safe.

### 4.3 Display-Name

**Schema migration** (`apps/user-client/src/boot/client-data-db.ts`):

```ts
this.version(4).stores({/* unchanged stores */}).upgrade(async tx => {
  const settings = tx.table('settings');
  await settings.toCollection().modify(row => {
    if (typeof (row as { displayName?: unknown }).displayName !== 'string') {
      (row as { displayName: string }).displayName = '';
    }
  });
});
```

`SettingsRow` interface gains `displayName: string`. The v1 seed for new installs also writes `displayName: ''`.

**Hook** (`apps/user-client/src/data/settings.ts`):

```ts
export function useDisplayName(): string {
  const settings = useSettings();
  const session = useSessionStore(s => s.session);
  const dn = settings.data?.displayName?.trim();
  if (dn) return dn;
  return session?.username ?? '—';
}
```

**Account-Section UI** (`apps/user-client/src/routes/app/account-sections/account-section.tsx`, prepended to existing fields):

```tsx
<div className="mb-4">
  <label className="block mb-2 text-xs uppercase tracking-widest text-paper-soft" htmlFor="display-name">
    Display name <span className="text-paper-soft/60">(optional)</span>
  </label>
  <input
    id="display-name"
    type="text"
    maxLength={60}
    value={draftDisplayName}
    onChange={e => setDraftDisplayName(e.target.value)}
    onBlur={() => {
      const trimmed = draftDisplayName.trim();
      if (trimmed !== settings.data?.displayName) {
        void updateSettings.mutateAsync({ displayName: trimmed });
      }
      setDraftDisplayName(trimmed);
    }}
    className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-soft"
  />
  <p className="mt-1 text-[11px] text-paper-soft">
    How you appear across Chatsundere. Empty? Your username is used.
  </p>
</div>
```

**Persistence model:** unlike Persona Editor / My Settings (draft + Save), the Account section persists on blur. Rationale: the Account page intentionally has no Save-and-Back button (`hideSaveAndBack` per Phase 2.7); each field is its own micro-transaction.

**Entrance Hall consumption** (`apps/user-client/src/routes/app/entrance-hall.tsx`):

```tsx
const displayName = useDisplayName();
…
<div className="mt-2 text-3xl font-display" style={{ color: 'var(--mindspace-text-primary)' }}>
  {displayName}
</div>
```

The greeting copy "WELCOME BACK" stays as small uppercase eyebrow; the dynamic line now reads "Chris Tidesson" (display name) or "chris151" (username fallback) or "—" (no session yet).

### 4.4 Splash-Screen

**New component** (`apps/user-client/src/components/SplashOverlay.tsx`):

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'splashShown';
const HARD_TIMEOUT_MS = 3000;

/**
 * Cold-start splash overlay. Renders only when sessionStorage has not yet
 * marked the splash as shown. Layered above the routing tree at z-index 100;
 * the underlying route mounts and hydrates as normal while the overlay is up.
 *
 * Animation sequence (full-motion path):
 *   t=0     Title + tagline fade in (parallel, 400ms).
 *   t=1200  Tagline drifts down + fades out (600ms ease-out).
 *   t=1500  Title FLIP-migrates to the topbar logo position (500ms ease-in-out).
 *   t=2000  Overlay background fades out (300ms).
 *   t=2300  Component unmounts; STORAGE_KEY set.
 *
 * Skip paths:
 *   - click / tap anywhere in the overlay
 *   - Escape key
 *   - prefers-reduced-motion: reduce → 200ms crossfade, no FLIP
 *   - HARD_TIMEOUT_MS hard cap, independent of animation state
 */
export function SplashOverlay(): JSX.Element | null {
  const [show, setShow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(STORAGE_KEY) === null;
  });
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    const dismiss = () => {
      sessionStorage.setItem(STORAGE_KEY, '1');
      setShow(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    const timeout = window.setTimeout(dismiss, HARD_TIMEOUT_MS);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('keydown', onKey);
    };
  }, [show]);

  if (!show) return null;

  return (
    <div
      ref={overlayRef}
      role="button"
      aria-label="Skip intro"
      tabIndex={0}
      onClick={() => {
        sessionStorage.setItem(STORAGE_KEY, '1');
        setShow(false);
      }}
      className="splash-overlay fixed inset-0 z-[100] flex items-center justify-center cursor-pointer"
    >
      <div className="splash-content flex flex-col items-center gap-6 text-center px-6">
        <div className="splash-logo">
          <span className="brand-logo-text text-5xl font-display">Chatsundere</span>
          <span className="brand-logo-twinkle" aria-hidden style={{ fontSize: '1.2rem' }}>✦</span>
        </div>
        <p className="splash-tagline text-base text-paper">
          <span style={{ color: '#ff4dc8', fontWeight: 600 }}>Tsuntsun</span> towards regulation.
          {' '}
          <span style={{ color: '#ffd56b', fontWeight: 600 }}>Deredere</span> towards you.
        </p>
      </div>
    </div>
  );
}
```

**Mount point** (`apps/user-client/src/routes/root.tsx`, at the end of the layout's children, inside the `<div className="relative isolate …">`):

```tsx
<SplashOverlay />
```

The overlay deliberately mounts *inside* the routing tree so the topbar exists (and is measurable) by the time the FLIP-migration runs.

**CSS** (additions to `apps/user-client/src/index.css`):

```css
.splash-overlay {
  background:
    radial-gradient(ellipse at 20% 30%, rgba(255, 77, 200, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 70%, rgba(77, 208, 255, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 50% 50%, rgba(255, 213, 107, 0.04) 0%, transparent 60%),
    #050210;
  animation: splash-bg-fade 2300ms ease-out forwards;
}

.splash-content {
  animation: splash-content-fade 400ms ease-out;
}

.splash-tagline {
  animation: splash-tagline-drift 600ms ease-out 1200ms forwards;
}

@keyframes splash-bg-fade {
  0%, 87% { opacity: 1; }
  100%    { opacity: 0; }
}

@keyframes splash-content-fade {
  0%   { opacity: 0; transform: translateY(20px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes splash-tagline-drift {
  0%   { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(40px); }
}

@media (prefers-reduced-motion: reduce) {
  .splash-overlay     { animation: splash-bg-reduced 200ms ease-out forwards; }
  .splash-content     { animation: none; opacity: 1; }
  .splash-tagline     { animation: none; }
  .splash-logo        { animation: none !important; }
}

@keyframes splash-bg-reduced {
  0%, 50% { opacity: 1; }
  100%    { opacity: 0; }
}
```

**FLIP migration of the splash logo to the topbar logo (full-motion path only):**

The splash logo and the topbar logo are both rendered as `.brand-logo-text` spans. At `t=1500ms` the splash logo's bounding rect is compared to the topbar logo's bounding rect (the topbar is already in the DOM, just `opacity: 0`), and the splash logo gets a `transform: translate(Δx, Δy) scale(scaleFactor)` with a `transition: transform 500ms ease-in-out`. At `t=2000ms` the topbar logo's `opacity` flips to 1.

Implementation note: the FLIP step runs from a `setTimeout` inside `SplashOverlay`'s effect, reading the topbar logo via a `useRef` exposed through React Context (`SplashContext`) that the `Root` layout populates with `topbarLogoRef.current`. Avoiding context: a simple `document.querySelector('.brand-logo-text:not(.splash-logo .brand-logo-text)')` works and is fine because there is exactly one topbar at runtime — but Context is cleaner and unit-testable. **We use Context.**

**Reduced-motion path:** no FLIP, no tagline drift, just a 200ms crossfade of the overlay background. The splash logo simply fades with the background; the topbar logo is visible from `t=0` (no `opacity: 0` step on the reduced-motion path).

**Hard-timeout safety:** even if the FLIP calculation fails (e.g. topbar ref is null), the 3000ms hard-timeout unmounts the overlay, and the topbar logo's `opacity` flip is guarded by `try / finally` so a missing ref cannot leave the topbar invisible.

---

## 5. Migration plan

### Dexie schema

```
v3 → v4: SettingsRow.displayName: string
        v4 migration backfills '' on existing rows
        v1 seed already writes default Settings row; updated to include displayName: ''
```

No data loss on downgrade — `displayName` is a non-indexed string field; v3-aware code simply ignores it.

### sessionStorage

New key: `splashShown`. Set on first dismissal. No cleanup needed; the value is implicitly cleared on tab close.

### CSS variables

No new CSS variables. The splash uses hard-coded teaser palette values (`#4dd0ff`, `#ff9ad9`, `#ffd56b`, `#050210`) deliberately — these are brand colours, not mindspace colours, and should not theme with the active mindspace.

---

## 6. Acceptance criteria

Manually verifiable on Chris's smallest-Chromium-viewport profile:

### Logo
1. Topbar logo reads "Chatsundere" in Lora regular (no italic), with a cyan→pink→gold gradient and a small `✦` at the top-right.
2. The `✦` twinkles at the same cadence as the teaser-page hero title.
3. With `prefers-reduced-motion: reduce`, the `✦` is visible but does not animate.

### Sticky-Header
4. In Persona Editor (edit mode), scrolling the page keeps `← Edit Persona  [Save & Back]` and `[Continue] [New Chat] [Incognito]` glued to the viewport top.
5. In Persona Editor (create mode), only `← New Persona  [Save & Back]` is sticky; no quick-actions row.
6. In My Settings and My Account, only the EditorTopbar is sticky.
7. The sticky region's underlying content remains visible through the backdrop-blur as you scroll.
8. The Delete-Persona section is reachable only at the very bottom of the scroll region.
9. Tapping a non-sticky accordion still smooth-scrolls it into view per Phase 2.7.

### Display-Name
10. My Account → Account section shows a Display Name input above Username.
11. Typing "Chris Tidesson" and blurring persists the value; reloading the page keeps it.
12. The Entrance Hall greeting reads "WELCOME BACK / Chris Tidesson".
13. Clearing the Display Name and blurring falls back to the username in the greeting.
14. A 70-character paste is truncated to 60 characters silently.
15. Whitespace-only input ("   ") is normalised to empty (falls back to username).

### Splash-Screen
16. First load of `/` (or any route — splash is route-agnostic) plays the full animation: gradient background fades in, "Chatsundere" + tagline appear, tagline drifts down and fades, "Chatsundere" wanders to top-left while shrinking, overlay fades out.
17. After the splash, the topbar logo is in the position where the splash's logo arrived.
18. A second page load in the same session (F5 → F5) plays the splash only once.
19. Closing and reopening the PWA from the homescreen replays the splash.
20. Tapping anywhere during the splash dismisses it immediately.
21. Pressing Escape during the splash dismisses it immediately.
22. With `prefers-reduced-motion: reduce`, the splash is a 200ms crossfade with no movement.
23. If the topbar logo cannot be measured (degenerate case), the splash still dismisses within 3 seconds.

---

## 7. Open questions

None. All four items have unambiguous decisions from the brainstorm.

Future iterations flagged by Chris but explicitly out of this block:
- Avatar on personas → will land in a future iteration; the Identity section's design accommodates the future height growth without rework.
- Voice / TTS per persona → Block 4.
- Display-Name on chat-topbar → Phase 3; the `useDisplayName()` hook is the consumption point.

---

## 8. Manual verification (device-tested by Chris)

The full 23-point acceptance list is the manual verification surface. Recommended sequence on Chris's smallest-Chromium profile:

1. Fresh install → Splash plays → land in `/onboarding` (or `/app` for an unlocked tester).
2. Open My Account → Account section → set Display Name "Chris Tidesson" → blur → navigate to Entrance Hall → check greeting.
3. Open Persona Editor → scroll → confirm sticky region behaviour and Delete-zone position.
4. Open My Settings → scroll → confirm sticky EditorTopbar.
5. Reload (F5) → Splash does not play. Close PWA, reopen → Splash plays again.
6. Toggle reduced-motion in OS → reload → Splash is a crossfade.

---

## 9. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| FLIP-migration jank on low-end Android | Medium | Hard-timeout + reduced-motion fallback already in spec; manual smoke on smallest-Chromium covers it |
| sessionStorage being disabled by user / private mode | Low | Splash plays every load; not a bug, just slightly less smooth — log-noise free |
| Negative-margin trick on `EditorSticky` breaks if a route changes its `px-4` gutter | Low | Single point of change; if gutter changes, `-mx-4 px-4` becomes `-mx-N px-N` in one file |
| Display Name with emoji exceeding visual width | Low | `text-3xl` line-height accommodates wrap; max-60 keeps it bounded |
| Twinkle animation conflicting with WebGL backgrounds later | None today | No WebGL in Block 1; mindspace textures are CSS-only |

---

## 10. Sequencing

Single squashed commit per item, four commits total:

```
Polish 1/4 — Brand logo style (gradient + twinkle, drop italic)
Polish 2/4 — EditorSticky pattern across Persona Editor, Settings, Account
Polish 3/4 — Display-Name in My Account + Hall greeting
Polish 4/4 — Splash-Screen overlay with cold-start gating
```

Each commit ships with its own tests; the test suite stays green between commits. Items 1, 2, 3 are independently smoke-testable; item 4 is best smoked after item 1 (it depends on the new `.brand-logo-text` class).
