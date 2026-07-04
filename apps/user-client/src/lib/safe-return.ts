// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Validate a `?return=` navigation target so a crafted invitation/login link
 * cannot turn a post-unlock redirect into an open redirect (spec §4 / WS-B).
 * Only a site-relative path passes; anything protocol-relative (`//host`,
 * `/\host`), scheme-bearing (`javascript:`, `https://…`), control-char-smuggled
 * (a tab-bearing `/<tab>host`), or absent falls back to {@link fallback}.
 *
 * This is the single validator for every `?return=` sink — the login unlock
 * target, the invitation wizard's back/return links, and the persona-hub back
 * link. Keeping one implementation prevents the drift that previously left some
 * sinks unguarded while others were hardened.
 */
export function safeReturnPath(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  // Reject any ASCII control character (tab/LF/CR/…). The WHATWG URL parser
  // STRIPS these before resolving, so a tab-smuggled `/<tab>/evil.com` (from
  // `?return=/%09/evil.com`) would pass the slash checks below — its char at
  // index 1 is the tab, not a slash — yet resolve to a protocol-relative
  // `//evil.com`. A char-code scan avoids embedding control chars in this source.
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return fallback;
  }
  // Must be site-relative. Reject protocol-relative and backslash-smuggled
  // variants (`/\host`) that browsers normalise to a cross-origin authority.
  if (raw[0] !== '/') return fallback;
  if (raw[1] === '/' || raw[1] === '\\') return fallback;
  return raw;
}
