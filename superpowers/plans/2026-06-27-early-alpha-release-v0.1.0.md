# Early-alpha release v0.1.0 — release plan (Docker / VPS deploy)

## Context

Tonight (2026-06-27, ~2–3 h) the **first public early alpha `v0.1.0`** ships to a
hand-picked set of testers. The cut = the UI/UX makeover landing today (entrance hall +
all its sub-pages; the **chat makeover is deliberately not in it**, the app is
functionally usable).

**Deploy target = Chris's VPS, not GitHub Pages.** We build a **frontend Docker image**
the same way `../chatsune` does (multi-stage build → nginx runtime, GHCR registry,
`:latest` on the default branch), Chris runs only the **frontend** for now, plus a
**Watchtower** container that auto-pulls `:latest` → poor-man's CI/CD. The CORS proxy is
already running externally on `https://cors-proxy.tidesson.net`.

This supersedes the earlier Pages-based plan. The VPS path is strictly better here:

- **COOP/COEP for multi-threaded WASM becomes trivial** — two `add_header` lines in the
  frontend image's `nginx.conf`, set natively server-side. The whole `coi-serviceworker`
  / `injectManifest` complication only existed because GitHub Pages cannot set headers.
- **The embedding model needs no release-asset dance** — it is fetched as a cached build
  layer inside the Dockerfile, exactly like chatsune's 40 MB Vosk model
  (`../chatsune/frontend/Dockerfile:15-16`). The weights end up baked into the image in
  GHCR (i.e. "in GitHub", answering Chris's original question a), pulled from HuggingFace
  at build time, in a layer that rarely changes.
- **No `/alpha/` base path** — the image is served at the host root via Traefik.

Reference: `../chatsune/frontend/Dockerfile`, `../chatsune/.github/workflows/docker.yml`,
`../chatsune/docker-compose.prod.yml`, `../chatsune/HOWTO-DEPLOY.md`.

All work is **client-only / infra** — **no** `packages/crypto`, `auth/sync/proxy-service`
change → **no Larissa gate**. `sealSecret`/MK stay verbatim.

---

## Work package A — frontend Docker image (multi-stage, monorepo-aware)

New files: `apps/user-client/Dockerfile`, `apps/user-client/nginx.conf`, root
`.dockerignore`.

**Build stage** (`node:22-alpine`, corepack pnpm):
1. **Context = repo root** (monorepo). Copy `package.json`, `pnpm-lock.yaml`,
   `pnpm-workspace.yaml`, `turbo.json` + every workspace `package.json`, then
   `pnpm install --frozen-lockfile` (cached layer).
2. **Build the workspace packages** the user-client consumes from `dist/`:
   `pnpm --filter './packages/*' build` (mirrors the `predev` script). Required because
   `@chatsundere/crypto` and `@chatsundere/shared-types` resolve to `dist/`;
   `ui-shared` + `llm-unified` are aliased to source in `vite.config.ts`, `embeddings`
   exports source — those need no prebuild.
3. **Fetch the embedding model as its own cached layer** (chatsune-Vosk pattern): copy
   only `packages/embeddings/scripts/fetch-model.mjs` first, then run
   `pnpm --filter user-client fetch-model` (writes `apps/user-client/public/model/`,
   ~450 MB int8 + q4f16). Placed before the source copy so the heavy layer survives
   source changes. **Pin `REVISION` in `fetch-model.mjs` to a commit SHA** + fill
   `EXPECTED_SHA256` (reproducible builds; currently `'main'`).
4. Copy the rest, `pnpm --filter user-client build` (`VITE_BASE=/`, no `/alpha/`). Vite
   copies `public/model/` → `dist/model/`.

**Runtime stage** (`nginx:1.27-alpine`):
- `COPY --from=builder /app/apps/user-client/dist /usr/share/nginx/html`.
- `nginx.conf`: SPA fallback (`try_files $uri $uri/ /index.html`) — existing
  `/model/*.onnx` + hashed assets serve directly, only 404s fall back; **the two
  isolation headers** `Cross-Origin-Opener-Policy: same-origin` +
  `Cross-Origin-Embedder-Policy: credentialless` (credentialless matches the dev choice
  in `vite.config.ts:153` so cross-origin no-cors assets — VAD CDN, Google Fonts — keep
  loading without CORP); correct MIME + long cache for `/model/` and `/assets/`.
- `ARG VERSION/GIT_SHA/BUILT_AT` → `/VERSION` plain-text marker (chatsune parity).
- `EXPOSE 80`.

**COOP/COEP payoff:** with the headers served natively, the deployed app is
`crossOriginIsolated` → `SharedArrayBuffer` available → the embedding WASM backend runs
multi-threaded on non-WebGPU devices. No service-worker hack. (WebGPU devices use q4f16
regardless.)

---

## Work package B — CI/CD: GHCR image build + Watchtower auto-deploy

1. **`.github/workflows/docker.yml`** — adapt chatsune's, **frontend job only** for now
   (backend image deferred until Block 6):
   - `REGISTRY: ghcr.io`, `FRONTEND_IMAGE: ghcr.io/symphonic-navigator/chatsundere-frontend`.
   - triggers: push `master`, tags `v*.*.*`, PRs (PR builds don't push).
   - `docker/metadata-action` tags: branch, pr, `semver {{version}}/{{major}}.{{minor}}`,
     `sha`, raw version.txt value, and **`raw latest` gated on a tag push** —
     `enable=${{ startsWith(github.ref, 'refs/tags/v') }}` (NOT `is_default_branch`).
     **Deliberate deviation from chatsune:** `:latest` must move only on a `v*.*.*` tag,
     never on a plain master push, so Watchtower deploys only when we consciously cut a
     release. A master push still builds + pushes `sha-…`/branch-tagged images (keeps the
     build green) but leaves `:latest` — and therefore the live alpha — untouched.
   - `docker/build-push-action` with `context: .`, `file: apps/user-client/Dockerfile`,
     gha cache, `build-args` VERSION/GIT_SHA/BUILT_AT (version computed from `version.txt`
     like chatsune). cosign signing optional (nice-to-have, can defer).
2. **`version.txt`** `0.0.1` → `0.1.0`. Tag `v0.1.0` → image tagged `0.1.0` + `0.1.0`/`0.1`
   + `latest`.
3. **`infra/compose.alpha.yml`** (a NEW, dedicated frontend stack — NOT an
   extension of `compose.prod.yml.example`, which is the secret-bearing Block-6
   backend stack and stays untouched. The name also sidesteps the
   `.gitignore` rule on `compose.prod.yml`; this file carries no secrets and is
   committed as infra-as-code):
   - `frontend` service: `image: ghcr.io/symphonic-navigator/chatsundere-frontend:latest`,
     `restart: unless-stopped`, Traefik labels (`Host(\`app.chatsundere.me\`)`,
     `websecure` + letsencrypt, `loadbalancer.server.port=80`), on the external `traefik`
     network. Watchtower label `com.centurylinklabs.watchtower.enable=true`.
   - `watchtower` service (`containrrr/watchtower`): polls GHCR, pulls new `:latest`,
     recreates the frontend container. Scope it via the enable-label so it only manages
     opted-in containers. **The GHCR package is public → anonymous pulls, no auth config
     needed.**
4. **Host / DNS / TLS:** host = **`app.chatsundere.me`**, A + AAAA records already point
   at the VPS. Remaining prerequisite: Traefik + letsencrypt resolver up on the host
   (per chatsune `HOWTO-DEPLOY.md`).

**Flow:** push to `master` → `docker.yml` builds + pushes a `sha-…`/branch-tagged image,
`:latest` unmoved → **no deploy**. When ready, `git tag v0.1.x && git push --tags` →
`docker.yml` builds + moves `:latest` (+ `0.1.x`/`0.1`) → Watchtower on the VPS pulls +
recreates `frontend` → live. Deploying = consciously cutting a tag.

**First deploy:** tag `v0.1.0` first so `:latest` exists, then on the VPS
`docker compose -f infra/compose.alpha.yml up -d` (pulls the freshly-built `:latest`).

---

## Work package C — hard-code the CORS-proxy URL, access by API key only

Unchanged from the proxy decision. Minimal-invasive (Duplo): keep the
`corsProxy: { url, sharedKey }` shape, fix the `url`, drop it from the UI — the ~40
consumer sites keep reading `settings.corsProxy.url` (now always the constant);
`hasProxy = settings.corsProxy != null` stays the "key set?" gate.

1. Constant `CORS_PROXY_URL = 'https://cors-proxy.tidesson.net'` in
   `apps/user-client/src/lib/` (optionally override-able via the already-declared
   `VITE_PROXY_URL`, `env.ts:20`, which nothing consumes today).
2. `apps/user-client/src/components/CorsProxyBlock.tsx`: drop the URL input (show it
   read-only), `onSave` writes `{ url: CORS_PROXY_URL, sharedKey }` — user types the key
   only; adjust copy.
3. Defensively normalise an existing `corsProxy.url` to the constant on load (one line);
   no Dexie bump.
4. Adjust the `CorsProxyBlock` test to "key field only"; the rest stay green.

**Files:** `apps/user-client/src/components/CorsProxyBlock.tsx`, new constant in
`apps/user-client/src/lib/`. Consumer sites unchanged.

---

## Verification (end-to-end)

1. **Local image build:** `docker build -f apps/user-client/Dockerfile -t cs-frontend .`
   from repo root → succeeds; `/usr/share/nginx/html/model/Snowflake/.../onnx/model_int8.onnx`
   present. Pre-image gates green: `pnpm typecheck`, `pnpm lint`, user-client vitest.
2. **Local run:** `docker run -p 8080:80 cs-frontend` → open `localhost:8080`:
   - `window.crossOriginIsolated === true` in the console (COOP/COEP working).
   - **Embeddings:** create a knowledge-base document → model loads from `/model/`,
     embedding runs **multi-threaded**, completes.
   - **Proxy:** settings show a key field only; set the key → a proxy-gated provider
     (brave/kagi) becomes available, web-search routes through `cors-proxy.tidesson.net`
     (headers `x-cors-proxy-api-key`/`-target`); without the key it stays
     disabled-with-tooltip. CORS-friendly providers (nano-gpt) work without a key.
   - **Fonts/VAD** still load under COEP credentialless (no console CORP errors).
3. **CI:** push `master` → `docker.yml` pushes `…/chatsundere-frontend:latest`. Tag
   `v0.1.0` → semver tags present in GHCR.
4. **VPS:** `docker compose -f infra/compose.alpha.yml up -d` → Traefik serves the host
   over TLS; Watchtower pulls on the next `:latest`. Smoke on a real device: persona →
   chat → memory consolidation; PWA installable.

---

## Risks / non-goals

- **Not tonight:** backend/auth/sync/proxy images (proxy runs externally; backend is
  Block 6), the chat makeover, cosign signing (optional).
- **Monorepo Docker build is the main unknown** — get the workspace `pnpm install` +
  `packages/*` build + filtered `user-client build` right; iterate locally with
  `docker build` before wiring CI.
- **HF dependency at build time** — `fetch-model` pulls from HuggingFace; pin `REVISION`
  to a SHA so the layer is reproducible and resilient. (Release-asset is a fallback source
  if HF flakiness bites.)
- **Image size** ~450 MB model layer — cached, rarely re-pulled; acceptable, and
  self-contained beats a side-car asset for Watchtower.
- **Traefik + letsencrypt** must be up on the VPS first. (Resolved: DNS A+AAAA for
  `app.chatsundere.me` are set; the GHCR package is public, so Watchtower needs no auth.)
- **GitHub Pages:** the `pages.yml` `/alpha/` frontend deploy is now obsolete; the
  `docs/` teaser site (chatsune.me) is a separate question — leave as-is for now.
