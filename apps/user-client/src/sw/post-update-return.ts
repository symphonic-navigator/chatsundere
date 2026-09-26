// SPDX-License-Identifier: AGPL-3.0-only
import { safeReturnPath } from '../lib/safe-return.js';

/** sessionStorage key carrying the route to resume after an update reload (spec 2026-09-26 §3.3). */
export const POST_UPDATE_RETURN_KEY = 'chatsundere.postUpdateReturn';

// Only the app's own routes qualify: '/application' or '/appx' must not slip through.
function isAppPath(path: string): boolean {
  return path === '/app' || path.startsWith('/app/');
}

/** Remembers where to resume after an update reload; only in-app routes qualify. */
export function rememberReturnPath(path = `${location.pathname}${location.search}`): void {
  if (!isAppPath(path)) return;
  try {
    sessionStorage.setItem(POST_UPDATE_RETURN_KEY, path);
  } catch {
    // Storage blocked — the user lands on /app instead, which is still correct.
  }
}

// undefined = not consumed yet. The first result is kept for the page's lifetime
// because StrictMode double-invokes useState initialisers in dev, and the
// second call would otherwise find the single-use key already gone.
let consumed: string | null | undefined;

/** Reads and clears the remembered route once per page, returning it only if it is a safe in-app path. */
export function consumeReturnPath(): string | null {
  if (consumed !== undefined) return consumed;
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(POST_UPDATE_RETURN_KEY);
    sessionStorage.removeItem(POST_UPDATE_RETURN_KEY);
  } catch {
    consumed = null;
    return consumed;
  }
  const safe = safeReturnPath(raw, '');
  consumed = isAppPath(safe) ? safe : null;
  return consumed;
}

/** Test-only reset of the per-page memo. */
export function _resetPostUpdateReturnForTests(): void {
  consumed = undefined;
}
