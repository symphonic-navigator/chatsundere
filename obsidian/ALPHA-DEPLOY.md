# First Alpha Deployment — Walkthrough

**For:** Chris, the morning of 2026-05-27 (or whenever the smoke is done).
**Status:** Implementation is sitting on master at commit `b6ba252` (Phase 4 alpha-prep squashed). Spec / plan / squash all green. Workflows haven't been triggered yet — `pages.yml` will fire on the first push to master.
**Goal:** ship `teaser.chatsundere.me/alpha/` for invited testers, version `v0.0.1`.

Estimated total time: **5–10 minutes** if everything goes right. Add 15 min for troubleshooting headroom.

---

## TL;DR sequence

1. **Smoke locally** (a couple of minutes — instructions §2).
2. **Push master** → `pages.yml` fires → build succeeds → **deploy fails** (Pages source still on branch-deploy). That's expected.
3. **Flip Pages source** in GitHub Settings (§4). One-time only.
4. **Re-run the workflow** from the Actions tab → deploy succeeds → visit `teaser.chatsundere.me/alpha/` to confirm.
5. **Tag `v0.0.1`** and push the tag → second workflow run with a stable version string.

---

## §1 What's on master

Single squashed commit `b6ba252`. Polish (retry helper, animations, streaming-orb, MINDSPACE_FALLBACK harden) + build pipeline (`version.txt`, Vite injection, `pages.yml`, version display in Entrance Hall + Account About).

The repo is currently in this state:

```
HEAD → b6ba252 Phase 4 alpha-prep squashed
       b22779f Phase 4 alpha-prep — implementation plan [skip ci]
       cc47159 Phase 4 alpha-prep — design spec [skip ci]
       ec7c1f3 Phase 4 simple-history squashed
       …
```

If you need to inspect what's in the squash before pushing:
```bash
git show b6ba252 --stat
git log -1 b6ba252
```

---

## §2 Local smoke (do this first)

Quick sanity check that nothing's obviously broken locally.

```bash
cd ~/workspace/chatsundere
pnpm typecheck && pnpm lint && pnpm --filter user-client run build
```

Expected: all green, build output goes into `apps/user-client/dist/`.

Quick UI smoke against `pnpm --filter user-client dev`:
- Entrance Hall footer reads `vdev · sha dev` at the bottom.
- Account → About section shows the same with `built dev`.
- Start a chat, see the bottom-affordance breathing (subtle, 3.5 s cycle).
- Pin the cockpit — gold border + soft glow appears.
- Navigate to Circle while a stream is running — small orb in the top-right of that persona's card.
- Same for My History.
- All these should respect `prefers-reduced-motion` if you toggle it in OS settings (orb static, no pulse).

If anything looks wrong, **stop and message me** before pushing — we fix locally first.

---

## §3 Push master (workflow fires, deploy will fail)

```bash
cd ~/workspace/chatsundere
git push origin master
```

Watch the Actions tab at `https://github.com/symphonic-navigator/chatsundere/actions`. You'll see two workflows trigger:

1. **CI** (existing) — lint / typecheck / build / test. Should be green.
2. **GitHub Pages Deploy** (new — `pages.yml`) — will go yellow through `Build PWA` and `Stage Pages output`, then **fail at "Deploy to GitHub Pages"** with something like:

   > HttpError: Not Found (404)

   That's because Pages source is still set to `Deploy from a branch`. The build itself worked — you can verify by looking at the artifact (top-right of the workflow run page → "Artifacts" → "github-pages"). Inside it is `/index.html` (teaser) and `/alpha/index.html` (PWA), version baked in.

Nothing's broken — this is the planned state. Move to §4.

---

## §4 Flip Pages source (one-time)

In a browser, sign in to GitHub:

1. Open `https://github.com/symphonic-navigator/chatsundere/settings/pages`.
2. Under **"Build and deployment"** → **"Source"**, change the dropdown from **"Deploy from a branch"** to **"GitHub Actions"**.
3. The UI usually auto-saves. If not, click **Save**.
4. Scroll down to **"Custom domain"** — should already say `teaser.chatsundere.me`. If it disappeared, type it back in and save again. CNAME stays in `docs/CNAME` either way.

**No downtime expected** — GitHub keeps serving the last branch-deployed content (current teaser) until a new Actions artifact replaces it.

---

## §5 Re-run the workflow

Either:

- Wait for the next master push to trigger it automatically, OR
- Manually re-run the failed `pages.yml` run from §3:
  - Actions → "GitHub Pages Deploy" → the failed run → **"Re-run all jobs"** button (top right).

This time the **"Deploy to GitHub Pages"** step should go green within about 30 seconds. Total workflow time is ~3–4 minutes (the lint + typecheck + build are the slow steps).

When it's green, the run page will show a `Deployed to github-pages environment` line with a URL pointing at `https://teaser.chatsundere.me/`.

---

## §6 Verify the pre-version deploy

Open in a fresh browser tab (or hard-refresh, `Ctrl+Shift+R`):

- **`https://teaser.chatsundere.me/`** — bestehende Teaser, unverändert.
- **`https://teaser.chatsundere.me/alpha/`** — die PWA. Should:
  - Load the splash, show the gradient brand mark
  - Navigate to onboarding (since you're not logged in there yet)
  - Footer in `/app` should read something like `v0.0.1-pre.1 · sha b6ba252` (or whatever short-sha + run-number the workflow produced)

If the PWA fails to load:
- **Hard-refresh** (`Ctrl+Shift+R`) — old Service Worker might be cached.
- **Open DevTools → Application → Service Workers** and unregister any old `/`-scoped workers from local dev that snuck onto the deployed origin.
- Verify `/alpha/build-manifest.json` exists — should return JSON.

---

## §7 Tag `v0.0.1` — first released alpha

```bash
cd ~/workspace/chatsundere
git tag -a v0.0.1 -m "First alpha release"
git push origin v0.0.1
```

This triggers `pages.yml` a second time. The version-compute step now resolves `VERSION=0.0.1` (no `-pre.N` suffix because we matched the `refs/tags/v*` pattern).

After ~3 minutes, refresh `teaser.chatsundere.me/alpha/`. The Entrance-Hall footer should now read **`v0.0.1 · sha b6ba252`** (or whatever sha the tag points at).

Account → About shows the full block:
```
Version 0.0.1
sha     b6ba252
built   2026-05-27T??:??:??Z
```

---

## §8 Invite alpha testers

Up to you — `chatsundere.me/alpha/` is a direct-access URL with no link from the public teaser. The invitation flow inside the app handles the rest (QR or paste-string from a server you've spun up).

You called this audience "ausgewählt, technisch sehr affine User" so they probably don't need hand-holding beyond:

1. The URL: `https://teaser.chatsundere.me/alpha/`
2. The invite (QR or paste-string) for their first device

Setup-Hints are deferred to Phase 5 — these testers don't need them.

---

## §9 If something goes wrong

### Workflow fails at "Install dependencies" or "Lint" or "Typecheck"
Probably a dependency drift or a pre-existing failing check that we didn't see in `pnpm install --frozen-lockfile`. Pull the workflow log, paste it to me. Local repro: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck` should match.

### Workflow fails at "Build PWA"
Vite-config issue likely. Local repro: `APP_VERSION=0.0.1-pre.x APP_SHA=test APP_BUILT_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ") VITE_BASE=/alpha/ pnpm --filter user-client build`. If that fails locally too, it's a real bug.

### Workflow fails at "Deploy to GitHub Pages" after the source flip
Re-check Pages settings — Source must be **"GitHub Actions"** (not "Deploy from a branch"). Also check `github.com/symphonic-navigator/chatsundere/settings/environments/github-pages` exists; sometimes it needs to be initialised once. The first successful Actions-source deploy creates it automatically.

### `/alpha/` loads but the version footer reads `vdev · sha dev`
Vite's `define` injection didn't pick up the env vars from the workflow. Check `pages.yml`'s **"Build PWA with /alpha/ base"** step — `APP_VERSION`, `APP_SHA`, `APP_BUILT_AT` env vars must be set on that step. They are in the committed file; if you've edited it, double-check.

### `/alpha/` loads but assets 404
Wrong base path. Open DevTools Network → reload → look at where the 404'd assets are coming from. Should be `/alpha/assets/index-*.js`. If they're `/assets/...` (no `/alpha/` prefix), the build wasn't run with `VITE_BASE=/alpha/`.

### Teaser at `/` is blank
Something went wrong in the staging step. Check the workflow log for the **"Stage Pages output"** step — should show `docs/*` being copied. If `docs/` is empty in the artifact, the file copy syntax in `pages.yml` is broken (extremely unlikely without an edit).

### Rollback
There's no need for an automatic rollback story for alpha — if a deploy is bad, push a fix forward. To revert Pages to branch-deploy temporarily:

1. Pages Settings → Source → "Deploy from a branch" → `master` / `docs`
2. The teaser comes back immediately; `/alpha/` disappears.
3. Fix locally, push, flip Source back to Actions.

---

## §10 What's next after the alpha goes live

Once first tester feedback starts coming in:

1. **Issue triage** — capture in `obsidian/insights/` first (informal), promote to GitHub Issues if they're real bugs.
2. **Patch releases** — bump `version.txt` (e.g. `0.0.2`), commit, tag `v0.0.2`, push. New deploy lands at `/alpha/` in minutes.
3. **Phase 5 design begins** when we have enough signal — Bookmarks + Setup-Hints + whatever else testers reveal.

---

## Quick reference

| Task | Command / URL |
|---|---|
| Local smoke | `pnpm typecheck && pnpm lint && pnpm --filter user-client run build` |
| Push master | `git push origin master` |
| Pages settings | `https://github.com/symphonic-navigator/chatsundere/settings/pages` |
| Actions tab | `https://github.com/symphonic-navigator/chatsundere/actions` |
| Tag v0.0.1 | `git tag -a v0.0.1 -m "First alpha release" && git push origin v0.0.1` |
| Verify deploy | `https://teaser.chatsundere.me/alpha/` |
| Verify teaser still works | `https://teaser.chatsundere.me/` |
| Spec | `superpowers/specs/2026-05-26-phase-4-alpha-prep-design.md` |
| Plan | `superpowers/plans/2026-05-26-phase-4-alpha-prep.md` |

— Liz, evening of 2026-05-26
