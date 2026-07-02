// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Late-binding credentials for routing through the authenticated proxy.
 * Registered once at app boot; read at request-BUILD time so a long agentic
 * loop always attaches the current token (spec §3). The package stays
 * framework-agnostic — no store imports here.
 */
export interface ProxyAuthSource {
  /** Proxy base URL from discovery, or null when no proxy is available. */
  getUrl(): string | null;
  /** Current account access JWT, or null when no session token exists. */
  getToken(): string | null;
  /** Refresh the access token; resolves to the new token or null on failure. */
  refreshToken(): Promise<string | null>;
}

let source: ProxyAuthSource | null = null;

/** Register the app's proxy auth source (boot); pass null to clear (tests). */
export function setProxyAuthSource(next: ProxyAuthSource | null): void {
  source = next;
}

/** The currently registered source, or null. */
export function getProxyAuthSource(): ProxyAuthSource | null {
  return source;
}
