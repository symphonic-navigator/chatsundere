# syntax=docker/dockerfile:1
# Frontend (user-client PWA) production image. Multi-stage, monorepo-aware:
# the build context is the REPO ROOT, not apps/user-client, so the pnpm
# workspace resolves. Layers are ordered cheapest-to-invalidate first so the
# heavy embedding-model layer survives ordinary source changes.

# ---------- Build stage ----------
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# 1. Manifests first → install is cached until a manifest or the lockfile moves.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json biome.json ./
COPY apps/user-client/package.json apps/user-client/
COPY apps/admin-client/package.json apps/admin-client/
COPY apps/auth-service/package.json apps/auth-service/
COPY apps/sync-service/package.json apps/sync-service/
COPY apps/proxy-service/package.json apps/proxy-service/
COPY packages/crypto/package.json packages/crypto/
COPY packages/embeddings/package.json packages/embeddings/
COPY packages/llm-unified/package.json packages/llm-unified/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/ui-shared/package.json packages/ui-shared/
# --ignore-scripts: the root `prepare` hook runs `lefthook install`, which needs
# a git repo (absent in the build context) and the git binary (absent in alpine).
# It also skips native postinstalls (onnxruntime-node, @napi-rs/canvas) the
# browser build never uses — it runs onnxruntime-web (WASM), not the node binding.
RUN pnpm install --frozen-lockfile --ignore-scripts

# 2. Embedding weights (~450 MB) as their own stable layer. Only the fetch
#    script is needed; it writes the self-hosted /model tree the client serves.
#    The REVISION is pinned to a commit SHA inside the script (reproducible).
COPY packages/embeddings/scripts/fetch-model.mjs packages/embeddings/scripts/fetch-model.mjs
RUN MODEL_OUT_DIR=/app/apps/user-client/public/model \
    node packages/embeddings/scripts/fetch-model.mjs

# 3. Build the workspace packages the client consumes from dist/. ui-shared and
#    llm-unified are aliased to source by Vite, but the client's tsc step
#    resolves every @chatsundere/* import through package exports (dist), so the
#    buildable packages must be compiled. embeddings exports source — no build.
COPY packages/ packages/
RUN pnpm --filter './packages/*' build

# 4. Build the client. VITE_BASE=/ (host-root deploy, no /alpha/ prefix). The
#    APP_* values are baked into the bundle by vite.config define(); Vite copies
#    public/ (incl. the model tree from step 2) into dist/.
ARG VERSION=0.0.0-dev
ARG GIT_SHA=""
ARG BUILT_AT=""
ENV NODE_OPTIONS=--max-old-space-size=4096
COPY apps/user-client/ apps/user-client/
RUN VITE_BASE=/ APP_VERSION="$VERSION" APP_SHA="$GIT_SHA" APP_BUILT_AT="$BUILT_AT" \
    pnpm --filter user-client build

# 5. Build the admin-client (Vite base already '/admin/') so the frontend image
#    serves it same-origin under /admin/ — required for it to read the
#    user-client's IndexedDB account (a different origin shows "No account").
COPY apps/admin-client/ apps/admin-client/
RUN VITE_BASE=/admin/ pnpm --filter admin-client build

# ---------- Runtime stage ----------
FROM nginx:1.27-alpine

ARG VERSION=0.0.0-dev
ARG GIT_SHA=""
ARG BUILT_AT=""

COPY --from=builder /app/apps/user-client/dist /usr/share/nginx/html
COPY --from=builder /app/apps/admin-client/dist /usr/share/nginx/html/admin
COPY apps/user-client/nginx.conf /etc/nginx/conf.d/default.conf

# Plain-text version marker, served at /VERSION (chatsune parity). Written after
# the dist copy so a stray build artefact cannot clobber it.
RUN printf '%s\n' "$VERSION ($GIT_SHA, $BUILT_AT)" > /usr/share/nginx/html/VERSION

EXPOSE 80
