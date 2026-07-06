// SPDX-License-Identifier: MIT

/**
 * Canonical OPAQUE `server` identity string.
 *
 * OPAQUE binds a `server` identifier into both registration and login key
 * exchange; the client and the server must derive the *identical* string or
 * login/step-up fails with a protocol error (surfacing as a wrong-passphrase
 * or, worse, a mis-classified "server unreachable"). Both sides derive it here
 * from a base URL's **origin** (`scheme://host[:port]`) — deliberately dropping
 * any path.
 *
 * Origin-only keeps the two sides in agreement across topologies: in dev the
 * auth-service is reached directly (`http://localhost:3100`), in prod it sits
 * behind a reverse-proxy path prefix (`https://host/auth`). The earlier
 * `${base_url}/auth/v1` (client) vs `${API_BASE_URL}/v1` (server) convention
 * only matched under the prod prefix and silently diverged in dev.
 *
 * Assumes **one auth realm per origin**: two auth-services co-hosted under the
 * same origin on different path prefixes would collapse to the same identity.
 * The documented topology is one auth-service per origin (dev: direct port;
 * prod: a single `/auth` prefix behind the proxy), and true operator isolation
 * rests on each instance's OPAQUE server secret key and each account's recovery
 * verifier — not this string. A future co-hosting topology must revisit this.
 *
 * @param baseUrl A **pre-validated absolute** URL — the linked account's
 *   `base_url` on the client, or `API_BASE_URL` on the server. `new URL` throws
 *   on a non-absolute value; every call-site passes a value already validated
 *   upstream (`API_BASE_URL` at boot, a stored `base_url` at ingestion).
 */
export function opaqueServerIdentity(baseUrl: string): string {
  return `${new URL(baseUrl).origin}/v1`;
}
