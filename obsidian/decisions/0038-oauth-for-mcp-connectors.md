# ADR 0038: OAuth for MCP connectors is client-side, and tokens sync as ciphertext

## Status

Accepted (2026-11-02). Supersedes decision D7 ("OAuth deferred") of
`superpowers/specs/2026-06-08-mcp-client-design.md`. Design spec:
`superpowers/specs/2026-11-02-mcp-oauth-design.md`.

## Context

Most hosted MCP servers worth connecting to expect OAuth, while Chatsundere only
accepted pasted static keys. "No OAuth or third-party identity providers" in
CLAUDE.md §14 is about signing in **to Chatsundere**; it says nothing about
Chatsundere acting as an OAuth *client* of someone else's server, the role
claude.ai and ChatGPT play.

Three constraints shape the design:

- The backend is zero-knowledge. It cannot hold, refresh or even read a token.
- A user has several devices, and a connection should be one per account, not
  one per device.
- Some servers revoke the whole connection when a spent refresh token arrives
  after a short grace period (Kumbu² allows 30 seconds), or when a token from an
  earlier sign-in arrives while a newer family is live. Others have no grace
  period at all.

## Decision

1. **OAuth for MCP is entirely client-side.** The user-client follows the MCP
   authorisation specification (protocol `2025-06-18`): discovery, PKCE S256
   only, the `resource` parameter in both requests, `state` and `iss` checks,
   Client ID Metadata Documents with Dynamic Client Registration as the
   fallback. No server component understands OAuth.
2. **Tokens sync as ciphertext.** The grant (tokens, endpoints, route) is a new
   synced collection, sealed on the client like every other record. The sync
   service sees ciphertext and revisions only.
3. **The claim model needs no new server logic.** The sync service already does
   per-record compare-and-set. A device presents a refresh token only if that
   exact token was in a snapshot it just won a compare-and-set with, and that
   snapshot carried no claim it had not observed to lapse. Claims are judged by
   local observation over a 5-minute lease and never by comparing device clocks.
   The new pair is written ahead locally before it is published, so a crash
   between refresh and publish loses nothing.
4. **Direct where possible, proxy where not.** Metadata, registration, token and
   revocation requests go direct from the browser when the authorisation server
   allows CORS, otherwise through the proxy. The route is decided once, during
   the code exchange, and stored as `tokenRoute`. A refresh never switches route.
   The sign-in itself runs in the user's browser and is never proxied.
5. **The preflight trap.** A form-encoded POST is a CORS "simple" request: the
   browser sends it without a preflight and hides only the response. A refresh
   token sent that way is spent and its answer lost. Every direct OAuth POST
   therefore carries the `MCP-Protocol-Version` header, which forces a preflight.
   A refused preflight sends nothing, so falling back to the proxy is safe.
6. **Plaintext in transit through the proxy is accepted.** When the direct route
   is unavailable, the code, verifier and tokens pass through the proxy in memory,
   exactly as Bearer keys already do, and tool calls usually carry the access token
   through it. The proxy neither stores nor logs them. This is the same trade as
   for static keys, and the direct route avoids it wherever the server permits.
7. **The sign-in code can appear in an operator's logs.** The callback page is a
   static page that removes the code from the address bar, sends
   `Referrer-Policy: no-referrer`, loads nothing third-party and has `access_log
   off`. An operator's reverse proxy can still log the request, and nginx's
   `error_log` could record it on a hypothetical 404 of the callback. The code
   alone is useless without the PKCE verifier, which never leaves the device that
   started the sign-in.
8. **First-use consent and the origin in every approval prompt** ship in the same
   unit, for OAuth and key servers alike. This closes the remainder of M1 of
   [security-deferrals](../insights/security-deferrals.md) (2026-11-02).

## Consequences

- **Accepted failure modes.** All end in "Sign in again"; none can leak a token.
  The backend being unreachable with an expired access token (no refresh,
  deliberately); a device dying between refresh and publish, or staying offline
  longer than the lease; a lost response still in doubt after 25 seconds; a sync
  server restored from an old backup or recovered by epoch; a slow refresh
  crossing a new sign-in on another device; a long-offline new sign-in
  overwriting a newer one; and a hostile sync server replaying an old row. The
  last is denial of service only, since it cannot read tokens.
- **Known limitation: grant rows are not size-padded.** `PADDED_COLLECTIONS`
  lives in `packages/crypto` and is untouched, so the ciphertext length of a grant
  row reflects its contents. Pending Larissa's judgement.
- **Rollout order.** Backend first: an older sync service refuses a push batch
  naming the new collection. A PWA not yet updated holds no grant until the next
  rotation and shows "Connects on first use".
- **Local-only devices without a proxy** can connect only when both the MCP
  endpoint and the authorisation server allow CORS; otherwise the app says so.
- **The proxy** gains `Access-Control-Expose-Headers` on forwarded responses.
  `Mcp-Session-Id` was never readable through it before.
- Removing a server is one action: best-effort revocation of the refresh token,
  then deletion on all devices. If revocation fails, the app says so.
- A future relay for the sign-in code, a per-tool "Allow always", protocol
  `2026-07-28` and a manual client ID field are logged in
  [follow-ups-index](../insights/follow-ups-index.md).
