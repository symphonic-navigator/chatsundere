# Phase 4 — Alpha-Prep (Polish + Build Pipeline) — design spec

**Date:** 2026-05-26 evening.
**Status:** brainstormed; ready for implementation plan.
**Implements:** the pre-`v0.0.1`-alpha gate. Two parallel concerns bundled
because they share the same deliverable (the first very-early-alpha
build): four small polish items deferred from Phase 3.3 + a GitHub-
Actions-based build & Pages-deploy pipeline modelled on
`../chatsune/.github/workflows/docker.yml` (versioning logic, build-
manifest), adapted to PWA + GitHub Pages instead of Docker.
**Lead:** Liz. **Larissa:** skipped — no security-touching code paths.
All changes live in `apps/user-client/**`, `.github/workflows/`, and a
new `version.txt` at the repo root. No crypto, no auth, no sync.
**Reference (read-only):** `../chatsune/.github/workflows/docker.yml`
(versioning logic), `../chatsune/version.txt` (single-source-of-truth
pattern), `../chatsune/backend/modules/llm/_retry.py` (retry helper port).
**Out of scope:** Bookmarks tab (Phase 5), Setup-Hints (Phase 5),
full-text search, archive, bulk-select, anything from STATUS § "Out of
scope / deferred". Hetzner VPS deployment — alpha uses GitHub Pages
exclusively. ADR for the new build pipeline — emerges from this work;
spec is the source of record until promoted.

---

## 0. TL;DR

Five interlocking pieces ship together:

1. **Retry-helper** — port `chatsune/_retry.py` to a TS helper that
   wraps `fetch` in `transport.ts`. Exponential backoff (1 / 2 / 4 / 8 s
   with ±25% jitter) on 408/429/500/502/503/504; honour `Retry-After`;
   propagate abort-signal; max 4 retries. Also applied to
   `runOneShotCompletion` (title-gen).
2. **Animation polish (Phase-3.3 Task 39)** — three keyframe sets:
   `.bottom-affordance` breathing (3.5 s, ±2% scale / ±10% opacity);
   `.scroll-to-end-btn` swap-in (240 ms ease-out, opacity + 4 px
   translate-y); `.cockpit[data-pinned=true]` static accent-glow.
3. **Per-card streaming indicator (Phase-3.3 Task 40)** — 8 px
   accent-coloured orb top-right of `.persona-card` and
   `.history-row`, shown when the matching persona has any live
   stream. 1.5 s pulse, reduced-motion → static full opacity.
4. **`MINDSPACE_FALLBACK` defensive harden** — replace the
   `{} as ResolvedMindspace` in `ChatStream.tsx` with a real fully-
   populated fallback (paper-default text colours, neutral grey
   accent, `'grain'` texture). Inline comment explains load-bearing.
5. **Build/Deploy pipeline** — new `version.txt` (`0.0.1`); chatsune-
   style version computation (`<base>` on tag-push, `<base>-pre.<run>`
   otherwise) baked into the PWA via Vite `define` and surfaced in
   two places (Entrance-Hall footer + Account → About). New
   `.github/workflows/pages.yml` deploys to GitHub Pages via
   `actions/deploy-pages@v4`; Pages source switched from "deploy from
   branch" to "GitHub Actions" (one-time settings change Chris does
   himself, click-folge included). Built PWA lands under
   `teaser.chatsundere.me/alpha/`; existing teaser HTML stays at `/`.
   No link from teaser to `/alpha/` — URL is direct-access only.

---

## 1. Scope

### In scope

- Retry-helper module `lib/retry.ts` (or similar in
  `packages/llm-unified`) consumed by `transport.ts` and
  `one-shot-completion.ts`.
- Animation polish — three keyframes + CSS rules + minimal
  `prefers-reduced-motion` overrides.
- Per-card streaming indicator — new `<StreamingOrb>` component,
  consumed by `PersonaCard` and `HistoryRow`.
- `MINDSPACE_FALLBACK` constant rewritten in `ChatStream.tsx` to a
  real value (no semantic change to ReasoningPill etc.).
- `version.txt` at repo root, single source of truth.
- `apps/user-client/vite.config.ts` reads `VITE_BASE` from env, falls
  back to `'/'`. PWA `start_url` / `scope` flow from `BASE_URL`.
- `apps/user-client/src/lib/version.ts` (new) — pure constants helper
  reading from `__APP_VERSION__` / `__APP_SHA__` / `__APP_BUILT_AT__`
  injected via `define`. `'dev'` defaults when running locally.
- Entrance-Hall footer with `v${version} · sha ${sha7}` micro-text.
- Account → About section gets a fuller version block.
- `.github/workflows/pages.yml` — version computation + build + deploy
  to GitHub Pages via `actions/deploy-pages@v4`. Triggers on
  `push: master` AND `push: tags: [v*.*.*]`.
- Existing `.github/workflows/ci.yml` left intact (lint / typecheck /
  build / test on every push + PR).
- README update — short section "Versioning + deployment" pointing to
  this spec. (One-time, [skip ci] commit alongside the squash.)
- `obsidian/STATUS-CLIENT-ONLY.md` update at the end.

### Deliberately out of scope (Phase 5 / later)

- Bookmarks tab — Phase 5.
- Setup-Hints — Phase 5.
- Date-group headers in History — deferred per LOC budget last cycle.
- Tagged-release tooling (auto-`version.txt`-bump, changelog
  generation) — manual for now.
- ADR for the build pipeline — captured in this spec; promote later
  if it grows.
- Docker / Hetzner deployment — alpha is Pages-only.
- Public link from teaser to `/alpha/`. The alpha is invite-only.
- Cockpit-draft localStorage test cascade (8 fails) — known follow-up,
  doesn't affect runtime.
- DRY-hygiene migrations (`flattenAnswerText`, `extras.thinking`,
  setTimeout leak) — defer.

---

## 2. Decisions (captured during brainstorm)

| # | Decision | Why |
|---|----------|-----|
| 1 | **Bundle polish + build pipeline in one cycle.** | Both serve the same goal (first alpha build). One spec, one plan, one squash keeps the milestone tight. |
| 2 | **Retry-helper is a stand-alone module in `packages/llm-unified`,** not inline in `transport.ts`. | Reusable by `one-shot-completion.ts` and any future LLM call surface. Mirrors chatsune's structure. |
| 3 | **Retry policy: max 4 retries, 1/2/4/8 s base, ±25% jitter, honour Retry-After.** Retry on 408/429/500/502/503/504. | chatsune-proven defaults. Title-gen and stream-completion both benefit. |
| 4 | **Streaming-orb on the card itself, not as overlay.** Subtle (8 px, persona-accent colour, 1.5 s pulse). | Avoid layout shift. Matches the "fewer elements per screen" memory principle. |
| 5 | **Pin glow is static, not pulsing.** | Already too much motion in the chat surface; pin is a state indicator, not an attention-getter. |
| 6 | **`MINDSPACE_FALLBACK` becomes a real value with full fields.** | Eliminates an NPE bomb if any future `ReasoningPill` (or other consumer) reads `mindspace.accent` without the store populated. |
| 7 | **`version.txt` at repo root, single source.** | chatsune-proven pattern; clean separation between code (`package.json`) and shipping version. |
| 8 | **Version computation = exact chatsune scheme** — `<tag-without-v>` on tag-push, `<base>-pre.<RUN_NUMBER>` on branch-push. | Cross-project consistency for me operating both repos. |
| 9 | **Vite injects version via `define`** (not via runtime fetch / not via env-read in browser). | Build-time bake, zero runtime cost, immutable per build. |
| 10 | **Version-display only in Entrance-Hall footer** (not global topbar). | Don't clutter every screen. Account → About has the full info for alpha-tester reports. |
| 11 | **GitHub-Pages source via `actions/deploy-pages@v4`** (not branch-source). | Modern, no `dist`-commit pollution in the repo, single workflow handles both teaser and alpha. |
| 12 | **Triggers: push to master + push to tags.** Master push → `pre.<run>` version. Tag push → released version. Both deploy to `/alpha/`. | Alpha needs fast iteration; tag is the release-marker for the alpha-tester's bug reports. |
| 13 | **Two workflows kept separate**: existing `ci.yml` (lint / typecheck / build / test) stays unchanged; new `pages.yml` handles version-compute + build + deploy. | Single-responsibility per workflow. CI is the gate; pages is the publisher. |
| 14 | **One-time manual settings flip** — Chris switches Pages source from "Deploy from a branch" to "GitHub Actions" via the GitHub UI. Click-folge included in §4.5. | Can't be done from code; needs to happen exactly once. |
| 15 | **No link from teaser to alpha.** Alpha is direct-URL-access only. | Per Chris's brief: "ohne link, einfach, dass die Applikation unter https://teaser.chatsundere.me/alpha aufgeht". Invite-only audience. |
| 16 | **No retry on abort-signal.** When the user aborts (cockpit Stop), the helper propagates `AbortError` immediately without backoff. | Stop-means-stop. Phase 3.2's NSFW Panic / cockpit-Stop already rely on instant abort semantics. |
| 17 | **Retry-helper is opt-in via an explicit wrapper call**, not transparently around every fetch. | We control the policy at the consumer level. `transport.ts` wraps the SSE-fetch; `one-shot-completion.ts` wraps the JSON fetch. Other future callers (e.g. cors-proxy probe) choose explicitly. |

---

## 3. Architecture

### 3.1 New / changed files

```
chatsundere/
├── version.txt                                       NEW — "0.0.1\n"
├── .github/workflows/
│   ├── ci.yml                                        UNCHANGED
│   └── pages.yml                                     NEW
├── packages/llm-unified/src/
│   ├── retry.ts                                      NEW — retry helper
│   ├── transport.ts                                  MOD — wrap SSE-fetch
│   └── one-shot-completion.ts                        MOD — wrap JSON-fetch
├── apps/user-client/
│   ├── vite.config.ts                                MOD — VITE_BASE + define
│   ├── public/manifest.webmanifest                   MOD or build-time
│   ├── src/
│   │   ├── lib/
│   │   │   └── version.ts                            NEW — exposes APP_VERSION etc.
│   │   ├── components/
│   │   │   └── StreamingOrb.tsx                      NEW
│   │   ├── components/chat/
│   │   │   ├── BottomAffordance.tsx                  MOD — breathing class
│   │   │   ├── ScrollToEnd.tsx                       MOD — swap-in animation
│   │   │   ├── Cockpit.tsx                           MOD — pinned-glow data-attr
│   │   │   └── ChatStream.tsx                        MOD — MINDSPACE_FALLBACK
│   │   ├── components/PersonaCard.tsx                MOD — orb top-right
│   │   ├── components/history/HistoryRow.tsx        MOD — orb top-right
│   │   ├── routes/app/entrance-hall.tsx              MOD — version footer
│   │   ├── routes/app/account-sections/
│   │   │   └── about-section.tsx                     MOD — version block
│   │   └── index.css                                 MOD — keyframes + classes
├── obsidian/
│   └── STATUS-CLIENT-ONLY.md                         MOD — at end
└── README.md                                         MOD — versioning section
```

### 3.2 Data flow — version

```
version.txt = "0.0.1"
        │
        ▼  (workflow step: Compute version)
GitHub Actions env:
  VERSION  = "0.0.1"  (tag) or "0.0.1-pre.42"  (branch)
  GIT_SHA  = first 7 chars of $GITHUB_SHA
  BUILT_AT = ISO-8601 UTC
        │
        ▼  (workflow step: Build PWA)
vite build with:
  define: {
    __APP_VERSION__:  JSON.stringify(VERSION)
    __APP_SHA__:      JSON.stringify(GIT_SHA)
    __APP_BUILT_AT__: JSON.stringify(BUILT_AT)
  }
  base: '/alpha/'
        │
        ▼
apps/user-client/dist/  →  GitHub Pages /alpha/
        │
        ▼
lib/version.ts exports { version, sha, builtAt }
        │
        ▼
EntranceHall footer + Account About section read & render
```

### 3.3 Data flow — retry helper

```
transport.ts (SSE)               one-shot-completion.ts (JSON)
        │                                      │
        └─────────────┐    ┌──────────────────┘
                      ▼    ▼
                 retry.ts: withRetry(fn, opts)
                   │
                   ├── opts.signal?  → propagate AbortError immediately
                   ├── fn() OK?      → return
                   ├── fn() throws or returns retryable status (408/429/5xx)?
                   │     ├── attempt < 4 ?
                   │     │     ├── compute delay = base * 2^attempt ± 25%
                   │     │     ├── if Retry-After header present, use that (capped at 60 s)
                   │     │     └── sleep(delay) → retry
                   │     └── else → throw last error / return last response
                   └── fn() throws non-retryable? → throw immediately
```

### 3.4 GitHub Pages site layout

```
teaser.chatsundere.me/
├── index.html              ← existing teaser (from docs/index.html)
├── assets/                 ← existing teaser assets
├── policy/                 ← existing legal
├── CNAME                   ← existing
└── alpha/                  ← NEW
    ├── index.html          ← PWA entry
    ├── assets/
    ├── manifest.webmanifest
    ├── sw.js
    └── (everything from apps/user-client/dist/)
```

Pages publishing source = "GitHub Actions". Workflow stages both
trees in a single `_pages/` directory and uploads as one artifact.

### 3.5 `lib/version.ts` contract

```ts
// apps/user-client/src/lib/version.ts
declare const __APP_VERSION__: string;
declare const __APP_SHA__: string;
declare const __APP_BUILT_AT__: string;

export interface VersionInfo {
  version: string;   // "0.0.1" | "0.0.1-pre.42" | "dev"
  sha: string;       // "1796752" | "dev"
  builtAt: string;   // ISO-8601 UTC | "dev"
}

export const APP_VERSION: VersionInfo = {
  version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
  sha: typeof __APP_SHA__ !== 'undefined' ? __APP_SHA__ : 'dev',
  builtAt: typeof __APP_BUILT_AT__ !== 'undefined' ? __APP_BUILT_AT__ : 'dev',
};
```

### 3.6 `retry.ts` contract

```ts
// packages/llm-unified/src/retry.ts
export interface RetryOpts {
  maxRetries?: number;          // default 4
  baseDelayMs?: number;          // default 1000
  jitterFraction?: number;       // default 0.25
  retryableStatuses?: number[];  // default [408, 429, 500, 502, 503, 504]
  signal?: AbortSignal;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: RetryOpts,
): Promise<T>;
```

Behavioural rules:

- `fn` is called with the current 0-indexed attempt number.
- If `fn` throws `AbortError` (or `signal.aborted` becomes true), the
  helper re-throws immediately — no retry.
- If `fn` returns a `Response` with `response.status ∈ retryableStatuses`,
  the helper consumes the body lazily (no throw) and retries. The
  consumer's wrapper around `withRetry` is responsible for converting
  a final retryable-status response into an error.
- If `fn` throws a `TypeError` (network failure), the helper retries.
- `Retry-After` is parsed from the previous response if present (only
  `delay-seconds` form supported; `HTTP-date` form falls back to
  computed backoff). Cap at 60 s.
- Backoff: `delay = baseDelayMs * 2^attempt * (1 + (Math.random() - 0.5) * jitterFraction * 2)`.
- After `maxRetries`, throws the last error (or returns the last
  retryable response for the consumer to handle).

---

## 4. Implementation specifics

### 4.1 Polish

**A1 — `retry.ts`** (see §3.6 contract). Consumed by:

- `packages/llm-unified/src/transport.ts` — wrap the `fetch` call that
  initiates the SSE. The retry behaviour kicks in BEFORE any SSE-chunk
  has been received; once streaming starts, retries are not allowed
  (a half-streamed reply can't be resumed).
- `packages/llm-unified/src/one-shot-completion.ts` — wrap the JSON
  fetch. Title-gen and any future one-shot caller benefit.

The CORS-proxy probe (`ProviderSheet` Test & Save) does NOT retry — a
probe failure should surface immediately. Documented inline.

**A2 — Animation polish.** All keyframes go into `apps/user-client/src/index.css`:

```css
@keyframes affordance-breath {
  0%, 100% { transform: scale(1); opacity: 0.9; }
  50%      { transform: scale(1.02); opacity: 1; }
}

.bottom-affordance {
  animation: affordance-breath 3.5s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .bottom-affordance { animation: none; opacity: 1; }
}

@keyframes scroll-to-end-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes scroll-to-end-out {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(4px); }
}

.scroll-to-end-btn[data-visible="true"]  { animation: scroll-to-end-in  240ms ease-out forwards; }
.scroll-to-end-btn[data-visible="false"] { animation: scroll-to-end-out 180ms ease-in  forwards; }

@media (prefers-reduced-motion: reduce) {
  .scroll-to-end-btn[data-visible="true"]  { animation: none; opacity: 1; }
  .scroll-to-end-btn[data-visible="false"] { animation: none; opacity: 0; }
}

.cockpit[data-pinned="true"] {
  border: 1px solid var(--mindspace-accent-border-active);
  box-shadow: 0 0 4px 0 color-mix(in srgb, var(--mindspace-accent) 12%, transparent);
}
```

`ScrollToEnd.tsx` gets a `data-visible` data-attribute driven by the
existing visibility prop. `Cockpit.tsx` already has `isPinned` in scope
— add `data-pinned` to the root element.

`BottomAffordance.tsx` already has the class; no JSX change needed,
only CSS.

**A3 — Per-card streaming indicator.** New component:

```tsx
// apps/user-client/src/components/StreamingOrb.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useStreamManagerStore } from '../state/stream-manager.store.js';

interface Props {
  personaId: string;
  /** Persona accent colour, used for the orb fill. */
  colour: string;
}

/**
 * Tiny pulsing dot, shown only when this persona has any live stream.
 * Used by PersonaCard and HistoryRow in the top-right corner.
 */
export function StreamingOrb({ personaId, colour }: Props): JSX.Element | null {
  const streaming = useStreamManagerStore((s) =>
    [...s.streams.values()].some((h) => h.personaId === personaId),
  );
  if (!streaming) return null;
  return (
    <span
      data-streaming-orb
      aria-hidden
      className="streaming-orb"
      style={{ background: colour, boxShadow: `0 0 6px 0 ${colour}` }}
    />
  );
}
```

CSS:

```css
.streaming-orb {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  animation: orb-breath 1.5s ease-in-out infinite;
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
}
@keyframes orb-breath {
  0%, 100% { transform: scale(1);   opacity: 0.5; }
  50%      { transform: scale(1.2); opacity: 1;   }
}
@media (prefers-reduced-motion: reduce) {
  .streaming-orb { animation: none; opacity: 1; }
}
```

`PersonaCard.tsx`: inside the `<li data-persona-card>`, add a
`<StreamingOrb personaId={persona.id} colour={mindspace.palette.accent} />`
at the start of the children (before the `<MindspaceTexture>`). Persona-
card already has `position: relative` (via the texture overlay), so
the absolute-positioned orb pins to the card's corner.

`HistoryRow.tsx`: inside the `<li className="history-row …">`, add
the orb similarly. The row's outer container needs `position: relative`
if it doesn't have it already.

**A4 — `MINDSPACE_FALLBACK`.** Replace the `{} as ResolvedMindspace`
in `apps/user-client/src/components/chat/ChatStream.tsx` with:

```tsx
const MINDSPACE_FALLBACK: ResolvedMindspace = {
  id: 'fallback',
  displayName: 'Fallback',
  texture: 'grain',
  palette: {
    bg: '#1a1a1a',
    surfaceBase: '#222222',
    surfaceRaised: '#2a2a2a',
    surfaceInput: '#1e1e1e',
    accent: '#888888',
    accentSubtle: 'rgba(136,136,136,0.06)',
    accentBorder: 'rgba(136,136,136,0.3)',
    accentBorderActive: 'rgba(136,136,136,0.6)',
    accentGlow: 'rgba(136,136,136,0.5)',
    text: {
      primary: '#e6e6e6',
      secondary: '#bdbdbd',
      muted: '#8a8a8a',
      ghost: '#5a5a5a',
    },
  },
};
// Load-bearing default — survives the brief window between component mount
// and the global mindspace store being populated. Any consumer that reads
// `mindspace.accent`, `mindspace.palette.text.*`, etc. before the store
// hydrates lands on these neutral values rather than `undefined`.
```

### 4.2 Build — version.txt + Vite

`version.txt` at repo root: single line `0.0.1\n`.

`apps/user-client/vite.config.ts` (modify existing):

```ts
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  define: {
    __APP_VERSION__:  JSON.stringify(process.env.APP_VERSION  ?? 'dev'),
    __APP_SHA__:      JSON.stringify(process.env.APP_SHA      ?? 'dev'),
    __APP_BUILT_AT__: JSON.stringify(process.env.APP_BUILT_AT ?? 'dev'),
  },
  plugins: [
    react(),
    VitePWA({
      // existing options retained, plus:
      base: process.env.VITE_BASE ?? '/',
      scope: process.env.VITE_BASE ?? '/',
      manifest: {
        // …existing fields…
        start_url: process.env.VITE_BASE ?? '/',
        scope: process.env.VITE_BASE ?? '/',
      },
    }),
  ],
});
```

`tsconfig.json` (user-client): add the ambient declares to
`src/vite-env.d.ts`:

```ts
declare const __APP_VERSION__: string;
declare const __APP_SHA__: string;
declare const __APP_BUILT_AT__: string;
```

### 4.3 Version display surfaces

**Entrance-Hall footer** — add to `apps/user-client/src/routes/app/entrance-hall.tsx`:

```tsx
import { APP_VERSION } from '../../lib/version.js';
// …after the room-grid block, before the closing </section>…
<footer className="mt-auto pt-6 text-center text-[10px] uppercase tracking-widest text-paper-soft/40">
  v{APP_VERSION.version} · sha {APP_VERSION.sha}
</footer>
```

The `mt-auto` pushes the footer to the bottom of the flex column.
Check the section's existing `flex flex-col` structure — `mt-auto` only
works inside a flex column. Adjust if the existing structure differs.

**Account → About** — add to
`apps/user-client/src/routes/app/account-sections/about-section.tsx`
(modify existing About accordion contents):

```tsx
import { APP_VERSION } from '../../../lib/version.js';
// …inside the existing About-section JSX, near the top…
<div className="mb-3 rounded-md border border-paper-soft/20 bg-black/20 p-3 font-mono text-xs text-paper-soft">
  <div>Version <span className="text-paper">{APP_VERSION.version}</span></div>
  <div>sha     <span className="text-paper">{APP_VERSION.sha}</span></div>
  <div>built   <span className="text-paper">{APP_VERSION.builtAt}</span></div>
</div>
```

### 4.4 GitHub Actions `pages.yml`

```yaml
name: GitHub Pages Deploy

on:
  push:
    branches: [master]
    tags: ['v*.*.*']

# Allow only one concurrent deployment, skipping queued runs.
concurrency:
  group: pages
  cancel-in-progress: true

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up mise (bun, node, pnpm)
        uses: jdx/mise-action@v2

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # Lightweight pre-flight so a broken master never publishes.
      # Lint + typecheck are cached by turbo; cheap to run twice across
      # ci.yml and pages.yml.
      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Compute version
        id: version
        run: |
          BASE=$(cat version.txt | tr -d '[:space:]')
          if [[ "$GITHUB_REF" == refs/tags/v* ]]; then
            VERSION="${GITHUB_REF#refs/tags/v}"
          else
            VERSION="${BASE}-pre.${GITHUB_RUN_NUMBER}"
          fi
          SHORT_SHA=$(echo "$GITHUB_SHA" | cut -c1-7)
          BUILT_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
          echo "version=$VERSION"     >> $GITHUB_OUTPUT
          echo "short_sha=$SHORT_SHA" >> $GITHUB_OUTPUT
          echo "built_at=$BUILT_AT"   >> $GITHUB_OUTPUT

      - name: Build PWA with /alpha/ base
        env:
          VITE_BASE: /alpha/
          APP_VERSION:  ${{ steps.version.outputs.version }}
          APP_SHA:      ${{ steps.version.outputs.short_sha }}
          APP_BUILT_AT: ${{ steps.version.outputs.built_at }}
        run: pnpm --filter user-client build

      - name: Stage Pages output
        run: |
          mkdir -p _pages
          cp -r docs/* _pages/
          cp -r apps/user-client/dist _pages/alpha

      - name: Write build manifest
        env:
          VERSION:   ${{ steps.version.outputs.version }}
          SHORT_SHA: ${{ steps.version.outputs.short_sha }}
          BUILT_AT:  ${{ steps.version.outputs.built_at }}
        run: |
          cat > _pages/alpha/build-manifest.json << EOF
          {
            "schema": "chatsundere-build/v1",
            "built_at": "$BUILT_AT",
            "trigger": "${GITHUB_EVENT_NAME}",
            "ref": "$GITHUB_REF",
            "artifact": {
              "name": "user-client",
              "type": "pwa",
              "version": "$VERSION",
              "git_sha": "$SHORT_SHA"
            }
          }
          EOF

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: _pages

      - name: Deploy to GitHub Pages
        id: deploy
        uses: actions/deploy-pages@v4
```

The build-manifest.json sits next to the PWA and serves as a
machine-readable provenance record (alpha-tester bug reports can
quote it).

### 4.5 GitHub Pages settings click-folge

Chris does this once, after the `pages.yml` workflow has run at least
one successful build:

1. Open `https://github.com/symphonic-navigator/chatsundere/settings/pages`.
2. Under **Source**, change "Deploy from a branch" → "**GitHub Actions**".
3. Save (some UI versions auto-save).
4. Trigger a re-run of `pages.yml` if needed (Actions → GitHub Pages
   Deploy → Run workflow).
5. Verify `https://teaser.chatsundere.me/` (still the teaser) and
   `https://teaser.chatsundere.me/alpha/` (the PWA, loads, can log in).

If the CNAME stops resolving after the source switch, re-add it via the
"Custom domain" field on the same Pages settings page (it should
persist, but worth a glance).

### 4.6 README + docs

`README.md` gains a short "Versioning & deployment" section:

```md
## Versioning & deployment

This repo follows a `version.txt`-driven scheme adapted from
[chatsune](https://github.com/symphonic-navigator/chatsune).
The base version lives in `version.txt` at the repo root.

- A push to `master` builds `<base>-pre.<run-number>` and deploys to
  `https://teaser.chatsundere.me/alpha/`.
- A push of an annotated tag `vX.Y.Z` (matching `version.txt`) builds
  `X.Y.Z` and replaces the `/alpha/` deployment.

The current alpha-deploy is a PWA served from GitHub Pages alongside
the public teaser site. There is intentionally no link from the teaser
to the alpha — access is invite-only by URL.

See `superpowers/specs/2026-05-26-phase-4-alpha-prep-design.md` for
the full design.
```

`obsidian/DEPLOYMENT.md` — deferred to Phase 5 to keep this cycle
tight. The README section above is enough to orient an alpha-tester
or returning contributor; the Obsidian-side deployment doc can grow
once we have Hetzner + Docker stories to tell.

---

## 5. Edge cases

- **Local dev**: `pnpm dev` runs with no `VITE_BASE` / `APP_*` env →
  defaults to `/` base and `'dev'` constants. Version footer shows
  `vdev · sha dev`. No regression to dev workflow.
- **Tag push that doesn't match `version.txt`**: workflow uses the
  tag verbatim. If `version.txt` says `0.0.1` and the tag is `v0.0.2`,
  the deploy says `0.0.2`. **Discipline**: Chris bumps `version.txt`
  in the same commit that's being tagged. No automation here yet.
- **Multiple pushes between tags**: each push produces a new
  `<base>-pre.<run>` deploy that overwrites `/alpha/`. Always-latest-
  master semantics.
- **Retry under abort**: cockpit-Stop fires `AbortController.abort()`.
  The retry helper checks `signal.aborted` BEFORE the next delay and
  re-throws. Documented inline; tested.
- **Retry-After: very long delay** (e.g. 3600s): capped at 60 s. Above
  that, surface the failure to the user — the model isn't recovering
  on retry-helper scale anyway.
- **Streaming-orb with zero personas streaming**: the `useStreamManagerStore`
  selector returns `false`; component returns `null`; no DOM cost.
- **`MINDSPACE_FALLBACK` accessed in a real chat**: shouldn't happen
  in practice (the store hydrates on mount); the fallback exists only
  for the millisecond between mount and store-update.
- **`/alpha/` Service Worker on first visit after upgrade**: Workbox
  handles cache invalidation by hashing assets; the `start_url:
  '/alpha/'` ensures the SW scope matches the route. Old `/`-scoped
  SWs (from local dev) won't interfere because the host differs.
- **CORS-proxy probe during retry**: probe path bypasses `withRetry`
  by construction — single shot, fast-fail, surfaces the actual error
  to the user immediately.

---

## 6. Tests

Estimated ~ 30 new Vitest + Bun cases.

### `packages/llm-unified/src/retry.test.ts` (Bun)

- Resolves first attempt.
- Retries on each retryable status (table-driven, all six codes).
- Does NOT retry on non-retryable statuses (e.g. 400, 401, 404).
- Caps at `maxRetries` and returns the last response (or throws the
  last error if `fn` always threw).
- Honours `Retry-After: <seconds>` from the previous response.
- Caps `Retry-After` at 60 s.
- Falls back to computed backoff for `Retry-After: <HTTP-date>`.
- Aborts cleanly when `signal.aborted` becomes true between attempts.
- Jitter: ±25% range — assert that 100 sampled delays fall within
  `base * 2^attempt * [0.75, 1.25]`.

### `packages/llm-unified/src/transport.test.ts` (Bun, extension)

- `transport.ts` wrapping `withRetry` retries on 503 then succeeds.
- Does not retry mid-stream (a chunk has already been received).

### `packages/llm-unified/src/one-shot-completion.test.ts` (Bun, extension)

- Title-gen path retries on 429 then succeeds.

### `apps/user-client/tests/unit/streaming-orb.test.tsx` (Vitest)

- Renders null when no stream for the persona.
- Renders the orb (`[data-streaming-orb]`) when a stream exists.
- Background style matches the passed `colour`.
- Multiple personas: only the matching one shows the orb.

### `apps/user-client/tests/unit/persona-card.test.tsx` (extension)

- Card shows the orb when a stream exists for its persona; not otherwise.

### `apps/user-client/tests/unit/history-row.test.tsx` (extension)

- Row shows the orb when a stream exists; not otherwise.

### `apps/user-client/tests/unit/chat-stream.test.tsx` (extension)

- `MINDSPACE_FALLBACK` has all required fields (sanity check —
  destructure all expected properties; assert each is defined).

### `apps/user-client/tests/unit/version.test.ts` (Vitest)

- `APP_VERSION` defaults to `'dev'` when no globals defined.
- When globals defined (via vitest `define` or stub), returns those.

### `apps/user-client/tests/unit/entrance-hall.test.tsx` (extension)

- Footer renders `v<version> · sha <sha>`.

### `apps/user-client/tests/unit/account.about.test.tsx` (extension or new)

- Account About section renders version + sha + built-at.

---

## 7. Manual verification

After implementation + first deploy, Chris runs:

1. **Local dev**: `pnpm --filter user-client dev` → app opens at
   `localhost:5173/` (no `/alpha/` base) → Entrance Hall footer reads
   `vdev · sha dev`. Account About reads the same.
2. **Local build**: `pnpm --filter user-client build` → no version
   info injected (everything `'dev'`) — confirms env-var gate works.
3. **CI build** (push to master): GH Actions `pages.yml` runs, version
   resolves to `0.0.1-pre.<N>`, deploy completes. Visit
   `teaser.chatsundere.me/alpha/` → app loads with PWA scope set to
   `/alpha/`. Footer reads the pre-version.
4. **Tag a release**: `git tag v0.0.1 && git push --tags`. Workflow
   re-runs, version = `0.0.1`. `/alpha/` updates. Footer reads `v0.0.1`.
5. **Retry behaviour**: artificially produce a 503 (chatsune
   conveniently 503s briefly during certain times — or use a
   `failureRate=0.5` config on a mock provider). Confirm the request
   retries silently and succeeds. No user-visible error.
6. **Retry-on-abort**: start a stream, hit Stop. Confirm no extra
   network requests (DevTools Network tab).
7. **Animations**: visit a chat, see the bottom-affordance breathing;
   scroll up, see scroll-to-end fade in; pin the cockpit, see the
   accent glow.
8. **Per-card orb**: start a stream in chat A, navigate to Circle.
   The card for persona A shows the orb; other cards don't.
9. **Reduced motion**: enable `prefers-reduced-motion: reduce` in OS
   settings. All animations halt (orb static, no breathing, scroll-
   to-end appears without translate, no affordance pulse).
10. **`/alpha/` Service Worker**: refresh `/alpha/` twice; offline
    mode still loads the shell.

---

## 8. Risks & open questions

- **Workbox `start_url` mismatch.** If the manifest's `start_url`
  doesn't match the scope path, mobile PWA install may install but
  not launch correctly. Mitigation: tested in §7 step 3.
- **First-time Pages settings flip race.** If Chris flips the source
  before `pages.yml` has produced an artifact, the Pages site might
  go blank for a few minutes. Mitigation: trigger a successful
  workflow run first, then flip.
- **`version.txt` drift vs tag.** Push of `v0.1.0` while
  `version.txt` still says `0.0.5` → the deploy says `0.1.0`. Not a
  bug, but a footgun. Mitigation: a small CI assertion would help
  (deferred to Phase 5).
- **CORS-proxy probe bypassing retry.** Acceptable per Decision 17,
  but if alpha testers report frequent transient probe failures, we'll
  revisit.
- **Service Worker between dev and Pages domains.** Local `localhost`
  SW shouldn't interfere with `teaser.chatsundere.me/alpha/`, but
  worth a defensive check.

---

## 9. Definition of done

- All Vitest + Bun tests green (existing 486 + 172 + ~30 new ≈ 688).
- `pnpm typecheck && pnpm lint && pnpm --filter user-client run build`
  all clean.
- `pages.yml` runs successfully end-to-end at least once on master.
- Pages settings switched to GitHub Actions.
- `teaser.chatsundere.me/alpha/` loads and shows the expected
  pre-version footer.
- A tagged `v0.0.1` deploy completes successfully.
- STATUS-CLIENT-ONLY.md updated.
- All squashed into a single `Phase 4 alpha-prep squashed` commit per
  ADR 0003 (plus README + DEPLOYMENT doc commits with `[skip ci]` as
  appropriate).

---

## 10. Pointers

- Implementation plan: `superpowers/plans/2026-05-26-phase-4-alpha-prep.md` (TBW).
- Phase 4 simple-history (just landed): commit `ec7c1f3`.
- chatsune versioning reference: `../chatsune/.github/workflows/docker.yml`, `../chatsune/version.txt`.
- chatsune retry reference: `../chatsune/backend/modules/llm/_retry.py`.
- Phase-3.3 deferred polish source: `superpowers/plans/2026-05-24-phase-3-chat.md` Tasks 39 & 40.
- Known-follow-ups list: STATUS-CLIENT-ONLY.md § "Known follow-ups".
- Pages-vs-Docker decision (this spec § 2 Decision 11): no prior ADR; promotable if it grows.
