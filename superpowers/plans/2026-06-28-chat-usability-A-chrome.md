# Chat Usability Pass — Slice A (Chrome) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the read-only chat topbar to parity (clear exit + persona avatar + chat title), swap the cockpit's four resource glyphs for real Lucide icons, and reposition toasts to a top full-width banner — all chrome, no new routes.

**Architecture:** The global brand bar (`routes/root.tsx`) gains a chat-aware reading-mode layout fed by a new `chatHeader` field on `current-chat.store`, published by `chat-page.tsx`. The chat-chrome predicate is narrowed to the *exact* chat route so Slice B's sub-pages stay on standard chrome. Cockpit glyphs become `lucide-react` components. Toast positioning moves from bottom-centre to a top content-width banner in `index.css`.

**Tech Stack:** React 18, react-router v6, Zustand, Tailwind v4 utility classes + `index.css`, `lucide-react`, Vitest.

**Spec:** `superpowers/specs/2026-06-28-chat-usability-pass-design.md` (Areas 1–3). British English throughout. Client-only — not a Larissa path.

---

## File structure

- `src/state/current-chat.store.ts` — add `chatHeader: ChatHeader | null` + `setChatHeader`.
- `src/routes/app/chat/chat-page.tsx` — publish `chatHeader`; clear on leave.
- `src/routes/root.tsx` — exact-route chat predicate; reading-mode topbar (exit button, avatar, title, NSFW).
- `src/components/chat/Cockpit.tsx` — swap the four resource glyphs for Lucide icons.
- `src/routes/app/persona-memory.tsx` — Brain icon in the page header (memory-icon consistency).
- `src/components/Toast.tsx` + `src/index.css` — top full-width banner.

---

## Task 1: `chatHeader` field on current-chat store

**Files:**
- Modify: `src/state/current-chat.store.ts`
- Test: `src/state/current-chat.store.test.ts` (create if absent; otherwise append)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { useCurrentChatStore } from './current-chat.store.js';

describe('chatHeader', () => {
  beforeEach(() => useCurrentChatStore.getState().reset());

  it('defaults to null', () => {
    expect(useCurrentChatStore.getState().chatHeader).toBeNull();
  });

  it('setChatHeader publishes persona + title and reset clears it', () => {
    useCurrentChatStore.getState().setChatHeader({
      personaId: 'p1',
      name: 'Laura',
      colour: '#c44e8e',
      title: 'Evening at the harbour',
    });
    expect(useCurrentChatStore.getState().chatHeader?.name).toBe('Laura');
    useCurrentChatStore.getState().reset();
    expect(useCurrentChatStore.getState().chatHeader).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/state/current-chat.store.test.ts`
Expected: FAIL — `setChatHeader is not a function` / `chatHeader` undefined.

- [ ] **Step 3: Implement**

Add the type above the store interface:

```ts
export interface ChatHeader {
  personaId: string;
  name: string;
  colour: string;
  title: string;
}
```

In `interface CurrentChatStore` add (near `chatPersonaIsAdult`):

```ts
  /** Persona + title of the active chat, published by chat-page for the
   *  read-only brand bar. `null` when not in a chat. */
  chatHeader: ChatHeader | null;
```

and in the actions block:

```ts
  setChatHeader: (header: ChatHeader | null) => void;
```

Add `'setChatHeader'` to the `Omit<…>` union for `InitialState`. Add `chatHeader: null` to `initial`. Add to the store body:

```ts
  setChatHeader: (header) => set({ chatHeader: header }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/state/current-chat.store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/state/current-chat.store.ts apps/user-client/src/state/current-chat.store.test.ts
git commit -m "Add chatHeader field to current-chat store"
```

---

## Task 2: Publish `chatHeader` from chat-page

**Files:**
- Modify: `src/routes/app/chat/chat-page.tsx`

Context: chat-page already publishes `setChatPersonaIsAdult` from `effectivePersona`. Find that effect (search `setChatPersonaIsAdult`). The chat title comes from the active chat row; the page already loads the chat (search for the chat title used by `InteractionTopbar` — it is passed down; reuse the same source, commonly `chat?.title`). `effectivePersona` exposes `id`, `name`, `colour`.

- [ ] **Step 1: Add the publish effect**

Locate the existing `setChatPersonaIsAdult` effect and add an adjacent effect (or extend it). Use the same title source the `InteractionTopbar` receives (trace the prop passed to `<InteractionTopbar … title={…}>` and reuse it; fall back to `''` when absent):

```ts
const setChatHeader = useCurrentChatStore((s) => s.setChatHeader);
// …
useEffect(() => {
  if (effectivePersona && activeChatId) {
    setChatHeader({
      personaId: effectivePersona.id,
      name: effectivePersona.name,
      colour: effectivePersona.colour,
      title: chatTitle ?? '',
    });
  } else {
    setChatHeader(null);
  }
  return () => setChatHeader(null);
}, [effectivePersona, activeChatId, chatTitle, setChatHeader]);
```

Replace `chatTitle` with the actual title binding used in this file (the same one feeding `InteractionTopbar`'s editable title). If the title lives in a query, depend on that value.

- [ ] **Step 2: Typecheck**

Run: `cd apps/user-client && pnpm typecheck --force`
Expected: clean (0 errors).

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/routes/app/chat/chat-page.tsx
git commit -m "Publish chatHeader from chat-page for the brand bar"
```

---

## Task 3: Narrow the chat-chrome predicate to the exact chat route

**Files:**
- Modify: `src/routes/root.tsx` (line ~42)
- Test: `src/routes/root.test.tsx` (append or create)

This is the Laura HARD fix: `/app/chat/:chatId/bookmarks` (Slice B) must NOT trigger chat chrome.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest';
import { isExactChatRoute } from './root.js';

describe('isExactChatRoute', () => {
  it('matches the chat itself', () => {
    expect(isExactChatRoute('/app/chat/abc123')).toBe(true);
    expect(isExactChatRoute('/app/chat/new')).toBe(true);
  });
  it('does not match cockpit sub-pages', () => {
    expect(isExactChatRoute('/app/chat/abc123/bookmarks')).toBe(false);
    expect(isExactChatRoute('/app/chat/abc123/artefacts')).toBe(false);
    expect(isExactChatRoute('/app/chat/abc123/knowledge')).toBe(false);
  });
  it('does not match other routes', () => {
    expect(isExactChatRoute('/app')).toBe(false);
    expect(isExactChatRoute('/app/treasury')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/routes/root.test.tsx`
Expected: FAIL — `isExactChatRoute` is not exported.

- [ ] **Step 3: Implement**

Add an exported helper near the top of `root.tsx`:

```ts
/** True only for the chat surface itself (`/app/chat/:chatId` or `/app/chat/new`),
 *  not its cockpit sub-pages — so those fall back to standard page chrome. */
export function isExactChatRoute(pathname: string): boolean {
  return /^\/app\/chat\/[^/]+$/.test(pathname);
}
```

Replace the existing predicate (`const isChatRoute = location.pathname.startsWith('/app/chat')`) with:

```ts
const isChatRoute = isExactChatRoute(location.pathname);
```

Leave `isReadingChat = isChatRoute && !isInteractionMode` as-is (now exact-route based).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/routes/root.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/root.tsx apps/user-client/src/routes/root.test.tsx
git commit -m "Narrow chat-chrome predicate to the exact chat route"
```

---

## Task 4: Read-only topbar — exit button, persona avatar, chat title

**Files:**
- Modify: `src/routes/root.tsx`

Build the reading-mode chat layout. In interaction mode the `InteractionTopbar` covers chrome; this branch is for `isReadingChat`. Use the new `chatHeader`.

- [ ] **Step 1: Add imports + store read**

At the top of `root.tsx`:

```ts
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PersonaAvatar } from '../components/PersonaAvatar.js';
import { useCurrentChatStore } from '../state/current-chat.store.js';
```

Inside the component:

```ts
const navigate = useNavigate();
const chatHeader = useCurrentChatStore((s) => s.chatHeader);
const isInteractionMode = useCurrentChatStore((s) => s.isInteractionMode);
```

(If `isInteractionMode` is already read here, reuse it.)

- [ ] **Step 2: Render the reading-mode clusters**

Replace the **left cluster** `<div className="flex items-center gap-2">…</div>` so that, when `isReadingChat && chatHeader`, it renders the exit button (arrow + wordmark) + avatar; otherwise the existing logo. The exit `Link` goes to **`/app`** (not `/`):

```tsx
<div className="flex min-w-0 items-center gap-2">
  <Link
    to="/app"
    className={`brand-logo${isReadingChat ? ' brand-logo-small' : ''} flex items-center gap-1`}
    style={{ opacity: topbarLogoVisible ? 1 : 0 }}
    aria-label={isReadingChat ? 'Leave chat' : 'Chatsundere home'}
  >
    {isReadingChat && <ArrowLeft size={18} aria-hidden="true" />}
    <span ref={(el) => { topbarLogoRef.current = el; }} className="brand-logo-text">
      Chatsundere
    </span>
    {!isReadingChat && (
      <span className="brand-logo-twinkle" aria-hidden="true">✦</span>
    )}
  </Link>
  {isReadingChat && chatHeader ? (
    <button
      type="button"
      className="topbar-persona-link"
      aria-label={`Go to ${chatHeader.name}`}
      onClick={() => navigate(`/app/persona/${chatHeader.personaId}`)}
    >
      <PersonaAvatar
        personaId={chatHeader.personaId}
        name={chatHeader.name}
        colour={chatHeader.colour}
        size={28}
      />
    </button>
  ) : null}
  <BackgroundStreamBadge />
</div>
```

Also pin the **interaction-mode exit** to `/app`: in `InteractionMode.tsx`/`InteractionTopbar.tsx` the hamburger exit calls a handler — confirm it navigates to `/app` (the brand-logo tap already routes to the Entrance Hall per `InteractionMode.tsx:92`). If it currently targets `/`, change to `/app`.

- [ ] **Step 3: Render the right cluster with the chat title**

Replace the **right cluster** so, in reading-chat mode, it shows the plain-text title (truncating) left of the NSFW pill:

```tsx
<div className="flex min-w-0 items-center gap-2 lg:gap-3">
  {isReadingChat && chatHeader ? (
    <span className="max-w-[140px] truncate text-xs text-paper-soft" title={chatHeader.title}>
      {chatHeader.title}
    </span>
  ) : null}
  {!isLoginRoute && <AdultModeToggle />}
  {!isChatRoute && session && (
    <span className="hidden font-mono text-xs text-paper-soft lg:inline">{session.username}</span>
  )}
  {!isChatRoute && <ConnectivityBadge />}
</div>
```

The title is a `<span>` (plain text — never button-like), so it never invites a tap (Laura soft).

- [ ] **Step 4: Add minimal styling**

Add to `index.css` near the brand-bar styles:

```css
.topbar-persona-link {
  display: inline-flex;
  flex: 0 0 auto;
  border-radius: 999px;
  line-height: 0;
}
```

- [ ] **Step 5: Typecheck + build + manual sanity**

Run: `cd apps/user-client && pnpm typecheck --force && pnpm build`
Expected: clean. (Device verification of the layout is in the spec §9.)

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/routes/root.tsx apps/user-client/src/index.css apps/user-client/src/components/chat/InteractionMode.tsx apps/user-client/src/components/chat/InteractionTopbar.tsx
git commit -m "Rebuild read-only chat topbar: exit, persona avatar, title"
```

---

## Task 5: Cockpit icons → Lucide (Bookmark / Gem / Brain / BookOpen)

**Files:**
- Modify: `src/components/chat/Cockpit.tsx`
- Modify: `src/routes/app/persona-memory.tsx` (Brain in the page header for consistency)

Cosmetic only — the buttons keep their current behaviour in Slice A (Slice B rewires them to navigate). The pin button (inline SVG) shows the sizing convention (`size={20}`).

- [ ] **Step 1: Import the icons**

At the top of `Cockpit.tsx`:

```ts
import { BookOpen, Bookmark, Brain, Gem } from 'lucide-react';
```

- [ ] **Step 2: Replace the four glyph spans**

- ToC button (`data-control="toc"`): replace `<span className="cockpit-glyph" aria-hidden="true">◈</span>` with `<Bookmark className="cockpit-glyph" size={20} aria-hidden="true" />`.
- Artefacts (`data-control="artefacts"`): `◈`/`⬡` → `<Gem className="cockpit-glyph" size={20} aria-hidden="true" />`.
- Memory (`data-control="memory"`): `◌` → `<Brain className="cockpit-glyph" size={20} aria-hidden="true" />`.
- Knowledge (`data-control="knowledge"`): `❖` → `<BookOpen className="cockpit-glyph" size={20} aria-hidden="true" />`.

Keep each button's existing `aria-label`, classes, count badges, and click handlers unchanged.

- [ ] **Step 3: Ensure `.cockpit-glyph` sizes the SVG**

`.cockpit-glyph` currently styles a text glyph (font-size). Lucide renders an inline SVG sized by the `size` prop, so no CSS change is strictly required; verify the icon inherits `currentColor` (Lucide does by default). If the glyph span had `font-size`/`line-height` that now leaves odd spacing, add:

```css
.cockpit-icon-btn .cockpit-glyph { display: inline-flex; }
```

- [ ] **Step 4: Brain on the memory page header**

In `persona-memory.tsx`, add `import { Brain } from 'lucide-react';` and place `<Brain size={18} aria-hidden="true" />` adjacent to the memory page title/crumb so the cockpit button and the page share the icon (match the existing header markup; if the header is a plain crumb string, render the icon beside the "Memory" current-crumb).

- [ ] **Step 5: Typecheck + build**

Run: `cd apps/user-client && pnpm typecheck --force && pnpm build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/chat/Cockpit.tsx apps/user-client/src/routes/app/persona-memory.tsx
git commit -m "Swap cockpit resource glyphs for Lucide icons"
```

---

## Task 6: Toast → top full-width banner (global)

**Files:**
- Modify: `src/index.css` (`.toast-stack` / `.toast`)
- Modify: `src/components/Toast.tsx` (banner flex layout)

- [ ] **Step 1: Reposition the stack**

Replace `.toast-stack` (currently bottom-centred) in `index.css`:

```css
.toast-stack {
  position: fixed;
  top: calc(env(safe-area-inset-top) + 3.25rem); /* clears the brand bar */
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 420px;
  padding: 0 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  z-index: 100;
  pointer-events: none;
}
@media (min-width: 1024px) {
  .toast-stack { max-width: 640px; }
}
```

Change `.toast` from a centred rectangle to a full-width banner:

```css
.toast {
  background: rgba(20, 20, 20, 0.95);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.5rem;
  padding: 0.6rem 1rem;
  color: inherit;
  font-size: 0.85rem;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  pointer-events: auto;
  animation: toast-in 250ms ease-out;
}
```

Update the `@keyframes toast-in` to slide from the top:

```css
@keyframes toast-in {
  from { opacity: 0; transform: translateY(-0.5rem); }
  to   { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 2: Banner layout in Toast.tsx**

The message + optional action now sit on one row. Wrap the message text so it can shrink:

```tsx
<div key={t.id} className="toast" data-tone={t.tone}>
  <span className="toast-message">{t.message}</span>
  {t.action ? (
    <button
      type="button"
      className="toast-action"
      onClick={() => { t.action?.onClick(); toastStore.dismiss(t.id); }}
    >
      {t.action.label}
    </button>
  ) : null}
</div>
```

Add `.toast-message { min-width: 0; }` and `.toast-action { flex: 0 0 auto; }` to `index.css` if not already present.

- [ ] **Step 3: Note for the visual pass**

The `3.25rem` top offset clears the non-chat brand bar; on list pages the `PageBar` sits just below and a banner could briefly sit alongside it. Per spec §4 (Laura soft) the exact offset and PageBar non-occlusion are confirmed/tuned in the later visual pass — do not over-engineer here. Leave a `/* visual-pass: tune offset vs PageBar */` comment by `.toast-stack`.

- [ ] **Step 4: Typecheck + build + existing toast tests**

Run: `cd apps/user-client && pnpm typecheck --force && pnpm build && pnpm vitest run src/components/Toast`
Expected: clean; any existing Toast tests still pass (selectors on `.toast`/`.toast-action` unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/index.css apps/user-client/src/components/Toast.tsx
git commit -m "Reposition toasts to a top full-width banner"
```

---

## Slice A self-review checklist

- [ ] Spec Area 1 (topbar): exit button (arrow+wordmark→/app), avatar→persona, plain-text title, NSFW pill, exact-route gating — Tasks 3+4.
- [ ] Spec Area 2 (icons): Bookmark/Gem/Brain/BookOpen + Brain on memory page — Task 5.
- [ ] Spec Area 3 (toast): top, full-width banner, global — Task 6.
- [ ] No placeholder steps; all icons via `lucide-react` (already a dep).
- [ ] `chatHeader` type/field names consistent across Tasks 1, 2, 4.

## Gates before squash

```bash
cd apps/user-client && pnpm typecheck --force && pnpm build && pnpm vitest run
cd ../.. && pnpm biome check apps/user-client/src   # or the repo's Biome command
```

Then: **Laura pre-squash pass** on the diff (light — verify the read-only topbar honours the approved intent), fold/defer, squash as one unit ("Rebuild chat read-only topbar, cockpit icons and toast position"). Branch kept until Chris pushes. Update `obsidian/STATUS-CLIENT-ONLY.md`.
