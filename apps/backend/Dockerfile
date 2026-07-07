# syntax=docker/dockerfile:1
# Backend image — carries all three Bun services (auth/sync/proxy) and their
# CLI entrypoints. The compose selects a service via `command:`. Build context
# is the REPO ROOT so the pnpm workspace resolves. Multi-stage; cheap layers
# first so source edits do not re-run the dependency install.
#
# The repo is a PNPM workspace (packageManager pnpm@9.15.0, pnpm-lock.yaml) —
# install with pnpm via corepack (exactly like apps/user-client/Dockerfile),
# then RUN the services on Bun. Do NOT use `bun install` here: there is no bun
# lockfile, so `bun install --frozen-lockfile` would fail. The services import
# only @chatsundere/crypto and @chatsundere/shared-types (both tsc-built), so
# only those two workspace packages need building.

# ---------- Build stage ----------
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# 1. Manifests first → install cached until a manifest or the lockfile moves.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json biome.json ./
COPY apps/auth-service/package.json apps/auth-service/
COPY apps/sync-service/package.json apps/sync-service/
COPY apps/proxy-service/package.json apps/proxy-service/
COPY packages/crypto/package.json packages/crypto/
COPY packages/shared-types/package.json packages/shared-types/
# --ignore-scripts: the root `prepare` runs `lefthook install` (needs git, absent
# here) and skips native postinstalls the services do not use at runtime.
RUN pnpm install --frozen-lockfile --ignore-scripts

# 2. Build the two workspace packages the services consume from dist/ (tsc).
COPY packages/ packages/
RUN pnpm --filter @chatsundere/shared-types --filter @chatsundere/crypto build

# 3. Service source (cheapest to invalidate → last).
COPY apps/auth-service/ apps/auth-service/
COPY apps/sync-service/ apps/sync-service/
COPY apps/proxy-service/ apps/proxy-service/

# ---------- Runtime stage ----------
FROM oven/bun:1-alpine

ARG VERSION=0.0.0-dev
ARG GIT_SHA=""
ARG BUILT_AT=""

WORKDIR /app
# Copy the whole installed tree (pnpm's node_modules symlink farm + built dist +
# service source). Docker preserves symlinks; Bun resolves node_modules normally.
COPY --from=builder /app /app

# Version marker (frontend parity).
RUN printf '%s\n' "$VERSION ($GIT_SHA, $BUILT_AT)" > /app/VERSION

# Runs as the image's built-in non-root `bun` user.
USER bun

# No default command — the compose sets one of:
#   bun apps/auth-service/src/index.ts
#   bun apps/sync-service/src/index.ts
#   bun apps/proxy-service/src/index.ts
# CLIs (compose exec / one-shot run):
#   bun run --cwd apps/auth-service generate-opaque-setup
#   bun run --cwd apps/auth-service bootstrap-admin
#   bun apps/sync-service/tools/re-epoch.ts
