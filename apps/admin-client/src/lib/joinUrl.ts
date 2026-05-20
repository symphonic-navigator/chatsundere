// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Concatenate a server `baseUrl` with an API `path` so that a baseUrl-embedded
 * path prefix is preserved.
 *
 * The `new URL(path, base)` constructor treats an absolute `path` (one starting
 * with `/`) as a replacement of base's path — so `new URL('/auth', 'https://x/api')`
 * yields `https://x/auth`, silently dropping the `/api` prefix. Path-routed
 * deployments need the prefix kept, so we concatenate explicitly and normalise
 * the seam.
 *
 * Mirrors the helper at `apps/user-client/src/lib/fetch.ts`. TODO: consolidate
 * into `@chatsundere/ui-shared` once both call sites are stable; this
 * duplication is intentional today to avoid coupling the two apps' fetch
 * layers through ui-shared before their shapes are finalised.
 */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const rel = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rel}`;
}
